import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { DEFAULT_GPU_WAIT_MS, gpuArbiter, type GpuEventName, type GpuEventPayload } from "./lib/gpuArbiter.js";
import { listApps, listContainersLegacy } from "./lib/zimaApps.js";
import {
  MCP_CATEGORIES,
  MCP_VERSION,
  mcpPublicUrl,
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

async function mcpStatusPayload(c: { req: { header: (name: string) => string | undefined } }) {
  const mcpPort = Number(process.env.MCP_PORT || 8765);
  const endpoint = process.env.MCP_ENDPOINT || "/mcp";
  const apiPort = Number(process.env.API_PORT || 8766);
  const probe = await probeMcpHttp(mcpPort, endpoint);
  const hostname = requestHostname(c);
  const url = mcpPublicUrl(c, endpoint, hostname, mcpPort);
  return {
    ok: true,
    service: "zimatools",
    version: MCP_VERSION,
    health: healthPayload(),
    rest: {
      port: apiPort,
      path: "/health",
      reachable: true,
      publicPath: "/health",
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

function parseTimeoutMs(value: unknown, fallback = DEFAULT_GPU_WAIT_MS) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseOptionalBool(value: unknown): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const s = String(value).toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return undefined;
}

function sseVisible(filter: string | undefined, event: GpuEventName, payload: GpuEventPayload) {
  if (!filter) return true;
  if (payload.client && payload.client === filter) return true;
  if (event === "granted" || event === "released" || event === "preempted") return true;
  return false;
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

  app.get("/api/mcp", async (c) => c.json(await mcpStatusPayload(c)));
  app.get("/api/mcp/tools", async (c) => c.json(await mcpStatusPayload(c)));

  app.get("/api/gpu/status", async (c) => c.json(await gpuArbiter.status()));

  app.get("/api/gpu/queue", (c) => c.json(gpuArbiter.queueList()));

  app.post("/api/gpu/acquire", async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const client = String(body.client || "unknown");
    const ttlSeconds = parseOptionalNumber(body.ttlSeconds);
    const vramMiB = parseOptionalNumber(body.vramMiB);
    const exclusive = parseOptionalBool(body.exclusive);
    const wait = Boolean(body.wait);
    const timeoutMs = parseTimeoutMs(body.timeoutMs ?? (body.timeoutSeconds != null ? Number(body.timeoutSeconds) * 1000 : undefined));
    const result = wait
      ? await gpuArbiter.waitForGrant(client, timeoutMs, { ttlSeconds, vramMiB, exclusive })
      : await gpuArbiter.acquire(client, ttlSeconds, { vramMiB, exclusive });
    if (!result.granted && result.reason === "timeout") {
      return c.json(result, 408);
    }
    return c.json(result);
  });

  app.get("/api/gpu/wait", async (c) => {
    const client = String(c.req.query("client") || "unknown");
    const timeoutMs = parseTimeoutMs(c.req.query("timeoutMs"));
    const ttlSeconds = parseOptionalNumber(c.req.query("ttlSeconds"));
    const vramMiB = parseOptionalNumber(c.req.query("vramMiB"));
    const exclusive = parseOptionalBool(c.req.query("exclusive"));
    const result = await gpuArbiter.waitForGrant(client, timeoutMs, { ttlSeconds, vramMiB, exclusive });
    if (!result.granted && result.reason === "timeout") {
      return c.json(result, 408);
    }
    return c.json(result);
  });

  app.get("/api/gpu/events", (c) => {
    const filter = c.req.query("client") || undefined;
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache, no-transform");
    return streamSSE(c, async (stream) => {
      const unsub = gpuArbiter.subscribe((event, payload) => {
        if (stream.closed || stream.aborted) return;
        if (!sseVisible(filter, event, payload)) return;
        void stream.writeSSE({ event, data: JSON.stringify(payload) });
      });
      const stop = new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
        const sig = c.req.raw.signal;
        if (sig.aborted) resolve();
        else sig.addEventListener("abort", () => resolve(), { once: true });
      });
      const heartbeat = (async () => {
        while (!stream.closed && !stream.aborted) {
          await stream.write(": heartbeat\n\n");
          await stream.sleep(15_000);
        }
      })();
      await Promise.race([stop, heartbeat]);
      unsub();
    });
  });

  app.post("/api/gpu/release", async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    return c.json(
      await gpuArbiter.release({
        leaseId: body.leaseId ? String(body.leaseId) : undefined,
        client: body.client ? String(body.client) : undefined,
      }),
    );
  });

  app.post("/api/gpu/priority", async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
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
