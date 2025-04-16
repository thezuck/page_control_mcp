# Page Control MCP Server and Chrome Extension

This project consists of two main components:
1. A Node.js MCP server that communicates with an AI editor such as Zencoder or Cursor
2. A Chrome extension that controls web pages

## MCP Server Setup

### Prerequisites
- Node.js (v14 or higher)
- npm (Node Package Manager)

### Installation
1. Navigate to the MCP server directory:
   ```bash
   cd mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

The server will start on port 4000 and the WebSocket server on port 3001.

### Zencoder Configuration
Open Zencoder settings => MCP servers
and paste the following configuration:
```json
{
    "page-control": {
        "command": "npm",
        "args": ["start"],
        "cwd": "mcp-server"
    }
}
```

### Cursor Configuration
1. Create or update the `.cursor/mcp.json` file in your home directory:
   ```json
   {
     "mcpServers": {
       "page-control": {
         "url": "http://localhost:4000/page-control"
       }
     }
   }
   ```

2. Restart Cursor to apply the configuration.

### Available Tools
The MCP server provides the following tools:

1. `query_page`: Query elements on a web page
   ```bash
   /page-control query_page pageId="page_123456" selector=".my-class"
   ```

2. `modify_page`: Modify elements on a web page
   ```bash
   /page-control modify_page targetPage="page_123456" modification='{"selector":".my-class","operation":"setTextContent","value":"New Text"}'
   ```

3. `run_snippet`: Execute JavaScript code in the page context
   ```bash
   /page-control run_snippet pageId="page_123456" code="return document.title;"
   ```

4. `list_pages`: List all connected pages
   ```bash
   /page-control list_pages
   ```

## Chrome Extension Setup

### Prerequisites
- Google Chrome browser
- Developer mode enabled in Chrome

### Installation
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked" and select the `extension` directory from this project

### Usage
1. Click the extension icon in the Chrome toolbar to activate it on the current page
2. A confirmation dialog will appear - click "OK" to activate
3. The extension will connect to the MCP server and display a control panel
4. The extension will automatically deactivate when:
   - The page is refreshed
   - The tab is closed
   - The extension icon is clicked again

### Features
- Real-time page control through AI editor
- Visual feedback for actions
- Activity logging
- Automatic reconnection
- Secure code execution

### Development
To modify the extension:
1. Make changes to the files in the `extension` directory
2. Go to `chrome://extensions/`
3. Find the extension and click the refresh icon
4. The changes will be applied immediately

### File Structure
```
.
├── mcp-server/
│   ├── server.js          # Main MCP server
│   ├── package.json       # Server dependencies
│   └── ...
├── extension/
│   ├── manifest.json      # Extension configuration
│   ├── background.js      # Background script
│   ├── content.js         # Content script
│   └── ...
└── README.md              # This file
```

## Troubleshooting

### MCP Server Issues
1. If the server fails to start:
   - Check if port 4000 is available
   - Verify Node.js installation
   - Check npm dependencies

2. If AI editor can't connect:
   - Verify the MCP server is running
   - Check the configuration (`.cursor/mcp.json` for Cursor or Zencoder settings)
   - Restart the AI editor

### Extension Issues
1. If the extension doesn't load:
   - Verify Developer mode is enabled
   - Check for manifest errors
   - Try reloading the extension

2. If the extension doesn't connect:
   - Verify the MCP server is running
   - Check the WebSocket connection
   - Try deactivating and reactivating the extension

## Security Notes
- The extension only runs on pages where explicitly activated
- Code execution is sandboxed
- WebSocket connections are limited to localhost
- All actions require user confirmation

## License
MIT License - See LICENSE file for details 