# 3c Infrastructure Architecture

## Overview

3c is a self-hosted app platform on an Oracle ARM64 cloud instance. All public traffic routes through a Cloudflare Tunnel, through Traefik as a reverse proxy, to app containers — no public ports are exposed on the host.

```
Internet
   │
   ▼
Cloudflare (TLS termination, DDoS protection, Access auth)
   │
   ▼ (Cloudflare Tunnel)
3c-tunnel container (cloudflare/cloudflared)
   │
   ▼ http://traefik:80
Traefik v2.11 container (reverse proxy, auto-discovery via Docker labels)
   │
   ├──▶ 3c-panel (3c.lol)         port 8000
   ├──▶ vibeslopwiki (vibeslop.wiki) port 8000
   ├──▶ woketown (woke.town)       port 8000
   ├──▶ chatrequest (chatre.quest) port 8000
   └──▶ skitter-server (server.skitter.lol) port 4567
```

## Server

- **Provider**: Oracle Cloud Infrastructure (ARM)
- **Architecture**: ARM64 (aarch64)
- **RAM**: 23 GB
- **OS**: Oracle Linux, kernel 6.17
- **Shell user**: ubuntu
- **Project root**: `/home/ubuntu/3c/`

## Core Services (`/home/ubuntu/3c/docker-compose.yml`)

| Container | Image | Purpose |
|-----------|-------|---------|
| `3c-tunnel` | cloudflare/cloudflared | Cloudflare Tunnel client — sole internet ingress |
| `traefik` | traefik:v2.11 | Reverse proxy, routes by Host header via Docker labels |
| `3c-panel` | custom (python:3.11-slim) | Control panel UI at 3c.lol |
| `ollama` | ollama/ollama | Shared LLM server, 4GB memory limit, `OLLAMA_NUM_PARALLEL=4` |

All containers share the `3c-network` Docker bridge network (`172.18.0.0/16`). Apps discover each other by container name (e.g. `http://ollama:11434`).

## Network: `3c-network`

Defined in the root `docker-compose.yml` as `name: 3c-network`. Apps reference it as:

```yaml
networks:
  3c-network:
    external: true
```

The root compose creates the network; all apps just join it.

## Cloudflare Tunnel

- **Tunnel ID**: `2d44e991-6a1b-4bc0-af13-a05498efa10d`
- **Account ID**: `3c63a1a60cbc824d9e464fcf2484ff97`
- **Token**: stored in `/home/ubuntu/3c/.env` as `CLOUDFLARE_TUNNEL_TOKEN`
- **Config**: managed via Cloudflare Zero Trust dashboard (not a config file)
- **All hostnames** route to `http://traefik:80` — Traefik handles the final routing by Host header
- **API token** in `~/.config/3c/config.toml` has Zone/DNS/Pages permissions but NOT tunnel management — use the Zero Trust dashboard to add new hostnames
- **TLS**: terminated at Cloudflare. Traefik only sees plain HTTP on port 80.
- **Auth**: Cloudflare Access protects admin interfaces (3c.lol, chatre.quest) via Google OAuth — no auth code needed in app backends

## Traefik

Entry point: `web` on port 80 (HTTP only — no TLS, that's Cloudflare's job).

Apps declare themselves via Docker labels:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.{name}.rule=Host(`{domain}`)"
  - "traefik.http.routers.{name}.entrypoints=web"
  - "traefik.http.services.{name}.loadbalancer.server.port={port}"
  - "traefik.docker.network=3c-network"
```

The `traefik.docker.network=3c-network` label is important when the app container is on multiple networks — it tells Traefik which network interface to use.

## Ollama (Shared LLM)

- **Container**: `ollama` on `3c-network`
- **Model**: `qwen2.5:1.5b` (pulled once, persisted in `ollama_data` volume)
- **Access**: `http://ollama:11434` from any container on 3c-network
- **Memory**: 4GB limit
- **Parallelism**: `OLLAMA_NUM_PARALLEL=4`
- **Architecture**: ollama/ollama:latest image has ARM64 support

Apps use the Ollama API directly via httpx (no SDK). Two endpoints:
- `/api/generate` — single-turn completion (used by vibeslopwiki)
- `/api/chat` — multi-turn conversation with messages array (used by chatrequest)

## Secrets & Config

| File | Contents |
|------|----------|
| `/home/ubuntu/3c/.env` | `CLOUDFLARE_TUNNEL_TOKEN`, `C3_GITHUB_TOKEN`, Discord bot tokens |
| `~/.config/3c/config.toml` | Cloudflare API token + account ID, Porkbun keys, Migadu keys |

The 3c panel mounts both of these at startup. Apps have their own `.env` files.

## 3c Panel

See [panel.md](panel.md) for full documentation. Key architectural note: the panel container mounts the Docker socket and binary, so it can run `docker` / `docker compose` commands against the host — this is how app deploy/restart/logs work from the UI.

## Apps Registry

No registry file — the `/home/ubuntu/3c/apps/` directory itself is the registry. Every subdirectory with its own `docker-compose.yml` is discovered live by the panel (domain/port read from its Traefik labels, status from `docker compose ps`). The directory is gitignored; each app is its own repo.

## Cloudflare Resources

- **API token** (`<redacted — see ~/.config/3c/config.toml>`): Zone Read, DNS Edit, Account Analytics, Pages Edit — **no tunnel management**
- **vibeslop.wiki zone ID**: `a025406a6e540f3a4500dc7b9259c35b`
- **3c.lol zone ID**: `0efa4c6449a481aaf5c101ac51edaed2`
