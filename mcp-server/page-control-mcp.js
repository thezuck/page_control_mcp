import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer, WebSocket } from 'ws';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import process from "node:process";
import {
    logDebug,
    pendingRequests,
    broadcastToPages,
    executeQueryPage,
    executeModifyPage,
    executeRunSnippet,
    executeListPages,
    handlePageResponse,
    cleanupStaleRequests
} from './page-control-commands.js';

// Log to stderr to avoid interfering with STDIO transport
const logStderr = (message) => {
    console.error(`[PAGE-CONTROL-MCP] ${message}`);
};

// Determine if we're running in pure STDIO mode
const isStdioMode = process.argv.includes('--stdio-only');

// Create logging utilities that respect STDIO mode
const safeLog = {
    info: (message) => {
        if (!isStdioMode) {
            console.log(message);
        } else {
            // In STDIO mode, redirect to stderr only if debugging is enabled
            if (process.env.DEBUG) {
                console.error(`[PAGE-CONTROL-MCP] INFO: ${message}`);
            }
        }
    },
    error: (message) => {
        if (!isStdioMode) {
            console.error(message); // Always use stderr for errors
        } else {
            // In STDIO mode, only log errors if debugging is enabled
            if (process.env.DEBUG) {
                console.error(`[PAGE-CONTROL-MCP] ERROR: ${message}`);
            }
        }
    },
    debug: (component, message, data) => {
        // Use the existing logDebug function for debugging
        if (!isStdioMode || process.env.DEBUG) {
            logDebug(component, message, data);
        }
    }
};

// Startup message - only show if not in STDIO mode or if DEBUG is enabled
if (!isStdioMode) {
    logStderr("Starting Page Control MCP Server with SSE endpoint...");
} else if (process.env.DEBUG) {
    logStderr("Starting Page Control MCP Server in STDIO mode only...");
}

// Store active page connections (shared between modes)
const activePages = new Map();

// WebSocket server for page connections - shared by both modes
const wss = new WebSocketServer({ port: 3001 });

// Store service health information
let serviceHealth = {
    status: 'ok',
    lastError: null,
    lastErrorTime: null,
    wsConnectionStatus: 'ok',
    connectedPages: 0,
    startTime: Date.now()
};

// Track WebSocket server errors
wss.on('error', (error) => {
    if (process.env.DEBUG) {
        safeLog.error(`[ERROR] WebSocket server error: ${error.message}`);
    }
    serviceHealth.status = 'error';
    serviceHealth.lastError = `WebSocket server error: ${error.message}`;
    serviceHealth.lastErrorTime = Date.now();
    serviceHealth.wsConnectionStatus = 'error';
});

// Function to sync the serviceHealth connected pages count with activePages
const syncConnectedPagesCount = () => {
    serviceHealth.connectedPages = activePages.size;
};

// WebSocket connection handler - shared by both modes
wss.on('connection', (ws) => {
    logDebug('WS', 'New WebSocket connection from browser page');
    let pageId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            logDebug('WS_MESSAGE', `Received WebSocket message:`, data);

            try {
                if (data.type === 'page_connected') {
                    pageId = data.pageId;
                    activePages.set(pageId, ws);
                    logDebug('PAGE', `Page ${pageId} registered, total pages: ${activePages.size}`);
                    
                    // Broadcast new page connection to all pages
                    broadcastToPages(activePages, `New page connected: ${pageId} (${data.title || 'Untitled'}) - ${data.url || 'No URL'}`);
                    
                    // Update service health with new count
                    syncConnectedPagesCount();
                } else if (data.type === 'response') {
                    // Use the shared response handler
                    handlePageResponse(data, activePages);
                } else {
                    logDebug('WS_MESSAGE', `Unknown message type: ${data.type}`);
                }
            } catch (processingError) {
                logDebug('WS_PROCESSING_ERROR', `Error processing message data: ${processingError.message}`);
            }
        } catch (error) {
            logDebug('WS_ERROR', `Error parsing WebSocket message: ${error.message}`);
        }
    });

    ws.on('close', () => {
        if (pageId) {
            activePages.delete(pageId);
            logDebug('WS', `Page ${pageId} disconnected, total pages: ${activePages.size}`);
            
            // Broadcast page disconnection to all pages
            broadcastToPages(activePages, `Page disconnected: ${pageId}`);
            
            // Update service health with new count
            syncConnectedPagesCount();
        } else {
            logDebug('WS', 'Unregistered WebSocket connection closed');
        }
    });

    ws.on('error', (error) => {
        if (process.env.DEBUG) {
            logDebug('WS_ERROR', `WebSocket connection error: ${error.message}`);
        }
        serviceHealth.status = 'degraded';
        serviceHealth.lastError = `WebSocket connection error: ${error.message}`;
        serviceHealth.lastErrorTime = Date.now();
        serviceHealth.wsConnectionStatus = 'degraded';
    });
});

// Function to safely execute tool handlers with error handling
const safeToolHandler = async (fn, ...args) => {
    try {
        return await fn(...args);
    } catch (error) {
        if (process.env.DEBUG) {
            safeLog.error(`[ERROR] Tool execution error: ${error.message}`);
        }
        // Return a graceful error response rather than crashing
        throw {
            code: -32000,
            message: `Tool execution failed: ${error.message}`
        };
    }
};

// Add regular synchronization for both modes
setInterval(() => {
    // Synchronize the connected pages count
    syncConnectedPagesCount();
    
    // Perform additional health checks if needed
    if (isStdioMode) {
        // STDIO-specific checks if needed
    } else {
        // SSE-specific checks if needed
    }
}, 5000); // Check every 5 seconds

// ===== Create MCP SDK Server for STDIO mode =====
if (isStdioMode) {
    // Create an MCP server for SDK-based transport
    const sdkServer = new McpServer({
        name: "Page Control MCP SDK Server",
        version: "1.0.0"
    });

    // Add error handler for SDK server
    process.on('uncaughtException', (error) => {
        logStderr(`[ERROR] Uncaught Exception: ${error.message}`);
        logStderr(error.stack);
        // Continue running, don't exit
    });

    // Handle errors in stdin parsing
    process.stdin.on('error', (error) => {
        logStderr(`[ERROR] STDIN Error: ${error.message}`);
        // Continue running, don't exit
    });

    // Add the query_page tool with shared implementation
    sdkServer.tool(
        "query_page",
        {
            pageId: z.string(),
            selector: z.string()
        },
        async ({ pageId, selector }) => {
            return await safeToolHandler(async () => {
                if (process.env.DEBUG) {
                    safeLog.error(`[SDK] Received query_page call: pageId=${pageId}, selector=${selector}`);
                }
                
                // Use the shared implementation
                const result = await executeQueryPage(pageId, selector, activePages);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result)
                        }
                    ]
                };
            });
        }
    );

    // Add the modify_page tool with shared implementation
    sdkServer.tool(
        "modify_page",
        {
            targetPage: z.string(),
            modification: z.object({
                selector: z.string(),
                operation: z.string(),
                value: z.string()
            }).strict()
        },
        async ({ targetPage, modification }) => {
            return await safeToolHandler(async () => {
                if (process.env.DEBUG) {
                    safeLog.error(`[SDK] Received modify_page call: targetPage=${targetPage}, modification=${JSON.stringify(modification)}`);
                }
                
                // Use the shared implementation
                const result = await executeModifyPage(targetPage, modification, activePages);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result)
                        }
                    ]
                };
            });
        }
    );

    // Add the run_snippet tool with shared implementation
    sdkServer.tool(
        "run_snippet",
        {
            pageId: z.string(),
            code: z.string()
        },
        async ({ pageId, code }) => {
            return await safeToolHandler(async () => {
                if (process.env.DEBUG) {
                    safeLog.error(`[SDK] Received run_snippet call: pageId=${pageId}, code length=${code.length}`);
                }
                
                // Use the shared implementation
                const result = await executeRunSnippet(pageId, code, activePages);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result)
                        }
                    ]
                };
            });
        }
    );

    // Add the list_pages tool with shared implementation
    sdkServer.tool(
        "list_pages",
        {
            random_string: z.string().optional()
        },
        async (args) => {
            return await safeToolHandler(async () => {
                // Use the shared implementation
                const result = executeListPages(activePages);
                if (process.env.DEBUG) {
                    safeLog.error(`[SDK] Listed ${result.count} connected pages`);
                }
                
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result)
                        }
                    ]
                };
            });
        }
    );

    // Add the page_control_status tool
    sdkServer.tool(
        "page_control_status",
        {
            detail_level: z.string().optional()
        },
        async ({ detail_level = "basic" }) => {
            return await safeToolHandler(async () => {
                if (process.env.DEBUG) {
                    safeLog.error(`[SDK] Received page_control_status call, detail level: ${detail_level}`);
                }
                
                // Update connected pages count before returning status
                syncConnectedPagesCount();
                
                // Calculate uptime
                const uptime = Math.floor((Date.now() - serviceHealth.startTime) / 1000);
                
                // Basic status information
                const statusInfo = {
                    status: serviceHealth.status,
                    uptime_seconds: uptime,
                    connected_pages: serviceHealth.connectedPages,
                    websocket_status: serviceHealth.wsConnectionStatus,
                    server_type: "STDIO"
                };
                
                // Add detailed information if requested
                if (detail_level === "detailed") {
                    statusInfo.last_error = serviceHealth.lastError;
                    statusInfo.last_error_time = serviceHealth.lastErrorTime 
                        ? new Date(serviceHealth.lastErrorTime).toISOString()
                        : null;
                    statusInfo.websocket_port = 3001;
                    statusInfo.started_at = new Date(serviceHealth.startTime).toISOString();
                }
                
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(statusInfo)
                        }
                    ]
                };
            });
        }
    );

    // Connect the SDK server to STDIO transport
    const transport = new StdioServerTransport();

    // Override the transport's message handler to catch JSON parsing errors
    const originalOnData = transport.onData;
    transport.onData = function(data) {
        try {
            originalOnData.call(this, data);
        } catch (error) {
            if (process.env.DEBUG) {
                safeLog.error(`[ERROR] STDIO Transport Error: ${error.message}`);
            }
            
            // Update service health
            serviceHealth.status = 'degraded';
            serviceHealth.lastError = `STDIO Transport Error: ${error.message}`;
            serviceHealth.lastErrorTime = Date.now();
            
            // Don't crash on invalid JSON
            if (error.message.includes('JSON') && process.env.DEBUG) {
                safeLog.error(`[ERROR] Invalid JSON received: ${data.slice(0, 100)}${data.length > 100 ? '...' : ''}`);
            }
        }
    };

    // Connect to the transport in STDIO mode
    sdkServer.connect(transport)
        .then(() => {
            // Only log in debug mode when in STDIO mode
            if (process.env.DEBUG) {
                safeLog.error("MCP SDK Server connected to STDIO transport successfully");
                safeLog.error(`
🚀 Page Control MCP server is running in STDIO mode
🌐 WebSocket server: ws://localhost:3001
                `);
            }
        })
        .catch((error) => {
            // Only log errors in debug mode when in STDIO mode
            if (process.env.DEBUG) {
                safeLog.error(`[ERROR] Failed to initialize MCP SDK Server: ${error.message}`);
                safeLog.error("Attempting to continue despite initialization error...");
            }
        });

    // Set up periodic health check for the transport
    setInterval(() => {
        try {
            // Simple ping to check if transport is alive
            if (transport.isConnected) {
                if (process.env.DEBUG) {
                    safeLog.debug('HEALTH', 'STDIO transport is connected');
                }
            } else {
                if (process.env.DEBUG) {
                    safeLog.error('[WARNING] STDIO transport disconnected, waiting for reconnection...');
                }
            }
        } catch (error) {
            if (process.env.DEBUG) {
                safeLog.error(`[ERROR] Health check error: ${error.message}`);
            }
        }
    }, 30000); // Check every 30 seconds
} 
// ===== Create Express Server for SSE mode =====
else {
    // Initialize service health in SSE mode as well
    if (!serviceHealth) {
        // Initialize if not already defined
        serviceHealth = {
            status: 'ok',
            lastError: null,
            lastErrorTime: null,
            wsConnectionStatus: 'ok',
            connectedPages: activePages.size,
            startTime: Date.now()
        };
    } else {
        // Update if defined
        serviceHealth.connectedPages = activePages.size;
    }

    // Function to process legacy JSONRPC messages (only used by SSE)
    const processJsonRpcMessage = (rpc, sessionId = null, sseRes = null) => {
        logDebug('RPC', `Processing SSE message: ${rpc.method}`, rpc);

        // Helper function to send a response via SSE
        const sendResponse = (response) => {
            if (sseRes) {
                sseRes.write(`event: message\n`);
                sseRes.write(`data: ${JSON.stringify(response)}\n\n`);
                logDebug('SSE', `Sent response via SSE`, response);
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
                safeLog.info(`📤 Sent initialization response via SSE`);
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
                            },
                            {
                                name: 'page_control_status',
                                description: 'Get the status of the page control service',
                                inputSchema: {
                                    type: 'object',
                                    properties: {
                                        detail_level: {
                                            type: 'string',
                                            description: 'Level of detail to include (basic or detailed)',
                                            enum: ['basic', 'detailed']
                                        }
                                    },
                                    required: []
                                }
                            }
                        ],
                        count: 5
                    }
                };
                sendResponse(response);
                safeLog.info(`📤 Sent tools list via SSE`);
                break;
            }

            case 'tools/call': {
                const toolName = rpc.params?.name;
                const args = rpc.params?.arguments || {};
                logDebug('TOOL_CALL', `Received tool call via SSE: ${toolName}`, args);

                switch (toolName) {
                    case 'query_page': {
                        // Register request with transport info
                        const legacyRequestId = rpc.id;
                        
                        // Execute the command using the shared module
                        executeQueryPage(args.pageId, args.selector, activePages)
                            .then(result => {
                                const response = {
                                    jsonrpc: '2.0',
                                    id: legacyRequestId,
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
                            })
                            .catch(error => {
                                const errorResponse = {
                                    jsonrpc: '2.0',
                                    id: legacyRequestId,
                                    error: {
                                        code: -32000,
                                        message: error.message
                                    }
                                };
                                sendResponse(errorResponse);
                            });
                        break;
                    }
                    
                    case 'modify_page': {
                        // Register request with transport info
                        const legacyRequestId = rpc.id;
                        
                        // Execute the command using the shared module
                        executeModifyPage(args.targetPage, args.modification, activePages)
                            .then(result => {
                                const response = {
                                    jsonrpc: '2.0',
                                    id: legacyRequestId,
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
                            })
                            .catch(error => {
                                const errorResponse = {
                                    jsonrpc: '2.0',
                                    id: legacyRequestId,
                                    error: {
                                        code: -32000,
                                        message: error.message
                                    }
                                };
                                sendResponse(errorResponse);
                            });
                        break;
                    }
                    
                    case 'run_snippet': {
                        // Register request with transport info
                        const legacyRequestId = rpc.id;
                        
                        // Execute the command using the shared module
                        executeRunSnippet(args.pageId, args.code, activePages)
                            .then(result => {
                                const response = {
                                    jsonrpc: '2.0',
                                    id: legacyRequestId,
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
                            })
                            .catch(error => {
                                const errorResponse = {
                                    jsonrpc: '2.0',
                                    id: legacyRequestId,
                                    error: {
                                        code: -32000,
                                        message: error.message
                                    }
                                };
                                sendResponse(errorResponse);
                            });
                        break;
                    }
                    
                    case 'list_pages': {
                        const result = executeListPages(activePages);
                        
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
                        break;
                    }
                    
                    case 'page_control_status': {
                        const detail_level = args.detail_level || 'basic';
                        
                        // Update connected pages count before returning status
                        syncConnectedPagesCount();
                        
                        // Calculate uptime
                        const uptime = Math.floor((Date.now() - serviceHealth.startTime) / 1000);
                        
                        // Basic status information
                        const statusInfo = {
                            status: serviceHealth.status,
                            uptime_seconds: uptime,
                            connected_pages: serviceHealth.connectedPages,
                            websocket_status: serviceHealth.wsConnectionStatus,
                            server_type: "SSE"
                        };
                        
                        // Add detailed information if requested
                        if (detail_level === "detailed") {
                            statusInfo.last_error = serviceHealth.lastError;
                            statusInfo.last_error_time = serviceHealth.lastErrorTime 
                                ? new Date(serviceHealth.lastErrorTime).toISOString()
                                : null;
                            statusInfo.websocket_port = 3001;
                            statusInfo.started_at = new Date(serviceHealth.startTime).toISOString();
                        }
                        
                        const response = {
                            jsonrpc: '2.0',
                            id: rpc.id,
                            result: {
                                content: [
                                    {
                                        type: 'text',
                                        text: JSON.stringify(statusInfo)
                                    }
                                ]
                            }
                        };
                        sendResponse(response);
                        break;
                    }

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
                        return;
                }
                break;
            }

            case 'notifications/initialized': {
                logDebug('NOTIFICATION', `Client initialized via SSE`);
                break;
            }

            case 'notifications/cancelled': {
                logDebug('NOTIFICATION', `Request cancelled via SSE`, rpc.params);
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
                logDebug('METHOD_ERROR', `Sent error response via SSE:`, error);
            }
        }
    };

    // Set up Express and sessions for SSE mode
    const app = express();
    const port = 4000;
    
    // Enable CORS and JSON parsing
    app.use(cors());
    app.use(express.json());
    
    // Store SSE sessions
    const sessions = new Map();

    // SSE endpoint for AI editors that support SSE, e.g. Cursor
    app.get('/page-control', (req, res) => {
        safeLog.info('🔌 New SSE connection from AI editor');

        // SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Generate sessionId
        const sessionId = uuidv4();
        sessions.set(sessionId, { sseRes: res, initialized: false });
        safeLog.info('📝 Created sessionId: ' + sessionId);

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
            safeLog.info('🔌 SSE connection closed, sessionId: ' + sessionId);
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
        processJsonRpcMessage(rpc, sessionId, sseRes);
    });

    // Clean up stale pending requests every minute
    setInterval(() => {
        // Use the shared cleaner with a custom timeout handler
        cleanupStaleRequests((id, request) => {
            // Handle timeouts for SSE transport
            if (request.transport === 'SSE' && request.sessionId) {
                const sessionData = sessions.get(request.sessionId);
                if (sessionData && sessionData.sseRes) {
                    const timeoutError = {
                        jsonrpc: '2.0',
                        id: parseInt(id),
                        error: {
                            code: -32001,
                            message: `Request timed out after 30000ms`
                        }
                    };
                    sessionData.sseRes.write(`event: message\n`);
                    sessionData.sseRes.write(`data: ${JSON.stringify(timeoutError)}\n\n`);
                    logDebug('TIMEOUT', `Sent timeout error via SSE for request ${id}`, timeoutError);
                }
            }
        });
    }, 60000);

    // Start the Express server in SSE mode
    app.listen(port, () => {
        safeLog.info(`
🚀 Page Control MCP server is running with SSE support
📡 SSE endpoint: http://localhost:${port}/page-control
🌐 WebSocket server: ws://localhost:3001
        `);
    });
}

// Handle process exit events
process.on("SIGINT", () => {
    logStderr("Received SIGINT, shutting down...");
    process.exit(0);
});

process.on("SIGTERM", () => {
    logStderr("Received SIGTERM, shutting down...");
    process.exit(0);
}); 