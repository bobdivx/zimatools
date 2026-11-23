import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";

function keepPublicHost(proxy) {
  proxy.on("proxyReq", (proxyReq, req) => {
    if (req.headers.host) proxyReq.setHeader("x-forwarded-host", req.headers.host);
    if (!req.headers["x-forwarded-proto"]) proxyReq.setHeader("x-forwarded-proto", "http");
  });
}

const mcp = {
  target: "http://127.0.0.1:8765",
  changeOrigin: true,
  configure: keepPublicHost,
};

export default defineConfig({
  output: "static",
  integrations: [preact()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8766",
          changeOrigin: true,
          configure: keepPublicHost,
        },
        "/health": {
          target: "http://127.0.0.1:8766",
          changeOrigin: true,
          configure: keepPublicHost,
        },
        "/.well-known": mcp,
        "/oauth": mcp,
        "/icons": mcp,
        "/logo.png": mcp,
        "/logo.svg": mcp,
        "/favicon.ico": mcp,
        "/mcp": {
          ...mcp,
          bypass(req) {
            if (req.headers.accept?.includes("text/html")) return req.url;
          },
        },
      },
    },
  },
});
