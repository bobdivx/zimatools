import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { gpuArbiter } from "./lib/gpuArbiter.js";
import { DockerSSH } from "./lib/dockerSSH.js";

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

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "zimatools",
      version: "0.1.0",
      mcp: {
        transport: "http-stream",
        endpoint: process.env.MCP_ENDPOINT || "/mcp",
        port: Number(process.env.MCP_PORT || 8765),
      },
    }),
  );

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

  app.get("/api/docker/containers", async (c) => {
    try {
      const containers = await DockerSSH.listContainers();
      return c.json({ stub: false, containers });
    } catch (error: any) {
      return c.json({
        stub: true,
        containers: [],
        error: error?.message || String(error),
      });
    }
  });

  serve({ fetch: app.fetch, port, hostname: process.env.API_HOST || "0.0.0.0" }, (info) => {
    console.log(`[zimatools] REST API listening on http://${info.address}:${info.port}`);
  });

  return app;
}
