import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import tailwindcss from "@tailwindcss/vite";

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
        },
        "/health": {
          target: "http://127.0.0.1:8766",
          changeOrigin: true,
        },
        "/mcp": {
          target: "http://127.0.0.1:8765",
          changeOrigin: true,
          bypass(req) {
            if (req.headers.accept?.includes("text/html")) return req.url;
          },
        },
      },
    },
  },
});
