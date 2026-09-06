# ZimaTools

Application native **ZimaOS** : serveur MCP (HTTP), interface web et **arbitre GPU** pour une VRAM exclusive.

Popcorn a priorite sur Ollama et les agents. Un seul lease GPU a la fois.

Repo : https://github.com/bobdivx/zimatools  
Origine : [zimaos-cursor-mcp](https://github.com/bobdivx/zimaos-cursor-mcp) v0.0.2 (historique conserve).

## Stack

- Monorepo **pnpm workspaces**
- `apps/mcp` — TypeScript, [mcp-framework](https://www.mcp-framework.com/) `0.2.x`, transport **HTTP Stream** (`/mcp`) + stdio optionnel
- Pont REST **Hono** (`/api/*`) pour l'UI
- `apps/web` — **Astro + Preact + Tailwind CSS + DaisyUI**
- `docker-compose.yml` pret pour ZimaOS (docker.sock, NVIDIA optionnel)

## Architecture

```
zimatools/
  apps/mcp/     serveur MCP + REST + arbitre GPU
  apps/web/     UI Astro/Preact/DaisyUI
  docker/       Dockerfiles
  docker-compose.yml
  docker-compose.gpu.yml
```

| Service | Acces | Role |
|---------|-------|------|
| Web + proxy | **8484** (seul port public) | UI, `/api`, `/health`, `/mcp` |
| MCP (interne) | `mcp:8765` | HTTP stream (via proxy) |
| REST (interne) | `mcp:8766` | API Hono (via proxy) |

## Deploiement ZimaOS / CasaOS

Images Docker Hub : `bobdivx/zimatools-mcp` + `bobdivx/zimatools-web`.

> **Un seul port expose** (`8484`). MCP et REST ecoutent en interne (`0.0.0.0:8765` / `8766`) ; le conteneur `web` proxifie `/mcp`, `/api` et `/health`. Ne pas mettre `network_mode: bridge`.

1. CasaOS → **App** → Installer une app personnalisee (YAML).
2. Coller le compose ci-dessous.
3. Si le port `8484` est pris : change uniquement `published` / `port_map` (ex. `18484`).

```yaml
services:
  mcp:
    image: bobdivx/zimatools-mcp:latest
    restart: always
    expose:
      - "8765"
      - "8766"
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
    ports:
      - target: 8080
        published: "8484"
        protocol: tcp
    environment:
      HOST: "0.0.0.0"
      PORT: "8080"
      API_UPSTREAM: http://mcp:8766
      MCP_UPSTREAM: http://mcp:8765
    depends_on:
      - mcp

x-casaos:
  hostname: ""
  index: /
  is_uncontrolled: false
  main: web
  port_map: "8484"
  scheme: http
  title:
    custom: ZimaTools
```

Apres install :

- UI : `http://<nas>:8484`
- MCP (Cursor / DevForge) : `http://<nas>:8484/mcp`
- REST : `http://<nas>:8484/health`

Optionnel : renseigner `ZIMAOS_API_TOKEN` (outils fichiers) et `ZIMAOS_SSH_PASSWORD` (outils Docker).

GPU NVIDIA (si `nvidia-container-toolkit`) : ajouter sur le service `mcp` :

```yaml
    runtime: nvidia
    environment:
      NVIDIA_VISIBLE_DEVICES: all
      NVIDIA_DRIVER_CAPABILITIES: utility,compute
```

## Installation locale (dev)

Prerequis : Node.js 20+, pnpm 10 (`corepack enable`).

```bash
git clone https://github.com/bobdivx/zimatools.git
cd zimatools
cp .env.example .env
# renseigner ZIMAOS_API_BASE / ZIMAOS_API_TOKEN / SSH si besoin
pnpm install
pnpm --filter @zimatools/mcp build
```

Deux terminaux :

```bash
pnpm dev:mcp    # MCP HTTP :8765 + REST :8766
pnpm dev:web    # UI :4321 (proxy /api -> 8766)
```

Stdio (Cursor local uniquement) :

```bash
pnpm --filter @zimatools/mcp dev:stdio
```

Build local Docker (sans Hub) :

```bash
docker compose up -d --build
# GPU : docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

## Endpoint MCP (HTTP)

Transport : **Streamable HTTP** (mcp-framework `http-stream`), pas seulement stdio.

- URL : `http://<nas>:8484/mcp` (derriere le proxy web) ou `http://localhost:8765/mcp` en dev
- Methodes : `POST` / `GET` / `DELETE` / `OPTIONS`
- CORS ouvert par defaut (`MCP_CORS_ORIGIN=*`, `MCP_HOST=0.0.0.0`)

Exemple Cursor / DevForge (`mcp.json`) :

```json
{
  "mcpServers": {
    "zimatools": {
      "url": "http://zimacube.local:8484/mcp"
    }
  }
}
```

Stdio local (sans NAS) :

```json
{
  "mcpServers": {
    "zimatools": {
      "command": "node",
      "args": ["<chemin>/apps/mcp/dist/index.js", "--stdio"],
      "env": {
        "ZIMAOS_API_BASE": "http://zimacube.local",
        "ZIMAOS_API_TOKEN": "..."
      }
    }
  }
}
```

REST UI (Hono, memes outils GPU) :

- `GET /health`
- `GET /api/gpu/status`
- `POST /api/gpu/acquire` `{ "client": "popcorn" }`
- `POST /api/gpu/release` `{ "client": "popcorn" }`
- `GET /api/gpu/queue`
- `POST /api/gpu/priority` `{ "client": "ollama", "priority": 50 }`
- `GET /api/docker/containers`

## Outils MCP

### Fichiers ZimaOS (existants, via API)

`read_file_from_zimaos`, list / write / edit / search / mkdir / stats — voir `apps/mcp/src/tools/`.

### Docker (existants, via SSH)

`list_docker_containers_zimaos`, start / stop / restart / logs / info.

### GPU (v0 — file en memoire + nvidia-smi)

| Outil | Role |
|-------|------|
| `gpu.status` | nvidia-smi + lease + file. Si `nvidia-smi` absent : **stub**. |
| `gpu.acquire` | Lease exclusif. Priorite plus haute **preempte**. |
| `gpu.release` | Relache et promeut la file. |
| `gpu.queue_list` | Lease courant + file. |
| `gpu.set_priority` | Priorite client (defaut popcorn=100, ollama=50, agents=25). |

Modele : **un seul holder**. Popcorn vole le GPU a Ollama / agents ; le detenteur precedent est refile.

**Stub / limites v0**

- Queue et priorites **en memoire** (perdues au restart).
- `nvidia-smi` parse CSV ; sinon GPU factice `stub-gpu`.
- Pas encore d'arret/redemarrage reel d'Ollama ou de containers GPU.
- Liste Docker UI : SSH si configure, sinon placeholder.

## Variables d'environnement

Voir `.env.example`.

| Variable | Defaut | Role |
|----------|--------|------|
| `MCP_TRANSPORT` | `http` | `http` ou `stdio` |
| `MCP_PORT` | `8765` | MCP Streamable HTTP |
| `MCP_HOST` | `0.0.0.0` | Bind NAS |
| `MCP_ENDPOINT` | `/mcp` | Chemin MCP |
| `API_PORT` | `8766` | REST Hono |
| `PUBLIC_API_URL` | hostname:8766 | URL API vue par le navigateur |
| `ZIMAOS_API_BASE` / `TOKEN` | — | Outils fichiers |
| `ZIMAOS_SSH_*` | — | Outils Docker |

## Developpement

```bash
pnpm build          # mcp + web
pnpm --filter @zimatools/web build
```

L'integration Home Assistant historique est dans `legacy/ha/`.

## Licence

A definir. Issues : https://github.com/bobdivx/zimatools/issues
