const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');

const app = express();
const port = 4000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Store active page connections
const activePages = new Map();
// Store SSE sessions
const sessions = new Map();

// WebSocket server for page connections
const wss = new WebSocket.Server({ port: 3001 });

console.log('Starting MCP server...');

// Enhanced logging
const logDebug = (component, message, data = null) => {
    const timestamp = new Date().toISOString();
    const dataStr = data ? JSON.stringify(data, null, 2) : '';
    console.log(`[DEBUG][${timestamp}][${component}] ${message}${dataStr ? '\n' + dataStr : ''}`);
};

// Map to store pending requests waiting for responses
const pendingRequests = new Map();

// Broadcast a message to all connected pages
const broadcastToPages = (message) => {
    logDebug('BROADCAST', `Broadcasting message to ${activePages.size} pages`);
    activePages.forEach((ws, pageId) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'activity',
                message
            }));
        }
    });
};

// STDIO handling for Zencoder support
let stdioBuffer = '';

// Function to send response via STDIO
const sendStdioResponse = (response) => {
    logDebug('STDIO', 'Sending response via STDIO', response);
    process.stdout.write(JSON.stringify(response) + '\n');
};

// Function to process JSONRPC messages (used by both SSE and STDIO)
const processJsonRpcMessage = (rpc, transport, sessionId = null, sseRes = null) => {
    logDebug('RPC', `Processing ${transport} message: ${rpc.method}`, rpc);

    // Helper function to send a response based on transport
    const sendResponse = (response) => {
        if (transport === 'SSE' && sseRes) {
            sseRes.write(`event: message\n`);
            sseRes.write(`data: ${JSON.stringify(response)}\n\n`);
            logDebug('SSE', `Sent response via SSE`, response);
        } else if (transport === 'STDIO') {
            sendStdioResponse(response);
        }
    };

    switch (rpc.method) {
        case 'initialize': {
            if (sessionId && sessions.has(sessionId)) {
                sessions.get(sessionId).initialized = true;
            }
            
            const response = {
                jsonrpc: '2.0',
                id: rpc.id,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: { listChanged: true },
                        resources: { subscribe: true, listChanged: true },
                        prompts: { listChanged: true },
                        logging: {}
                    },
                    serverInfo: {
                        name: 'page-control-mcp',
                        version: '1.0.0'
                    }
                }
            };
            sendResponse(response);
            console.log(`📤 Sent initialization response via ${transport}`);
            break;
        }

        case 'tools/list': {
            const response = {
                jsonrpc: '2.0',
                id: rpc.id,
                result: {
                    tools: [
                        {
                            name: 'query_page',
                            description: 'Query elements on a web page using CSS selector',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    pageId: {
                                        type: 'string',
                                        description: 'ID of the connected page'
                                    },
                                    selector: {
                                        type: 'string',
                                        description: 'CSS selector to query elements'
                                    }
                                },
                                required: ['pageId', 'selector']
                            }
                        },
                        {
                            name: 'modify_page',
                            description: 'Modify elements on a web page',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    targetPage: {
                                        type: 'string',
                                        description: 'ID of the page to modify'
                                    },
                                    modification: {
                                        type: 'object',
                                        properties: {
                                            selector: {
                                                type: 'string',
                                                description: 'CSS selector for target elements'
                                            },
                                            operation: {
                                                type: 'string',
                                                description: 'Type of modification (setAttribute, setProperty, setInnerHTML, setTextContent)'
                                            },
                                            value: {
                                                type: 'string',
                                                description: 'New value to set'
                                            }
                                        },
                                        required: ['selector', 'operation', 'value']
                                    }
                                },
                                required: ['targetPage', 'modification']
                            }
                        },
                        {
                            name: 'run_snippet',
                            description: 'Execute a JavaScript code snippet in the context of the page',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    pageId: {
                                        type: 'string',
                                        description: 'ID of the page to execute the snippet on'
                                    },
                                    code: {
                                        type: 'string',
                                        description: 'JavaScript code to execute'
                                    }
                                },
                                required: ['pageId', 'code']
                            }
                        },
                        {
                            name: 'list_pages',
                            description: 'List all connected pages',
                            inputSchema: {
                                type: 'object',
                                properties: {},
                                required: []
                            }
                        }
                    ],
                    count: 4
                }
            };
            sendResponse(response);
            console.log(`📤 Sent tools list via ${transport}`);
            break;
        }

        case 'tools/call': {
            const toolName = rpc.params?.name;
            const args = rpc.params?.arguments || {};
            logDebug('TOOL_CALL', `Received tool call via ${transport}: ${toolName}`, args);

            let result;
            switch (toolName) {
                case 'query_page':
                    logDebug('QUERY', `Querying page ${args.pageId} with selector "${args.selector}"`);
                    const ws = activePages.get(args.pageId);
                    if (!ws) {
                        const pages = Array.from(activePages.keys());
                        logDebug('QUERY_ERROR', `Page "${args.pageId}" not found. Available pages: ${pages.join(', ')}`);
                        
                        const error = {
                            jsonrpc: '2.0',
                            id: rpc.id,
                            error: {
                                code: -32000,
                                message: `Page "${args.pageId}" is not connected. Currently connected pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`
                            }
                        };
                        sendResponse(error);
                        logDebug('QUERY_ERROR', `Sent error response via ${transport}:`, error);

                        // Broadcast the disconnected page error to all pages
                        broadcastToPages(`Query failed: Page "${args.pageId}" is not connected. Available pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`);
                        return;
                    }

                    // Store the request for later matching with response
                    pendingRequests.set(rpc.id, { 
                        sessionId, 
                        transport,
                        method: 'query_page',
                        timestamp: Date.now() 
                    });
                    logDebug('QUERY', `Added pending request ${rpc.id} for ${transport} ${sessionId ? 'session ' + sessionId : ''}`);

                    // Send query command to the page
                    const queryCommand = JSON.stringify({
                        command: 'query_page',
                        params: {
                            selector: args.selector
                        },
                        id: rpc.id
                    });
                    ws.send(queryCommand);
                    logDebug('QUERY', `Sent query command to page ${args.pageId}:`, queryCommand);

                    // Broadcast query activity to all pages
                    broadcastToPages(`Query executed on ${args.pageId}: ${args.selector}`);
                    break;

                case 'modify_page':
                    logDebug('MODIFY', `Modifying page ${args.targetPage}`, args.modification);
                    const targetWs = activePages.get(args.targetPage);
                    if (!targetWs) {
                        const pages = Array.from(activePages.keys());
                        logDebug('MODIFY_ERROR', `Page "${args.targetPage}" not found. Available pages: ${pages.join(', ')}`);
                        
                        const error = {
                            jsonrpc: '2.0',
                            id: rpc.id,
                            error: {
                                code: -32000,
                                message: `Page "${args.targetPage}" is not connected. Currently connected pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`
                            }
                        };
                        sendResponse(error);
                        logDebug('MODIFY_ERROR', `Sent error response via ${transport}:`, error);

                        // Broadcast the disconnected page error to all pages
                        broadcastToPages(`Modification failed: Page "${args.targetPage}" is not connected. Available pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`);
                        return;
                    }

                    // Store the request for later matching with response
                    pendingRequests.set(rpc.id, { 
                        sessionId, 
                        transport,
                        method: 'modify_page',
                        timestamp: Date.now() 
                    });
                    logDebug('MODIFY', `Added pending request ${rpc.id} for ${transport} ${sessionId ? 'session ' + sessionId : ''}`);

                    // Send modify command to the page
                    const modifyCommand = JSON.stringify({
                        command: 'modify_page',
                        params: args.modification,
                        id: rpc.id
                    });
                    targetWs.send(modifyCommand);
                    logDebug('MODIFY', `Sent modify command to page ${args.targetPage}:`, modifyCommand);

                    // Broadcast modification activity to all pages
                    broadcastToPages(`Page ${args.targetPage} modified: ${args.modification.operation} on ${args.modification.selector}`);
                    break;

                case 'run_snippet':
                    logDebug('SNIPPET', `Running snippet on page ${args.pageId}`);
                    const snippetWs = activePages.get(args.pageId);
                    if (!snippetWs) {
                        const pages = Array.from(activePages.keys());
                        logDebug('SNIPPET_ERROR', `Page "${args.pageId}" not found. Available pages: ${pages.join(', ')}`);
                        
                        const error = {
                            jsonrpc: '2.0',
                            id: rpc.id,
                            error: {
                                code: -32000,
                                message: `Page "${args.pageId}" is not connected. Currently connected pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`
                            }
                        };
                        sendResponse(error);
                        logDebug('SNIPPET_ERROR', `Sent error response via ${transport}:`, error);

                        // Broadcast the disconnected page error to all pages
                        broadcastToPages(`Snippet execution failed: Page "${args.pageId}" is not connected. Available pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`);
                        return;
                    }

                    // Store the request for later matching with response
                    pendingRequests.set(rpc.id, { 
                        sessionId, 
                        transport,
                        method: 'run_snippet',
                        timestamp: Date.now() 
                    });
                    logDebug('SNIPPET', `Added pending request ${rpc.id} for ${transport} ${sessionId ? 'session ' + sessionId : ''}`);

                    // Send snippet command to the page
                    const snippetCommand = JSON.stringify({
                        command: 'run_snippet',
                        params: {
                            code: args.code
                        },
                        id: rpc.id
                    });
                    snippetWs.send(snippetCommand);
                    logDebug('SNIPPET', `Sent snippet command to page ${args.pageId}`, { 
                        id: rpc.id, 
                        codeLength: args.code.length 
                    });

                    // Broadcast snippet activity to all pages
                    broadcastToPages(`Executing code snippet on ${args.pageId} (${args.code.length} characters)`);
                    break;

                case 'list_pages':
                    const pages = Array.from(activePages.keys());
                    logDebug('LIST', `Listing connected pages: ${pages.join(', ')}`);
                    result = { pages };

                    // Broadcast list pages activity to all pages
                    broadcastToPages(`Listed ${pages.length} connected pages`);

                    const response = {
                        jsonrpc: '2.0',
                        id: rpc.id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(result)
                                }
                            ]
                        }
                    };
                    sendResponse(response);
                    logDebug('LIST', `Sent list response via ${transport}:`, response);
                    break;

                default:
                    logDebug('TOOL_ERROR', `Unknown tool: ${toolName}`);
                    const error = {
                        jsonrpc: '2.0',
                        id: rpc.id,
                        error: {
                            code: -32601,
                            message: `Unknown tool: ${toolName}`
                        }
                    };
                    sendResponse(error);
                    logDebug('TOOL_ERROR', `Sent error response via ${transport}:`, error);
                    return;
            }
            break;
        }

        case 'notifications/initialized': {
            logDebug('NOTIFICATION', `Client initialized via ${transport}`);
            break;
        }

        case 'notifications/cancelled': {
            logDebug('NOTIFICATION', `Request cancelled via ${transport}`, rpc.params);
            // If there was a requestId, remove it from pending requests
            if (rpc.params?.requestId) {
                pendingRequests.delete(rpc.params.requestId);
                logDebug('NOTIFICATION', `Removed cancelled request ${rpc.params.requestId} from pending requests`);
            }
            break;
        }

        default: {
            logDebug('METHOD_ERROR', `Unknown method: ${rpc.method}`);
            const error = {
                jsonrpc: '2.0',
                id: rpc.id,
                error: {
                    code: -32601,
                    message: `Method not found: ${rpc.method}`
                }
            };
            sendResponse(error);
            logDebug('METHOD_ERROR', `Sent error response via ${transport}:`, error);
        }
    }
};

// Handle STDIO input for Zencoder
if (process.stdin.isTTY) {
    console.log('Running in TTY mode, STDIO transport available');
} else {
    console.log('Running in non-TTY mode, STDIO transport active');
    
    // Set up STDIO handling
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', (chunk) => {
        stdioBuffer += chunk;
        logDebug('STDIO', `Received data chunk, buffer length: ${stdioBuffer.length}`);
        
        // Process complete JSON messages
        let newlineIndex;
        while ((newlineIndex = stdioBuffer.indexOf('\n')) !== -1) {
            const line = stdioBuffer.substring(0, newlineIndex);
            stdioBuffer = stdioBuffer.substring(newlineIndex + 1);
            
            if (line.trim()) {
                try {
                    const message = JSON.parse(line);
                    logDebug('STDIO', 'Parsed JSON message:', message);
                    
                    if (message.jsonrpc === '2.0') {
                        processJsonRpcMessage(message, 'STDIO');
                    } else {
                        logDebug('STDIO_ERROR', 'Invalid JSON-RPC message:', message);
                        sendStdioResponse({
                            jsonrpc: '2.0',
                            id: message.id || null,
                            error: {
                                code: -32600,
                                message: 'Invalid JSON-RPC request'
                            }
                        });
                    }
                } catch (error) {
                    logDebug('STDIO_ERROR', `Error parsing JSON: ${error.message}`);
                    sendStdioResponse({
                        jsonrpc: '2.0',
                        id: null,
                        error: {
                            code: -32700,
                            message: `Parse error: ${error.message}`
                        }
                    });
                }
            }
        }
    });
    
    process.stdin.on('end', () => {
        logDebug('STDIO', 'Input stream ended');
    });
}

wss.on('connection', (ws) => {
    logDebug('WS', 'New WebSocket connection from browser page');
    let pageId = null;

    ws.on('message', (message) => {
        try {
        const data = JSON.parse(message);
            logDebug('WS_MESSAGE', `Received WebSocket message:`, data);

        if (data.type === 'page_connected') {
            pageId = data.pageId;
            activePages.set(pageId, ws);
                logDebug('PAGE', `Page ${pageId} registered, total pages: ${activePages.size}`);
                
                // Broadcast new page connection to all pages
                broadcastToPages(`New page connected: ${pageId} (${data.title || 'Untitled'}) - ${data.url || 'No URL'}`);
            } else if (data.type === 'response') {
                logDebug('RESPONSE', `Received response from page ${data.pageId} for request ${data.requestId}`, data);
                
                // Check if this is a response to a pending request
                if (pendingRequests.has(data.requestId)) {
                    const { sessionId, transport, method } = pendingRequests.get(data.requestId);
                    logDebug('RESPONSE', `Found pending request ${data.requestId} for ${transport} ${sessionId ? 'session ' + sessionId : ''}, method ${method}`);
                    
                    // Format response
                    const responseBody = {
                        jsonrpc: '2.0',
                        id: data.requestId,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(data.error ? { error: data.error } : data)
                                }
                            ]
                        }
                    };
                    
                    // Handle errors
                    if (data.error) {
                        logDebug('RESPONSE', `Error in response: ${data.error}`);
                        responseBody.error = {
                            code: -32000,
                            message: data.error
                        };
                        delete responseBody.result;
                        
                        broadcastToPages(`Error from page ${data.pageId}: ${data.error}`);
                    } else {
                        logDebug('RESPONSE', `Successful response from page ${data.pageId}`);
                        broadcastToPages(`Received successful response from page ${data.pageId}`);
                    }
                    
                    // Send response based on transport
                    if (transport === 'SSE') {
                        const sessionData = sessions.get(sessionId);
                        if (sessionData && sessionData.sseRes) {
                            sessionData.sseRes.write(`event: message\n`);
                            sessionData.sseRes.write(`data: ${JSON.stringify(responseBody)}\n\n`);
                            logDebug('RESPONSE', `Sent response to the AI editor:`, responseBody);
                        } else {
                            logDebug('RESPONSE', `Session ${sessionId} not found or has no SSE response`);
                        }
                    } else if (transport === 'STDIO') {
                        sendStdioResponse(responseBody);
                    }
                    
                    // Clean up pending request
                    pendingRequests.delete(data.requestId);
                    logDebug('RESPONSE', `Deleted pending request ${data.requestId}, remaining: ${pendingRequests.size}`);
                } else {
                    logDebug('RESPONSE', `No pending request found for ID ${data.requestId}. Current pending: ${Array.from(pendingRequests.keys()).join(', ')}`);
                }
            } else {
                logDebug('WS_MESSAGE', `Unknown message type: ${data.type}`);
            }
        } catch (error) {
            logDebug('WS_ERROR', `Error processing WebSocket message: ${error.message}`);
        }
    });

    ws.on('close', () => {
        if (pageId) {
            activePages.delete(pageId);
            logDebug('WS', `Page ${pageId} disconnected, total pages: ${activePages.size}`);
            
            // Broadcast page disconnection to all pages
            broadcastToPages(`Page disconnected: ${pageId}`);
        } else {
            logDebug('WS', 'Unregistered WebSocket connection closed');
        }
    });

    ws.on('error', (error) => {
        logDebug('WS_ERROR', `WebSocket error: ${error.message}`);
    });
});

// SSE endpoint for AI editors that support SSE, e.g. Cursor
app.get('/page-control', (req, res) => {
    console.log('🔌 New SSE connection from AI editor');

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Generate sessionId
    const sessionId = uuidv4();
    sessions.set(sessionId, { sseRes: res, initialized: false });
    console.log('📝 Created sessionId:', sessionId);

    // Send endpoint event
    res.write(`event: endpoint\n`);
    res.write(`data: /message?sessionId=${sessionId}\n\n`);

    // Heartbeat every 10 seconds
    const heartbeat = setInterval(() => {
        res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    }, 10000);

    // Cleanup on disconnect
    req.on('close', () => {
        clearInterval(heartbeat);
        sessions.delete(sessionId);
        console.log('🔌 SSE connection closed, sessionId:', sessionId);
    });
});

// Message endpoint for JSON-RPC communication
app.post('/message', (req, res) => {
    logDebug('HTTP', `Received message:`, req.body);
    logDebug('HTTP', `Query params:`, req.query);

    const sessionId = req.query.sessionId;
    if (!sessionId) {
        logDebug('HTTP_ERROR', 'Missing sessionId in query');
        return res.status(400).json({ error: 'Missing sessionId in query' });
    }

    const sessionData = sessions.get(sessionId);
    if (!sessionData) {
        logDebug('HTTP_ERROR', `No SSE session found for sessionId: ${sessionId}`);
        return res.status(404).json({ error: 'No SSE session found for sessionId' });
    }

    const rpc = req.body;
    if (!rpc || rpc.jsonrpc !== '2.0' || !rpc.method) {
        logDebug('HTTP_ERROR', 'Invalid JSON-RPC request');
        return res.json({
            jsonrpc: '2.0',
            id: rpc?.id ?? null,
            error: {
                code: -32600,
                message: 'Invalid JSON-RPC request'
            }
        });
    }

    // Send minimal HTTP acknowledgment
    res.json({
        jsonrpc: '2.0',
        id: rpc.id,
        result: { ack: `Received ${rpc.method}` }
    });
    logDebug('HTTP', `Sent HTTP acknowledgment for ${rpc.method}`);

    // Handle the actual message through SSE
    const sseRes = sessionData.sseRes;
    if (!sseRes) {
        logDebug('SSE_ERROR', `No SSE response found for sessionId: ${sessionId}`);
        return;
    }

    // Process the JSON-RPC message
    processJsonRpcMessage(rpc, 'SSE', sessionId, sseRes);
});

// Clean up stale pending requests every minute
setInterval(() => {
    const now = Date.now();
    const timeout = 30000; // 30 seconds timeout

    // Check for timed out requests
    for (const [id, request] of pendingRequests.entries()) {
        if (now - request.timestamp > timeout) {
            logDebug('TIMEOUT', `Request ${id} timed out after ${timeout}ms`);
            
            // Try to send error back based on transport
            if (request.transport === 'SSE' && request.sessionId) {
                const sessionData = sessions.get(request.sessionId);
                if (sessionData && sessionData.sseRes) {
                    const timeoutError = {
                        jsonrpc: '2.0',
                        id: parseInt(id),
                        error: {
                            code: -32001,
                            message: `Request timed out after ${timeout}ms`
                        }
                    };
                    sessionData.sseRes.write(`event: message\n`);
                    sessionData.sseRes.write(`data: ${JSON.stringify(timeoutError)}\n\n`);
                    logDebug('TIMEOUT', `Sent timeout error via SSE for request ${id}`, timeoutError);
                }
            } else if (request.transport === 'STDIO') {
                const timeoutError = {
                    jsonrpc: '2.0',
                    id: parseInt(id),
                    error: {
                        code: -32001,
                        message: `Request timed out after ${timeout}ms`
                    }
                };
                sendStdioResponse(timeoutError);
                logDebug('TIMEOUT', `Sent timeout error via STDIO for request ${id}`, timeoutError);
            }
            
            // Remove the timed out request
            pendingRequests.delete(id);
        }
    }
}, 60000);

app.listen(port, () => {
    console.log(`
🚀 Page Control MCP server is running
📡 SSE endpoint: http://localhost:${port}/page-control
🌐 WebSocket server: ws://localhost:3001
💻 STDIO transport: ${process.stdin.isTTY ? 'Available' : 'Active'}
    `);
}); 