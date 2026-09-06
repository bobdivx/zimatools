# ZimaTools

Native **ZimaOS** app: MCP server (HTTP), web dashboard, and **exclusive GPU lease** arbiter.

Popcorn has priority over Ollama and agents. Only one GPU lease at a time.

Repo: https://github.com/bobdivx/zimatools  
Based on: [zimaos-cursor-mcp](https://github.com/bobdivx/zimaos-cursor-mcp) v0.0.2 (history preserved).

## Stack

- Monorepo **pnpm workspaces**
- `apps/mcp` — TypeScript, [mcp-framework](https://www.mcp-framework.com/) `0.2.x`, **HTTP Stream** (`/mcp`) + optional stdio
- REST bridge **Hono** (`/api/*`) for the UI
- `apps/web` — **Astro + Preact + Tailwind CSS + DaisyUI**
- Single public port via Docker Compose (web proxies MCP + API)

## Architecture

```
zimatools/
  apps/mcp/     MCP server + REST + GPU arbiter
  apps/web/     Astro/Preact/DaisyUI UI (+ reverse proxy in Docker)
  docker/       Dockerfiles
  docker-compose.yml
  docker-compose.gpu.yml
```

| Service | Access | Role |
|---------|--------|------|
| Public entry | **8484** → `:8080` | UI + proxy (`/api`, `/health`, `/mcp`) |
| MCP (localhost) | `127.0.0.1:8765` inside the shared netns | HTTP stream |
| REST (localhost) | `127.0.0.1:8766` inside the shared netns | Hono API |

---

## Deploy on ZimaOS / CasaOS

Docker Hub images: `bobdivx/zimatools-mcp` + `bobdivx/zimatools-web`.

**One public port (`8484`).** Both processes share the `mcp` network namespace (`network_mode: service:mcp` on `web`), so the proxy talks to API/MCP on `127.0.0.1` — this avoids CasaOS DNS / bridge issues that cause **502 Bad Gateway**.

### Steps

1. Uninstall any previous ZimaTools app in CasaOS (and free port `8484`).
2. Apps → install a custom app (YAML).
3. Paste the compose below **as-is**.
4. After save, verify CasaOS did **not** change `web.network_mode` away from `service:mcp`.

### Compose YAML (copy/paste)

```yaml
services:
  mcp:
    image: bobdivx/zimatools-mcp:latest
    restart: always
    ports:
      - "8484:8080"
    environment:
      MCP_TRANSPORT: http
      MCP_HOST: "0.0.0.0"
      MCP_PORT: "8765"
      MCP_ENDPOINT: /mcp
      MCP_CORS_ORIGIN: "*"
      API_PORT: "8766"
      API_CORS_ORIGIN: "*"
      ZIMAOS_API_BASE: http://127.0.0.1
      ZIMAOS_API_TOKEN: ""
      ZIMAOS_SSH_PASSWORD: ""
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock

  web:
    image: bobdivx/zimatools-web:latest
    restart: always
    network_mode: "service:mcp"
    depends_on:
      - mcp
    environment:
      HOST: "0.0.0.0"
      PORT: "8080"
      API_UPSTREAM: http://127.0.0.1:8766
      MCP_UPSTREAM: http://127.0.0.1:8765

x-casaos:
  hostname: ""
  index: /
  is_uncontrolled: false
  main: mcp
  port_map: "8484"
  scheme: http
  title:
    custom: ZimaTools
```

### Endpoints after install

| Use | URL |
|-----|-----|
| Dashboard | `http://<nas>:8484` |
| MCP (Cursor / DevForge / agents) | `http://<nas>:8484/mcp` |
| REST health | `http://<nas>:8484/health` |

Optional env on `mcp`: set `ZIMAOS_API_TOKEN` (file tools) and `ZIMAOS_SSH_PASSWORD` (Docker tools).

### Port conflicts (“ports already in use”)

CasaOS often rewrites the YAML on save. Keep these rules:

| Rule | Why |
|------|-----|
| Publish `8484:8080` **only on `mcp`** | `web` shares mcp’s network; it must not declare its own `ports` |
| `web.network_mode` must stay `service:mcp` | If CasaOS sets `bridge`, you get **502** (`web` cannot reach API on localhost / DNS) |
| Do not add `ports` on `web` | Duplicate `8484` → “ports already in use” |
| Do not set `network_mode: bridge` on either service | Breaks the sidecar / DNS setup |

Free the port, then reinstall:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '8484|8765|8766'
docker rm -f $(docker ps -aq --filter name=zimatools) 2>/dev/null
# In CasaOS: fully uninstall the old ZimaTools app
```

If `8484` is still taken, change **only** `mcp.ports` and `port_map` (e.g. `18484:8080` and `port_map: "18484"`). MCP URL becomes `http://<nas>:18484/mcp`.

### 502 Bad Gateway

Means the web proxy cannot reach the API. Almost always: CasaOS rewrote `network_mode` to `bridge`. Set `web` back to:

```yaml
network_mode: "service:mcp"
```

and upstreams to `http://127.0.0.1:8766` / `http://127.0.0.1:8765`, then recreate the app.

### Optional NVIDIA GPU

Requires `nvidia-container-toolkit`. Add under the `mcp` service:

```yaml
    runtime: nvidia
    environment:
      NVIDIA_VISIBLE_DEVICES: all
      NVIDIA_DRIVER_CAPABILITIES: utility,compute
```

---

## Local development

Requirements: Node.js 20+, pnpm 10 (`corepack enable`).

```bash
git clone https://github.com/bobdivx/zimatools.git
cd zimatools
cp .env.example .env
# fill ZIMAOS_API_BASE / ZIMAOS_API_TOKEN / SSH if needed
pnpm install
pnpm --filter @zimatools/mcp build
```

Two terminals:

```bash
pnpm dev:mcp    # MCP HTTP :8765 + REST :8766
pnpm dev:web    # UI :4321 (proxies /api, /health, /mcp)
```

Stdio (local Cursor only):

```bash
pnpm --filter @zimatools/mcp dev:stdio
```

Local Docker build (without Hub pull):

```bash
docker compose up -d --build
# GPU: docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

---

## MCP endpoint (HTTP)

Transport: **Streamable HTTP** (`http-stream`), not stdio-only.

- Production: `http://<nas>:8484/mcp` (through the web proxy)
- Dev: `http://localhost:8765/mcp`
- Methods: `POST` / `GET` / `DELETE` / `OPTIONS`
- CORS open by default (`MCP_CORS_ORIGIN=*`, `MCP_HOST=0.0.0.0`)

### Cursor / DevForge (`mcp.json`)

```json
{
  "mcpServers": {
    "zimatools": {
      "url": "http://zimacube.local:8484/mcp"
    }
  }
}
```

### Local stdio (no NAS)

```json
{
  "mcpServers": {
    "zimatools": {
      "command": "node",
      "args": ["<path>/apps/mcp/dist/index.js", "--stdio"],
      "env": {
        "ZIMAOS_API_BASE": "http://zimacube.local",
        "ZIMAOS_API_TOKEN": "..."
      }
    }
  }
}
```

### REST (same GPU tools)

Via the public proxy: `http://<nas>:8484/...`

- `GET /health`
- `GET /api/gpu/status`
- `POST /api/gpu/acquire` `{ "client": "popcorn" }`
- `POST /api/gpu/release` `{ "client": "popcorn" }`
- `GET /api/gpu/queue`
- `POST /api/gpu/priority` `{ "client": "ollama", "priority": 50 }`
- `GET /api/docker/containers`

---

## MCP tools

### ZimaOS files (API)

`read_file_from_zimaos`, list / write / edit / search / mkdir / stats — see `apps/mcp/src/tools/`.

### Docker (SSH or docker.sock)

`list_docker_containers_zimaos`, start / stop / restart / logs / info.

### GPU (in-memory queue + nvidia-smi)

| Tool | Role |
|------|------|
| `gpu.status` | nvidia-smi + lease + queue. If `nvidia-smi` missing: **stub**. |
| `gpu.acquire` | Exclusive lease. Higher priority **preempts**. |
| `gpu.release` | Release and promote the queue. |
| `gpu.queue_list` | Current lease + queue. |
| `gpu.set_priority` | Client priority (default popcorn=100, ollama=50, agents=25). |

Model: **one holder**. Popcorn steals the GPU from Ollama / agents; the previous holder is re-queued.

**v0 limits**

- Queue and priorities are **in-memory** (lost on restart).
- `nvidia-smi` CSV parse; otherwise fake GPU `stub-gpu`.
- No real stop/restart of Ollama or GPU containers yet.
- Docker UI list: SSH if configured, otherwise placeholder.

---

## Environment variables

See `.env.example`.

| Variable | Default | Role |
|----------|---------|------|
| `MCP_TRANSPORT` | `http` | `http` or `stdio` |
| `MCP_PORT` | `8765` | Internal MCP Streamable HTTP |
| `MCP_HOST` | `0.0.0.0` | Bind address |
| `MCP_ENDPOINT` | `/mcp` | MCP path |
| `API_PORT` | `8766` | Internal REST (Hono) |
| `API_UPSTREAM` | `http://mcp:8766` | Web → API proxy target |
| `MCP_UPSTREAM` | `http://mcp:8765` | Web → MCP proxy target |
| `PUBLIC_API_URL` | _(empty)_ | Browser API base; empty = same-origin |
| `PUBLIC_BASE_URL` | _(empty)_ | Public MCP URL override |
| `ZIMAOS_API_BASE` / `TOKEN` | — | File tools |
| `ZIMAOS_SSH_*` | — | Docker tools over SSH |

---

## Build

```bash
pnpm build
pnpm --filter @zimatools/web build
```

Legacy Home Assistant integration: `legacy/ha/`.

## License

TBD. Issues: https://github.com/bobdivx/zimatools/issues
