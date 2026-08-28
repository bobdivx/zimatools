import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { gpuArbiter } from "./lib/gpuArbiter.js";
import { listApps, listContainersLegacy } from "./lib/zimaApps.js";
import {
  MCP_CATEGORIES,
  MCP_VERSION,
  mcpUrlForHost,
  probeMcpHttp,
} from "./lib/mcpCatalog.js";

function requestHostname(c: { req: { header: (name: string) => string | undefined } }): string {
  const origin = c.req.header("origin") || c.req.header("referer") || "";
  try {
    if (origin) return new URL(origin).hostname;
  } catch {
    /* ignore */
  }
  const host = c.req.header("x-forwarded-host") || c.req.header("host") || "";
  return host.split(":")[0] || "127.0.0.1";
}

function healthPayload() {
  const mcpPort = Number(process.env.MCP_PORT || 8765);
  const endpoint = process.env.MCP_ENDPOINT || "/mcp";
  return {
    ok: true,
    service: "zimatools",
    version: MCP_VERSION,
    mcp: {
      transport: "http-stream",
      endpoint,
      port: mcpPort,
    },
  };
}

async function mcpStatusPayload(hostname: string) {
  const mcpPort = Number(process.env.MCP_PORT || 8765);
  const endpoint = process.env.MCP_ENDPOINT || "/mcp";
  const apiPort = Number(process.env.API_PORT || 8766);
  const probe = await probeMcpHttp(mcpPort, endpoint);
  const url = mcpUrlForHost(hostname, mcpPort, endpoint);
  return {
    ok: true,
    service: "zimatools",
    version: MCP_VERSION,
    health: healthPayload(),
    rest: {
      port: apiPort,
      path: "/health",
      reachable: true,
    },
    mcp: {
      transport: "http-stream",
      host: process.env.MCP_HOST || "0.0.0.0",
      port: mcpPort,
      endpoint,
      url,
      reachable: probe.reachable,
      status: probe.status,
      error: probe.error,
    },
    stdio: {
      command: "node",
      args: ["<chemin>/apps/mcp/dist/index.js", "--stdio"],
    },
    configs: {
      cursorHttp: {
        mcpServers: {
          zimatools: { url },
        },
      },
      cursorStdio: {
        mcpServers: {
          zimatools: {
            command: "node",
            args: ["<chemin>/apps/mcp/dist/index.js", "--stdio"],
          },
        },
      },
    },
    categories: MCP_CATEGORIES,
    tools: MCP_CATEGORIES.flatMap((cat) =>
      cat.tools.map((tool) => ({ ...tool, category: cat.id })),
    ),
  };
}

export function startHttpApi(port: number) {
  const app = new Hono();
  const origin = process.env.API_CORS_ORIGIN || "*";

  app.use(
    "*",
    cors({
      origin,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.get("/health", (c) => c.json(healthPayload()));

  app.get("/api/mcp", async (c) => c.json(await mcpStatusPayload(requestHostname(c))));
  app.get("/api/mcp/tools", async (c) => c.json(await mcpStatusPayload(requestHostname(c))));

  app.get("/api/gpu/status", async (c) => c.json(await gpuArbiter.status()));

  app.get("/api/gpu/queue", (c) => c.json(gpuArbiter.queueList()));

  app.post("/api/gpu/acquire", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const client = String(body.client || "unknown");
    const ttlSeconds = body.ttlSeconds != null ? Number(body.ttlSeconds) : undefined;
    return c.json(gpuArbiter.acquire(client, ttlSeconds));
  });

  app.post("/api/gpu/release", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(
      gpuArbiter.release({
        leaseId: body.leaseId ? String(body.leaseId) : undefined,
        client: body.client ? String(body.client) : undefined,
      }),
    );
  });

  app.post("/api/gpu/priority", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const client = String(body.client || "");
    const priority = Number(body.priority);
    if (!client || Number.isNaN(priority)) {
      return c.json({ error: "client and priority required" }, 400);
    }
    return c.json(gpuArbiter.setPriority(client, priority));
  });

  app.get("/api/apps", async (c) => {
    const listed = await listApps();
    return c.json(listed);
  });

  app.get("/api/docker/containers", async (c) => {
    const listed = await listContainersLegacy();
    return c.json(listed);
  });

  serve({ fetch: app.fetch, port, hostname: process.env.API_HOST || "0.0.0.0" }, (info) => {
    console.log(`[zimatools] REST API listening on http://${info.address}:${info.port}`);
  });

  return app;
}
