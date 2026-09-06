import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "dist");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const API_UPSTREAM = (process.env.API_UPSTREAM || "http://mcp:8766").replace(/\/$/, "");

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

function shouldProxy(pathname) {
  return pathname === "/health" || pathname.startsWith("/api/") || pathname === "/api";
}

function proxyApi(req, res) {
  const upstream = new URL(req.url || "/", API_UPSTREAM);
  const headers = { ...req.headers, host: upstream.host };
  delete headers["content-length"];

  const proxyReq = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || 80,
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
    send(res, 502, `API upstream error: ${err.message}`, {
      "Content-Type": "text/plain; charset=utf-8",
    });
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));

  if (shouldProxy(url.pathname)) {
    proxyApi(req, res);
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
    "[zimatools] static web on http://" +
      HOST +
      ":" +
      PORT +
      " (dist=" +
      DIST +
      ", api=" +
      API_UPSTREAM +
      ")",
  );
});
