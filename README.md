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
Create or update the `.cursor/mcp.json` file in your home directory or update through cursor MCP serttings:
   ```json
   {
     "mcpServers": {
       "page-control": {
         "url": "http://localhost:4000/page-control"
       }
     }
   }
   ```

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

### If the AI agent doesn't use the new MCP capabilities, you might need to notify it about these new capabilities, use the following prompt:
```
you now have the ability to use a new MCP server capabilities, it is called page-control, it has the following capabilities:
The MCP server provides the following tools:

query_page: Query elements on a web page
/page-control query_page pageId="page_123456" selector=".my-class"

modify_page: Modify elements on a web page
/page-control modify_page targetPage="page_123456" modification='{"selector":".my-class","operation":"setTextContent","value":"New Text"}'

run_snippet: Execute JavaScript code in the page context
/page-control run_snippet pageId="page_123456" code="return document.title;"

list_pages: List all connected pages
/page-control list_pages

please keep this in memory so you do not forget
```

## Security Notes
- The extension only runs on pages where explicitly activated
- Code execution is sandboxed
- WebSocket connections are limited to localhost
- All actions require user confirmation

## License
MIT License - See LICENSE file for details

# MCP Demo Server

This repository contains a demonstration of the Model Context Protocol (MCP) server.

## Setup and Running Options

### Option 1: Standalone Script (Recommended)

The simplest way to run the MCP demo server is using the standalone script, which automatically creates a temporary virtual environment and installs all dependencies:

```bash
python mcp-server/standalone_mcp_demo.py
```

This script:
1. Uses pipx to create an isolated environment
2. Installs the MCP package in that environment
3. Runs the demo server

No manual installation or setup required!

### Option 2: Using a Virtual Environment

1. Create a virtual environment and activate it:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install the dependencies:

```bash
pip install -r requirements.txt
```

3. Run the server:

```bash
python mcp-server/demo-mcp-stdio.py
```

### Option 3: System-wide Installation

If you can't or don't want to use a virtual environment, you can install the package system-wide:

```bash
pip3 install mcp --break-system-packages
```

Note: Using the `--break-system-packages` flag is generally not recommended for production environments as it bypasses Python's safeguards against system package conflicts.

## MCP Server Communication

The MCP server communicates using a specific JSON-RPC format. It doesn't accept arbitrary input - it needs properly formatted MCP protocol messages.

The server is designed to be used with an MCP client like Claude Desktop, not directly from the command line. However, for debugging purposes, you could use proper MCP protocol messages, for example:

```bash
# Initialize the connection
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.3.0","capabilities":{},"clientInfo":{"name":"TestClient","version":"1.0.0"}}}' | python mcp-server/demo-mcp-stdio.py

# List available tools
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | python mcp-server/demo-mcp-stdio.py 

# Call the add tool
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"add","arguments":{"a":2,"b":3}}}' | python mcp-server/demo-mcp-stdio.py
```

## Demo Server Features

The demo server provides:

- A simple tool to add two numbers
- A resource that returns a greeting for a given name

## IDE Integration

If your IDE shows an error "Import 'mcp.server.fastmcp' could not be resolved", you have several options:

1. Configure your IDE to use the Python interpreter from the virtual environment
2. Install the package system-wide as described in Option 3 above
3. Use the standalone script which doesn't require any configuration

## Connecting with Claude or other MCP Clients

To use this MCP server with Claude Desktop or another MCP client:

1. Make sure the server script is properly set up
2. Configure the client to connect to the server
3. The client will handle the proper MCP protocol communication 