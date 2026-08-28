import { MCPServer } from "mcp-framework";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { startHttpApi } from "./httpApi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const name = "zimatools";
const version = "0.1.0";

if (!process.env.ZIMAOS_API_BASE) {
  console.warn("[zimatools] ZIMAOS_API_BASE non defini — outils fichiers ZimaOS indisponibles.");
}

if (!process.env.ZIMAOS_API_TOKEN) {
  console.warn("[zimatools] ZIMAOS_API_TOKEN non defini — outils fichiers ZimaOS indisponibles.");
}

const transportMode = (
  process.env.MCP_TRANSPORT || (process.argv.includes("--stdio") ? "stdio" : "http")
).toLowerCase();

const mcpPort = Number(process.env.MCP_PORT || 8765);
const mcpHost = process.env.MCP_HOST || "0.0.0.0";
const mcpEndpoint = process.env.MCP_ENDPOINT || "/mcp";

const transport =
  transportMode === "stdio"
    ? { type: "stdio" as const }
    : {
        type: "http-stream" as const,
        options: {
          port: mcpPort,
          host: mcpHost,
          endpoint: mcpEndpoint,
          responseMode: (process.env.MCP_RESPONSE_MODE as "batch" | "stream") || "stream",
          cors: {
            allowOrigin: process.env.MCP_CORS_ORIGIN || "*",
          },
        },
      };

const server = new MCPServer({
  name,
  version,
  basePath: __dirname,
  transport,
});

const apiPort = Number(process.env.API_PORT || 8766);

async function main() {
  if (transportMode !== "stdio") {
    startHttpApi(apiPort);
    console.log(`[zimatools] MCP HTTP stream: http://${mcpHost}:${mcpPort}${mcpEndpoint}`);
    console.log(`[zimatools] REST API:        http://0.0.0.0:${apiPort}/api`);
  } else {
    console.error("[zimatools] MCP stdio pret (Cursor local).");
  }
  await server.start();
}

main().catch((error) => {
  console.error("Erreur lors du demarrage du serveur:", error);
  process.exit(1);
});
