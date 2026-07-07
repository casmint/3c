# 3c Apps

## Currently Running Apps

| App | Domain | Container | Stack | Notes |
|-----|--------|-----------|-------|-------|
| 3c Panel | 3c.lol | `3c-panel` | FastAPI + vanilla JS SPA | Control panel, protected by Cloudflare Access |
| vibeslopwiki | vibeslop.wiki | `vibeslop-app` | FastAPI + SQLite + Ollama | Hallucinatory encyclopedia |
| woketown | woke.town | `woketown` | FastAPI + SQLAlchemy + SQLite | Social network |
| skitter-server | server.skitter.lol | `skitter-server` | Godot 4 binary | Multiplayer game server (WebSocket, port 4567) |
| chatrequest | chatre.quest | `chatrequest` | FastAPI + SQLite + Ollama | Embeddable AI chatbot |

## Core Infrastructure

The panel classifies these as "core" (the platform itself) rather than apps or shared services — see [panel.md](panel.md).

| Service | Container | Access | Notes |
|---------|-----------|--------|-------|
| 3c Panel | `3c-panel` | `https://3c.lol` | Control panel |
| Traefik | `traefik` | `http://traefik:80` (internal) | Routes by Host header |
| Cloudflare Tunnel | `3c-tunnel` | — | Sole internet entry point |

## Shared Services

Services defined in the root `docker-compose.yml` that apps consume but that aren't the platform itself.

| Service | Container | Access | Notes |
|---------|-----------|--------|-------|
| Ollama | `ollama` | `http://ollama:11434` | qwen2.5:1.5b, 4GB limit, 4 parallel slots |

## 3c Panel (`/home/ubuntu/3c/`)

The hub control panel for the entire server. See [panel.md](panel.md) for full API and structure documentation.

- **Stack**: FastAPI + vanilla JS SPA (no build step), static files served from `/home/ubuntu/3c/static/`
- **Source**: `/home/ubuntu/3c/panel/` (Python package)
- **Docker**: defined in root `/home/ubuntu/3c/docker-compose.yml` alongside core services
- **Config**: `~/.config/3c/config.toml` (Cloudflare + Porkbun + Migadu credentials), mounted read-only
- **Docker socket**: mounted so the panel can manage other containers
- **Integrations**: Cloudflare (zones, DNS, Pages, analytics, redirects), Porkbun (domain management, nameservers), Migadu (email hosting)
- **App registry**: none — every subdirectory of `apps/` with its own `docker-compose.yml` is discovered live as an app (see [panel.md](panel.md))
- **Notes**: `notes.json` — user annotation key-value store (namespaced)
- **Self-update**: `POST /api/3c/pull-restart` — git pull + container restart

## vibeslopwiki (`/home/ubuntu/3c/apps/vibeslopwiki/`)

Hallucinatory Wikipedia — generates plausible-sounding but completely fabricated encyclopedia articles on demand.

- **Model**: `qwen2.5:1.5b` via Ollama `/api/generate`
- **DB**: SQLite (`articles`, `stubs`, `banned` tables)
- **Port**: 8000
- **Admin token**: `<redacted — see vibeslopwiki's .env>` (via `?token=` param at `/admin`)
- **Key features**: SSE streaming generation, wiki link extraction, SVG diagram generation (50% of articles), 4 parallel generations
- **SVG diagrams**: LLM-generated, fire in parallel with article text

## woketown (`/home/ubuntu/3c/apps/woketown/`)

Social network with posts, likes, follows, and replies.

- **DB**: SQLite via SQLAlchemy async (`aiosqlite`)
- **Auth**: JWT tokens
- **Port**: 8000

## skitter-server (`/home/ubuntu/3c/apps/skitter-server/`)

Godot 4 multiplayer server for the game Skitter.

- **Image**: Ubuntu 22.04 + ARM64 binary
- **Port**: 4567 (WebSocket)
- **Deploy**: Pulls binary from GitHub releases

## chatrequest (`/home/ubuntu/3c/apps/chatrequest/`)

Embeddable AI chatbot system for static websites.

- **Model**: `qwen2.5:1.5b` via Ollama `/api/chat` (multi-turn)
- **DB**: SQLite (`sites`, `conversations`, `messages` tables)
- **Port**: 8000
- **Admin**: chatre.quest (Cloudflare Access protected)
- **Embed**: `<script src="https://chatre.quest/embed.js" data-token="TOKEN">`
- **Security**: token + Origin/Referer domain validation + per-IP rate limiting (1/5s, 30/hr)
- **Rate limit**: uses `CF-Connecting-IP` header (Cloudflare sets this), falls back to `X-Forwarded-For`
