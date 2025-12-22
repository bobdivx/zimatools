import { MCPServer } from "mcp-framework";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Validate required environment variables
if (!process.env.ZIMAOS_API_BASE) {
  console.error("Error: ZIMAOS_API_BASE environment variable is required");
  console.error("Please set it in your .env file or in the MCP server configuration");
  process.exit(1);
}

if (!process.env.ZIMAOS_API_TOKEN) {
  console.error("Error: ZIMAOS_API_TOKEN environment variable is required");
  console.error("Please set it in your .env file or in the MCP server configuration");
  process.exit(1);
}

// Obtenir le répertoire dist pour que le framework puisse charger les outils automatiquement
// Quand le code est compilé, __dirname pointe vers dist/
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const server = new MCPServer({
  name: "zimaos-mcp",
  version: "0.0.2",
  basePath: __dirname, // Le framework cherchera les outils dans basePath/tools (donc dist/tools)
});

server.start().catch((error) => {
  console.error("Erreur lors du démarrage du serveur:", error);
  process.exit(1);
});