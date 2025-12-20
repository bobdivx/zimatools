# ZimaOS MCP Server

A Model Context Protocol (MCP) server for interacting with your ZimaOS file system and storage. This server allows you to read, write, search, and manage files on your ZimaOS device through Cursor or other MCP-compatible clients.

## Features

### File Management
- 📁 **List directories** - Browse files and folders on your ZimaOS
- 📄 **Read files** - Read file contents from ZimaOS
- ✏️ **Write/Edit files** - Create and modify files on ZimaOS
- 🔍 **Search files** - Search for files by name or content
- 📊 **Get file info** - Retrieve detailed metadata about files and directories
- 📂 **Create directories** - Create new directory structures
- 🗂️ **List allowed directories** - View accessible storage locations

### Docker Container Management
- 🐳 **List Docker containers** - View all Docker containers deployed on ZimaOS
- ▶️ **Start containers** - Start stopped Docker containers
- ⏹️ **Stop containers** - Stop running Docker containers
- 🔄 **Restart containers** - Restart Docker containers
- 📋 **View container logs** - Get logs from Docker containers
- ℹ️ **Get container info** - Retrieve detailed information about containers

## Prerequisites

- Node.js 18+ installed
- Access to a ZimaOS device with API enabled
- ZimaOS API token (obtain from your ZimaOS administration panel)

## Installation

### Option 1: Install from GitHub (Recommended)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/bobdivx/zimaos-cursor-mcp.git
   cd zimaos-cursor-mcp
   ```
   

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

5. Edit `.env` and add your ZimaOS configuration:
   ```env
   ZIMAOS_API_BASE=http://your-zimaos-host.local
   ZIMAOS_API_TOKEN=your-api-token-here
   ```

### Option 2: Use directly with Cursor MCP configuration

You can configure Cursor to use this server directly without installing it globally:

## Configuration

### Cursor MCP Configuration

Add the following to your Cursor MCP configuration file (typically located at `~/.cursor/mcp.json` on macOS/Linux or `C:\Users\<YourUsername>\.cursor\mcp.json` on Windows):

```json
{
  "mcpServers": {
    "zimaos": {
      "command": "node",
      "args": ["<absolute-path-to-zimaos-cursor-mcp>/dist/index.js"],
      "env": {
        "ZIMAOS_API_BASE": "http://your-zimaos-host.local",
        "ZIMAOS_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

**Important:** Replace `<absolute-path-to-zimaos-cursor-mcp>` with the actual path to this repository on your system.

### Environment Variables

- `ZIMAOS_API_BASE` (required): The base URL of your ZimaOS API (e.g., `http://zimacube.local` or `http://192.168.1.100`)
- `ZIMAOS_API_TOKEN` (required): Your ZimaOS API token (obtain from your ZimaOS administration panel)

## Getting Your ZimaOS API Token

1. Access your ZimaOS administration panel
2. Navigate to the API settings or developer section
3. Generate or copy your API token
4. Use this token in your configuration

## Usage

Once configured, the MCP server will be automatically available in Cursor. You can use it to:

- Ask Cursor to list files in a directory on your ZimaOS
- Read files from ZimaOS
- Create or edit files on ZimaOS
- Search for files by name or content
- Get information about files and directories

Example queries you can make to Cursor:

**File Operations:**
- "List all files in /Documents on my ZimaOS"
- "Read the contents of /path/to/file.txt from ZimaOS"
- "Search for files containing 'project' on my ZimaOS"

**Docker Operations:**
- "List all Docker containers on my ZimaOS"
- "Start the Docker container named 'myapp'"
- "Show me the logs from container 'nginx'"
- "Get information about container 'database'"
- "Restart the container with ID abc123"

## Development

### Building the Project

```bash
npm run build
```

### Running in Development Mode

```bash
npm run dev
```

This will compile TypeScript and start the server.

### Project Structure

```
zimaos-cursor-mcp/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── lib/
│   │   └── getAxios.ts       # API client configuration (File, Docker, Storage APIs)
│   ├── tools/                # MCP tools (file and Docker operations)
│   │   ├── *.ts              # File management tools
│   │   ├── ListDockerContainersTool.ts
│   │   ├── StartDockerContainerTool.ts
│   │   ├── StopDockerContainerTool.ts
│   │   ├── RestartDockerContainerTool.ts
│   │   ├── GetDockerContainerLogsTool.ts
│   │   └── GetDockerContainerInfoTool.ts
│   ├── resources/            # MCP resources
│   └── prompts/              # MCP prompts
├── dist/                     # Compiled JavaScript (generated)
├── .env.example              # Example environment configuration
└── package.json
```

## Troubleshooting

### Server won't start

- Verify that `ZIMAOS_API_BASE` and `ZIMAOS_API_TOKEN` are correctly set
- Ensure your ZimaOS device is accessible from your machine
- Check that the API is enabled on your ZimaOS device

### Tools not loading

- Make sure you've run `npm run build` to compile TypeScript
- Verify that the `dist/` directory contains the compiled files
- Check that all dependencies are installed with `npm install`

### Connection errors

- Verify the `ZIMAOS_API_BASE` URL is correct and accessible
- Check your network connectivity to the ZimaOS device
- Ensure the API token is valid and not expired

## Security Notes

⚠️ **Important Security Reminders:**

- **Never commit your `.env` file** - It contains sensitive credentials
- The `.env` file is already in `.gitignore` to prevent accidental commits
- Always use `.env.example` as a template
- Keep your API token secure and rotate it if compromised
- Only share your repository after ensuring no sensitive data is committed

## Publishing to GitHub

If you want to publish this repository:

1. Create a new repository on GitHub named `zimaos-cursor-mcp`

2. Initialize git (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial commit: ZimaOS MCP Server"
   ```

3. Add your GitHub repository as remote:
   ```bash
   git remote add origin https://github.com/bobdivx/zimaos-cursor-mcp.git
   git branch -M main
   git push -u origin main
   ```

4. **Before pushing, double-check:**
   - No `.env` file is included (check `.gitignore`)
   - No hardcoded credentials in any files
   - All sensitive information is removed

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

[Add your license here - consider MIT, Apache 2.0, or another appropriate license]

## Support

For issues and questions, please open an issue on the GitHub repository: https://github.com/bobdivx/zimaos-cursor-mcp/issues
