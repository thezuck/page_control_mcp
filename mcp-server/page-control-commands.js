// page-control-commands.js
// Shared logic for executing page control commands

import { WebSocket } from 'ws';
import process from "node:process";

// Check if running in STDIO mode (must match check in the main file)
const isStdioMode = process.argv.includes('--stdio-only');

// Enhanced logging - silent in STDIO mode
const logDebug = (component, message, data = null) => {
    // Skip all logging in STDIO mode
    if (isStdioMode) {
        return;
    }
    
    const timestamp = new Date().toISOString();
    const dataStr = data ? JSON.stringify(data, null, 2) : '';
    console.log(`[DEBUG][${timestamp}][${component}] ${message}${dataStr ? '\n' + dataStr : ''}`);
};

// Map to store pending requests waiting for responses
const pendingRequests = new Map();

// Broadcast a message to all connected pages
const broadcastToPages = (activePages, message) => {
    // Only log in non-STDIO mode
    if (!isStdioMode) {
        logDebug('BROADCAST', `Broadcasting message to ${activePages.size} pages`);
    }
    
    activePages.forEach((ws, pageId) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'activity',
                message
            }));
        }
    });
};

// Execute query_page command
const executeQueryPage = async (pageId, selector, activePages) => {
    logDebug('QUERY', `Querying page ${pageId} with selector "${selector}"`);
    
    const ws = activePages.get(pageId);
    if (!ws) {
        const pages = Array.from(activePages.keys());
        logDebug('QUERY_ERROR', `Page "${pageId}" not found. Available pages: ${pages.join(', ')}`);
        
        // Broadcast the disconnected page error to all pages
        broadcastToPages(activePages, `Query failed: Page "${pageId}" is not connected. Available pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`);
        
        throw new Error(`Page "${pageId}" is not connected. Currently connected pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`);
    }

    // Create a promise that will be resolved when the response is received
    return new Promise((resolve, reject) => {
        const requestId = Math.floor(Math.random() * 1000000);
        
        // Set a timeout to reject the promise after 30 seconds
        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error(`Request timed out after 30000ms`));
        }, 30000);
        
        // Store the request for later matching with response
        pendingRequests.set(requestId, { 
            resolve: (data) => {
                clearTimeout(timeout);
                resolve(data);
            },
            reject: (err) => {
                clearTimeout(timeout);
                reject(err);
            },
            method: 'query_page',
            timestamp: Date.now() 
        });
        
        // Send query command to the page
        const queryCommand = JSON.stringify({
            command: 'query_page',
            params: {
                selector: selector
            },
            id: requestId
        });
        
        try {
            ws.send(queryCommand);
            logDebug('QUERY', `Sent query command to page ${pageId}:`, { selector, requestId });
            
            // Broadcast query activity to all pages
            broadcastToPages(activePages, `Query executed on ${pageId}: ${selector}`);
        } catch (error) {
            pendingRequests.delete(requestId);
            clearTimeout(timeout);
            reject(error);
        }
    });
};

// Execute modify_page command
const executeModifyPage = async (targetPage, modification, activePages) => {
    logDebug('MODIFY', `Modifying page ${targetPage}`, modification);
    
    const ws = activePages.get(targetPage);
    if (!ws) {
        const pages = Array.from(activePages.keys());
        logDebug('MODIFY_ERROR', `Page "${targetPage}" not found. Available pages: ${pages.join(', ')}`);
        
        // Broadcast the disconnected page error to all pages
        broadcastToPages(activePages, `Modification failed: Page "${targetPage}" is not connected. Available pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`);
        
        throw new Error(`Page "${targetPage}" is not connected. Currently connected pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`);
    }

    // Create a promise that will be resolved when the response is received
    return new Promise((resolve, reject) => {
        const requestId = Math.floor(Math.random() * 1000000);
        
        // Set a timeout to reject the promise after 30 seconds
        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error(`Request timed out after 30000ms`));
        }, 30000);
        
        // Store the request for later matching with response
        pendingRequests.set(requestId, { 
            resolve: (data) => {
                clearTimeout(timeout);
                resolve(data);
            },
            reject: (err) => {
                clearTimeout(timeout);
                reject(err);
            },
            method: 'modify_page',
            timestamp: Date.now() 
        });
        
        // Send modify command to the page
        const modifyCommand = JSON.stringify({
            command: 'modify_page',
            params: modification,
            id: requestId
        });
        
        try {
            ws.send(modifyCommand);
            logDebug('MODIFY', `Sent modify command to page ${targetPage}:`, { modification, requestId });
            
            // Broadcast modification activity to all pages
            broadcastToPages(activePages, `Page ${targetPage} modified: ${modification.operation} on ${modification.selector}`);
        } catch (error) {
            pendingRequests.delete(requestId);
            clearTimeout(timeout);
            reject(error);
        }
    });
};

// Execute run_snippet command
const executeRunSnippet = async (pageId, code, activePages) => {
    logDebug('SNIPPET', `Running snippet on page ${pageId}`);
    
    const ws = activePages.get(pageId);
    if (!ws) {
        const pages = Array.from(activePages.keys());
        logDebug('SNIPPET_ERROR', `Page "${pageId}" not found. Available pages: ${pages.join(', ')}`);
        
        // Broadcast the disconnected page error to all pages
        broadcastToPages(activePages, `Snippet execution failed: Page "${pageId}" is not connected. Available pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`);
        
        throw new Error(`Page "${pageId}" is not connected. Currently connected pages: ${pages.length > 0 ? pages.join(', ') : 'none'}`);
    }

    // Create a promise that will be resolved when the response is received
    return new Promise((resolve, reject) => {
        const requestId = Math.floor(Math.random() * 1000000);
        
        // Set a timeout to reject the promise after 30 seconds
        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error(`Request timed out after 30000ms`));
        }, 30000);
        
        // Store the request for later matching with response
        pendingRequests.set(requestId, { 
            resolve: (data) => {
                clearTimeout(timeout);
                resolve(data);
            },
            reject: (err) => {
                clearTimeout(timeout);
                reject(err);
            },
            method: 'run_snippet',
            timestamp: Date.now() 
        });
        
        // Send snippet command to the page
        const snippetCommand = JSON.stringify({
            command: 'run_snippet',
            params: {
                code: code
            },
            id: requestId
        });
        
        try {
            ws.send(snippetCommand);
            logDebug('SNIPPET', `Sent snippet command to page ${pageId}:`, { codeLength: code.length, requestId });
            
            // Broadcast snippet activity to all pages
            broadcastToPages(activePages, `Executing code snippet on ${pageId} (${code.length} characters)`);
        } catch (error) {
            pendingRequests.delete(requestId);
            clearTimeout(timeout);
            reject(error);
        }
    });
};

// List all connected pages
const executeListPages = (activePages) => {
    // Filter out any stale connections
    for (const [pageId, ws] of activePages.entries()) {
        if (ws.readyState !== WebSocket.OPEN) {
            activePages.delete(pageId);
            logDebug('LIST', `Removed stale connection for page ${pageId}`);
        }
    }
    
    const pages = Array.from(activePages.keys());
    logDebug('LIST', `Listing connected pages: ${pages.join(', ')}`);
    
    // Broadcast list pages activity to all pages
    broadcastToPages(activePages, `Listed ${pages.length} connected pages`);
    
    return { pages, count: pages.length };
};

// Function to handle a response from a page
const handlePageResponse = (data, activePages) => {
    logDebug('RESPONSE', `Received response from page ${data.pageId} for request ${data.requestId}`, data);
    
    // Check if this is a response to a pending request
    if (pendingRequests.has(data.requestId)) {
        const pendingRequest = pendingRequests.get(data.requestId);
        
        // Handle errors
        if (data.error) {
            logDebug('RESPONSE', `Error in response: ${data.error}`);
            pendingRequest.reject(new Error(data.error));
            broadcastToPages(activePages, `Error from page ${data.pageId}: ${data.error}`);
        } else {
            logDebug('RESPONSE', `Successful response from page ${data.pageId}`);
            pendingRequest.resolve(data.result || data);
            broadcastToPages(activePages, `Received successful response from page ${data.pageId}`);
        }
        
        // Clean up pending request
        pendingRequests.delete(data.requestId);
        logDebug('RESPONSE', `Deleted pending request ${data.requestId}, remaining: ${pendingRequests.size}`);
        
        return true;
    } else {
        logDebug('RESPONSE', `No pending request found for ID ${data.requestId}. Current pending: ${Array.from(pendingRequests.keys()).join(', ')}`);
        return false;
    }
};

// Clean up stale pending requests
const cleanupStaleRequests = (onTimeoutCallback) => {
    const now = Date.now();
    const timeout = 30000; // 30 seconds timeout
    
    // Check for timed out requests and call the callback for each one
    for (const [id, request] of pendingRequests.entries()) {
        if (now - request.timestamp > timeout) {
            logDebug('TIMEOUT', `Request ${id} timed out after ${timeout}ms`);
            
            // Call the callback with the timeout information
            if (onTimeoutCallback) {
                onTimeoutCallback(id, request);
            }
            
            // Reject the promise
            if (request.reject) {
                request.reject(new Error(`Request timed out after ${timeout}ms`));
            }
            
            // Remove the timed out request
            pendingRequests.delete(id);
        }
    }
};

export {
    logDebug,
    pendingRequests,
    broadcastToPages,
    executeQueryPage,
    executeModifyPage,
    executeRunSnippet,
    executeListPages,
    handlePageResponse,
    cleanupStaleRequests
}; 