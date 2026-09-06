import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "dist");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const API_UPSTREAM = (process.env.API_UPSTREAM || "http://mcp:8766").replace(/\/$/, "");
const MCP_UPSTREAM = (process.env.MCP_UPSTREAM || "http://mcp:8765").replace(/\/$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

function stripLeadingSlashes(value) {
  let out = value;
  while (out.startsWith("/")) out = out.slice(1);
  return out;
}

function safeJoin(root, reqPath) {
  const decoded = stripLeadingSlashes(decodeURIComponent((reqPath || "/").split("?")[0]));
  const joined = path.normalize(path.join(root, decoded));
  if (!joined.startsWith(root)) return null;
  return joined;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const stream = fs.createReadStream(file);
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  });
  stream.on("error", () => send(res, 500, "read error"));
  stream.pipe(res);
}

function resolveFile(urlPath) {
  let pathname = urlPath;
  if (!pathname || pathname === "/") pathname = "/index.html";
  const target = safeJoin(DIST, pathname);
  if (!target) return null;
  try {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      const idx = path.join(target, "index.html");
      if (fs.existsSync(idx)) return idx;
    }
    const asHtml = target + ".html";
    if (fs.existsSync(asHtml)) return asHtml;
    const asDir = path.join(target, "index.html");
    if (fs.existsSync(asDir)) return asDir;
  } catch {
    return null;
  }
  return null;
}

function shouldProxyMcp(req, pathname) {
  if (pathname !== "/mcp" && !pathname.startsWith("/mcp/")) return false;
  const method = (req.method || "GET").toUpperCase();
  // Streamable HTTP: POST/DELETE/OPTIONS always go to the MCP server.
  if (method === "POST" || method === "DELETE" || method === "OPTIONS") return true;
  if (method === "GET" || method === "HEAD") {
    const accept = String(req.headers.accept || "");
    const session = req.headers["mcp-session-id"] || req.headers["Mcp-Session-Id"];
    if (session) return true;
    if (accept.includes("text/event-stream")) return true;
    // Prefer the HTML setup page for browsers / plain GET.
    if (accept.includes("text/html")) return false;
    if (accept.includes("application/json") && !accept.includes("text/html")) return true;
    return false;
  }
  return true;
}

function proxyTarget(pathname, req) {
  if (pathname === "/health" || pathname === "/api" || pathname.startsWith("/api/")) {
    return API_UPSTREAM;
  }
  if (shouldProxyMcp(req, pathname)) {
    return MCP_UPSTREAM;
  }
  return null;
}

function proxyRequest(req, res, upstreamBase) {
  const upstream = new URL(req.url || "/", upstreamBase);
  const headers = { ...req.headers, host: upstream.host };
  delete headers["content-length"];

  const proxyReq = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === "https:" ? 443 : 80),
      path: upstream.pathname + upstream.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    send(res, 502, `Upstream error (${upstreamBase}): ${err.message}`, {
      "Content-Type": "text/plain; charset=utf-8",
    });
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
  const upstream = proxyTarget(url.pathname, req);

  if (upstream) {
    proxyRequest(req, res, upstream);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method Not Allowed");
    return;
  }

  const file = resolveFile(url.pathname);
  if (!file) {
    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  if (req.method === "HEAD") {
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end();
    return;
  }
  sendFile(res, file);
});

server.listen(PORT, HOST, () => {
  console.log(
    `[zimatools] static web on http://${HOST}:${PORT} (dist=${DIST}, api=${API_UPSTREAM}, mcp=${MCP_UPSTREAM})`,
  );
});
