// Global state
let isActive = false;
let ws = null;
let pageId = null;
let feedbackUI = null;
let activityWindow = null;
let activityList = null;
let activities = [];

// Enhanced logging
const logDebug = (component, message, data = null) => {
  const timestamp = new Date().toISOString();
  const dataStr = data ? JSON.stringify(data, null, 2) : '';
  console.log(`[DEBUG][${timestamp}][${component}] ${message}${dataStr ? '\n' + dataStr : ''}`);
  
  // Also add to activity log if UI is available
  if (isActive && activityList) {
    addActivity(`[${component}] ${message}${data ? ': ' + JSON.stringify(data) : ''}`, 'debug');
  }
};

// Create a visual feedback element to show changes
const createFeedbackUI = () => {
  const container = document.createElement('div');
  container.id = 'ai-editor-observer-feedback';
  container.style = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 10px;
    border-radius: 5px;
    z-index: 10000;
    font-family: monospace;
    max-width: 400px;
    max-height: 300px;
    overflow: auto;
    transition: opacity 0.3s;
    display: none;
  `;
  document.body.appendChild(container);
  return container;
};

// Create an activity window to show extension history
const createActivityWindow = () => {
  const container = document.createElement('div');
  container.id = 'ai-editor-observer-activity';
  container.style = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 15px;
    border-radius: 8px;
    z-index: 10000;
    font-family: monospace;
    width: 400px;
    max-height: 600px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    display: none;
  `;

  // Add header
  const header = document.createElement('div');
  header.style = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  `;
  
  const title = document.createElement('div');
  title.textContent = 'AI Editor Observer Activity';
  title.style = `
    font-weight: bold;
    font-size: 14px;
  `;

  const controls = document.createElement('div');
  controls.style = 'display: flex; gap: 10px;';

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style = `
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  `;
  clearBtn.onclick = () => {
    activityList.innerHTML = '';
    activities = [];
  };

  // Minimize button
  const minimizeBtn = document.createElement('button');
  minimizeBtn.textContent = '−';
  minimizeBtn.style = `
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    width: 25px;
  `;
  minimizeBtn.onclick = () => {
    activityList.style.display = activityList.style.display === 'none' ? 'block' : 'none';
    minimizeBtn.textContent = activityList.style.display === 'none' ? '+' : '−';
  };

  controls.appendChild(clearBtn);
  controls.appendChild(minimizeBtn);
  header.appendChild(title);
  header.appendChild(controls);
  container.appendChild(header);

  // Activity list
  const activityList = document.createElement('div');
  activityList.id = 'ai-editor-observer-activity-list';
  activityList.style = `
    overflow-y: auto;
    max-height: 500px;
    font-size: 12px;
  `;
  container.appendChild(activityList);

  document.body.appendChild(container);
  return { container, activityList };
};

// Create UI elements but keep them hidden
const initializeUI = () => {
  feedbackUI = createFeedbackUI();
  const activityElements = createActivityWindow();
  activityWindow = activityElements.container;
  activityList = activityElements.activityList;
};

// Initialize UI on page load
initializeUI();

// Add activity to the list
const addActivity = (message, type = 'info') => {
  if (!isActive || !activityList) return;
  
  const timestamp = new Date().toLocaleTimeString();
  const activity = {
    timestamp,
    message,
    type
  };
  activities.push(activity);

  const item = document.createElement('div');
  item.style = `
    margin-bottom: 8px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.05);
    border-left: 3px solid ${
      type === 'success' ? '#4CAF50' : 
      type === 'error' ? '#F44336' : 
      type === 'debug' ? '#FF9800' : 
      '#2196F3'
    };
    border-radius: 4px;
  `;

  const timeSpan = document.createElement('span');
  timeSpan.textContent = timestamp;
  timeSpan.style = 'color: #888; margin-right: 8px; font-size: 11px;';
  
  const messageSpan = document.createElement('span');
  messageSpan.textContent = message;

  item.appendChild(timeSpan);
  item.appendChild(messageSpan);
  activityList.appendChild(item);
  activityList.scrollTop = activityList.scrollHeight;

  // Keep only last 100 activities
  if (activities.length > 100) {
    activities.shift();
    if (activityList.firstChild) {
      activityList.removeChild(activityList.firstChild);
    }
  }
};

// Generate a unique page ID
const generatePageId = () => {
  return `page_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
};

// Show feedback in the UI
const showFeedback = (message, type = 'info') => {
  if (!isActive) return;
  
  const item = document.createElement('div');
  item.style = `
    margin-bottom: 5px;
    padding: 5px;
    border-left: 3px solid ${type === 'success' ? '#4CAF50' : type === 'error' ? '#F44336' : '#2196F3'};
  `;
  item.textContent = message;
  
  feedbackUI.appendChild(item);
  feedbackUI.scrollTop = feedbackUI.scrollHeight;
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (feedbackUI && feedbackUI.contains(item)) {
      item.style.opacity = '0';
      setTimeout(() => item.remove(), 300);
    }
  }, 5000);
};

// Connect to MCP server
const connectWebSocket = () => {
  if (ws) {
    // Close existing connection
    ws.close();
  }
  
  logDebug('WS', 'Connecting to MCP server');
  ws = new WebSocket('ws://localhost:3001');
  
  ws.onopen = () => {
    logDebug('WS', 'Connected to MCP server');
    showFeedback('Connected to MCP server', 'success');
    addActivity('Connected to MCP server', 'success');
    
    // Generate page ID if not already set
    if (!pageId) {
      pageId = generatePageId();
      logDebug('PAGE', `Generated page ID: ${pageId}`);
    }
    
    // Register this page with the MCP server
    const registrationData = {
      type: 'page_connected',
      pageId: pageId,
      url: window.location.href,
      title: document.title
    };
    
    logDebug('PAGE', 'Registering page with MCP server', registrationData);
    ws.send(JSON.stringify(registrationData));
    addActivity(`Registered page with ID: ${pageId}`, 'success');
  };
  
  ws.onclose = () => {
    logDebug('WS', 'Disconnected from MCP server');
    showFeedback('Disconnected from MCP server', 'error');
    addActivity('Disconnected from MCP server', 'error');
    
    // Only try to reconnect if still active
    if (isActive) {
      logDebug('WS', 'Will attempt reconnection in 5 seconds');
      // Try to reconnect after 5 seconds
      setTimeout(connectWebSocket, 5000);
    }
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      logDebug('WS_MESSAGE', 'Received message from MCP server', data);
      
      if (data.type === 'activity') {
        // Handle activity messages from MCP server
        logDebug('ACTIVITY', data.message);
        addActivity(data.message, 'info');
      } else if (data.command) {
        logDebug('COMMAND', `Received command: ${data.command}`, data.params);
        addActivity(`Received command: ${data.command}`, 'info');
        handleCommand(data);
      } else {
        logDebug('UNKNOWN', 'Received unknown message type', data);
        addActivity(`Received unknown message type: ${JSON.stringify(data)}`, 'error');
      }
    } catch (error) {
      logDebug('ERROR', `Error processing message: ${error.message}`);
      console.error('Error processing message:', error);
      addActivity(`Error processing message: ${error.message}`, 'error');
    }
  };

  ws.onerror = (error) => {
    logDebug('ERROR', `WebSocket error: ${error.message || 'Unknown error'}`);
    console.error('WebSocket error:', error);
    showFeedback('WebSocket error', 'error');
    addActivity(`WebSocket error: ${error.message || 'Unknown error'}`, 'error');
  };
};

// Activate the extension
const activate = () => {
  if (isActive) return;
  
  isActive = true;
  
  // Show UI elements
  feedbackUI.style.display = 'block';
  activityWindow.style.display = 'flex';
  
  // Connect to MCP server
  connectWebSocket();
  
  showFeedback('AI Editor Web Observer activated', 'success');
  addActivity('Extension activated', 'success');
  addActivity(`Page URL: ${window.location.href}`, 'info');
  addActivity(`Page title: ${document.title}`, 'info');
};

// Deactivate the extension
const deactivate = () => {
  if (!isActive) return;
  
  isActive = false;
  
  // Close WebSocket connection
  if (ws) {
    ws.close();
    ws = null;
  }
  
  // Hide UI elements
  feedbackUI.style.display = 'none';
  activityWindow.style.display = 'none';
  
  // Clear page ID
  pageId = null;
};

// Send response back to MCP server
const sendResponse = (data, requestId) => {
  if (!isActive || !ws) {
    logDebug('RESPONSE', 'Cannot send response - inactive or no connection', { requestId });
    return;
  }
  
  if (ws.readyState === WebSocket.OPEN) {
    const response = {
      type: 'response',
      pageId: pageId,
      requestId: requestId,
      ...data
    };
    
    logDebug('RESPONSE', `Sending response for request ${requestId}`, response);
    ws.send(JSON.stringify(response));
    addActivity(`Sent response for request ${requestId}`, 'success');
  } else {
    logDebug('RESPONSE', `Cannot send response - WebSocket not open (state: ${ws.readyState})`, { requestId });
    addActivity(`Failed to send response for request ${requestId} - connection not open`, 'error');
  }
};

// Handle commands from the MCP server
const handleCommand = async (data) => {
  if (!isActive) {
    logDebug('COMMAND', 'Ignoring command - extension inactive', data);
    return;
  }
  
  const { command, params, id } = data;
  logDebug('COMMAND', `Handling command: ${command}`, { params, id });
  addActivity(`Handling command: ${command}`, 'info');
  
  try {
    let response = { success: true };
    
    switch (command) {
      case 'query_page':
        logDebug('QUERY', `Querying elements with selector: ${params.selector}`);
        // Find elements using a selector
        const elements = Array.from(document.querySelectorAll(params.selector));
        response.elements = elements.map(el => ({
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          textContent: el.textContent?.substring(0, 100),
          attributes: getElementAttributes(el)
        }));
        logDebug('QUERY', `Found ${elements.length} elements`);
        addActivity(`Found ${elements.length} elements matching "${params.selector}"`, 'success');
        break;
        
      case 'modify_page':
        logDebug('MODIFY', 'Modifying DOM elements', params);
        // Modify DOM elements
        const { selector, operation, value } = params;
        const targetElements = document.querySelectorAll(selector);
        logDebug('MODIFY', `Found ${targetElements.length} elements to modify`);
        
        targetElements.forEach(el => {
          if (operation === 'setAttribute') {
            const [attr, val] = value.split('=');
            logDebug('MODIFY', `Setting attribute ${attr}=${val}`);
            el.setAttribute(attr, val);
          } else if (operation === 'setProperty') {
            const [prop, val] = value.split('=');
            logDebug('MODIFY', `Setting property ${prop}=${val}`);
            el[prop] = val;
          } else if (operation === 'setInnerHTML') {
            logDebug('MODIFY', 'Setting innerHTML');
            el.innerHTML = value;
          } else if (operation === 'setTextContent') {
            logDebug('MODIFY', 'Setting textContent');
            el.textContent = value;
          }
        });
        response.modifiedCount = targetElements.length;
        logDebug('MODIFY', `Modified ${targetElements.length} elements`);
        addActivity(`Modified ${targetElements.length} elements: ${operation}`, 'success');
        break;
        
      case 'run_snippet':
        logDebug('SNIPPET', 'Executing JavaScript snippet', { codeLength: params.code.length });
        addActivity(`Executing JavaScript snippet (${params.code.length} characters)`, 'info');
        
        try {
          // Execute the code and capture the result
          const snippetResult = await executeCodeSnippet(params.code);
          
          // Handle different types of results
          let serializedResult;
          try {
            // Try to stringify the result
            serializedResult = JSON.stringify(snippetResult);
            logDebug('SNIPPET', 'Snippet execution successful, result stringified', { 
              resultLength: serializedResult.length 
            });
          } catch (serializationError) {
            // If the result contains circular references or non-serializable items
            serializedResult = JSON.stringify({
              type: typeof snippetResult,
              summary: `Result could not be fully serialized: ${serializationError.message}`,
              preview: String(snippetResult).substring(0, 500)
            });
            logDebug('SNIPPET', 'Snippet result serialization issue', { 
              error: serializationError.message 
            });
          }
          
          response.result = snippetResult;
          response.serialized = serializedResult;
          addActivity(`Snippet executed successfully`, 'success');
        } catch (snippetError) {
          logDebug('SNIPPET_ERROR', 'Error executing snippet', { error: snippetError.message });
          addActivity(`Error executing snippet: ${snippetError.message}`, 'error');
          throw new Error(`Script execution failed: ${snippetError.message}`);
        }
        break;
        
      default:
        const errorMsg = `Unknown command: ${command}`;
        logDebug('ERROR', errorMsg);
        throw new Error(errorMsg);
    }
    
    logDebug('COMMAND', `Command ${command} completed successfully`, response);
    sendResponse(response, id);
  } catch (error) {
    const errorMsg = `Error executing command ${command}: ${error.message}`;
    logDebug('ERROR', errorMsg, error);
    console.error(errorMsg, error);
    addActivity(`Error: ${error.message}`, 'error');
    sendResponse({ error: error.message }, id);
  }
};

// Execute code safely in the page context
const executeCodeSnippet = (code) => {
  return new Promise((resolve, reject) => {
    try {
      // Create a safe wrapper to evaluate the code
      logDebug('SNIPPET', 'Creating async function wrapper for code execution');
      
      // Create an async function wrapper to properly handle promises
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      
      // Wrapping code in async function to handle both sync and async code
      const wrappedCode = `
        try {
          // Original code
          ${code}
        } catch (error) {
          return { error: error.message, stack: error.stack };
        }
      `;
      
      // Create and execute the function
      const executeFunction = new AsyncFunction(wrappedCode);
      logDebug('SNIPPET', 'Executing snippet in async wrapper');
      
      // Execute and handle result
      Promise.resolve(executeFunction())
        .then(result => {
          logDebug('SNIPPET', 'Snippet execution completed');
          
          // Check if it's an error result
          if (result && result.error && result.stack) {
            reject(new Error(`${result.error}\n${result.stack}`));
            return;
          }
          
          resolve(result);
        })
        .catch(error => {
          logDebug('SNIPPET_ERROR', 'Async error in snippet execution', {
            message: error.message,
            stack: error.stack
          });
          reject(error);
        });
    } catch (error) {
      logDebug('SNIPPET_ERROR', 'Error setting up snippet execution', {
        message: error.message,
        stack: error.stack
      });
      reject(error);
    }
  });
};

// Helper to get element attributes
const getElementAttributes = (element) => {
  const result = {};
  Array.from(element.attributes).forEach(attr => {
    result[attr.name] = attr.value;
  });
  return result;
};

// Show a simple notification 
const showNotification = (message) => {
  const notification = document.createElement('div');
  notification.style = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    z-index: 10001;
    font-family: sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    transition: opacity 0.3s, transform 0.3s;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Animate in
  notification.style.opacity = '0';
  notification.style.transform = 'translateX(-50%) translateY(-20px)';
  setTimeout(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateX(-50%) translateY(0)';
  }, 10);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(-50%) translateY(-20px)';
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, 3000);
};

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'activate') {
    activate();
    sendResponse({ status: 'activated' });
  } else if (message.action === 'deactivate') {
    deactivate();
    sendResponse({ status: 'deactivated' });
  } else if (message.action === 'ping') {
    // Just respond to confirm content script is loaded
    sendResponse({ status: 'alive' });
  } else if (message.action === 'showNotification') {
    showNotification(message.message);
    sendResponse({ status: 'notification shown' });
  }
  return true; // Keep the message channel open for async responses
}); 