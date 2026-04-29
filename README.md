# 3C Panel — Cloud Control Center

Self-hosted personal operations dashboard for managing Cloudflare zones, DNS,
Pages deployments, bulk redirects, and deployed apps — with stubs for Porkbun,
Migadu, and a server console.

Runs at `3c.lol`. Protected by Cloudflare Access (Google OAuth). No login
code in the app itself.

NOTE: This is the new version of the "c3" repo, formerly named wrong

## Features

- **Zone management** — list, search, filter, and add Cloudflare zones
- **DNS manager** — full CRUD for A, AAAA, CNAME, TXT, MX, NS, SRV records
- **Analytics** — 7-day request/bandwidth/visitor charts via Cloudflare GraphQL
- **Bulk redirects** — manage redirect lists and items
- **Pages** — list projects, trigger deployments, create new projects
- **Apps** — deploy, pull & restart, stop, delete Docker apps with log viewer
- **Porkbun integration** — auto-update nameservers when adding zones
- **Self-update** — pull & restart 3C from its own UI

## Infrastructure

One `docker compose up -d` starts everything:

- **cloudflared** — Cloudflare Tunnel (sole internet entry point)
- **traefik** — reverse proxy (internal only, no exposed ports)
- **panel** — 3C Panel (FastAPI app)

Traffic flow: `internet → cloudflared → traefik → app containers`

Traefik auto-discovers containers via Docker socket and routes by `Host`
header labels. All deployed apps join `3c-network`.

## Prerequisites

- Docker + Docker Compose
- A Cloudflare Tunnel token
- A Cloudflare API token (see scopes below)
- GitHub token for private repos (optional)
- Porkbun API keys (optional)

## Quick Start

1. Clone the repo:
   ```bash
   git clone https://github.com/youruser/3c.git /opt/3c
   cd /opt/3c
   ```

2. Create `.env`:
   ```bash
   cp .env.example .env
   # Edit with your tokens
   ```

3. Create `~/.config/3c/config.toml`:
   ```toml
   [cloudflare]
   api_token = "your-cf-api-token"
   account_id = "your-account-id"

   [porkbun]
   api_key = "your-porkbun-api-key"
   secret_api_key = "your-porkbun-secret-key"
   # Porkbun section is optional — remove if not using
   ```
   ```bash
   chmod 600 ~/.config/3c/config.toml
   ```

4. Start:
   ```bash
   docker compose up -d
   ```

## Running Locally (dev)

```bash
python3 -m venv venv
source venv/bin/activate
pip install -e .
python -m panel
```

Open `http://localhost:8000`. Note: apps module requires Docker.

## Apps

Apps are managed via `apps.json` at the repo root. Each app entry:

```json
{
  "name": "myapp",
  "type": "stack",
  "repo": "https://github.com/user/myapp",
  "branch": "main",
  "domain": "myapp.com",
  "port": 8000,
  "enabled": true
}
```

**App types:**
- `stack` — has its own `docker-compose.yml`, deployed via `docker compose up -d`
- `web` — single container with Traefik routing, auto-generates Dockerfile if missing
- `worker` — background container, no HTTP routing

Apps are cloned to `apps/{name}/` (gitignored). Deploy flow: clone → build → run.

When deploying, 3C auto-injects `3c-network` and Traefik labels so apps
are routed correctly through the tunnel.

## .env

```
CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token
GITHUB_TOKEN=your-github-token-for-private-repos
```

## Cloudflare API Token Scopes

Create a token at https://dash.cloudflare.com/profile/api-tokens with:

| Permission | Access |
|---|---|
| Zone | Read |
| Zone Settings | Edit |
| DNS | Edit |
| Account Analytics | Read |
| Cloudflare Pages | Edit |
| Account Rulesets | Edit |

Zone Resources: **All zones**

## Porkbun API Setup

1. Log in to https://porkbun.com/account/api
2. Enable API access
3. Generate an API key and secret key
4. Add both to your `config.toml` under `[porkbun]`

## Cloudflare Access

This app has no authentication code. It is protected by Cloudflare Access:

1. Add `3c.lol` as an application in Cloudflare Access
2. Configure a policy (e.g. Google OAuth, allow specific email)
3. All requests reaching the app are already authenticated

## Cloudflare Tunnel Setup

1. Create a tunnel in the Cloudflare dashboard
2. Add a public hostname rule: `3c.lol` → `http://traefik:80`
3. Add rules for each app domain: `app.com` → `http://traefik:80`
4. Copy the tunnel token to `.env`

## Migration from C3

If migrating from the previous C3 panel:
- Network renamed from `c3-network` to `3c-network`
- Container prefix changed from `c3-` to `3c-`
- Ensure existing app containers are restarted with the new network

## Architecture

```
docker-compose.yml    cloudflared + traefik + panel
apps.json             App registry
apps/                 Cloned app repos (gitignored)
.env                  Tunnel token, GitHub token

static/               Vanilla HTML + CSS + JS (no build step)
  index.html          Single HTML shell
  css/main.css        Brutalist dark theme
  js/app.js           SPA router, sidebar, shared utilities
  js/zones.js         Zone list + add zone modal
  js/dns.js           DNS record manager
  js/analytics.js     Zone analytics + Chart.js
  js/redirects.js     Bulk redirect manager
  js/pages.js         Cloudflare Pages manager
  js/apps.js          App management UI

panel/                Python backend (FastAPI, async)
  __main__.py         Entry point
  app.py              REST API endpoints + static serving
  config.py           TOML config loading
  api/
    cloudflare.py     All Cloudflare REST + GraphQL API calls
    porkbun.py        Porkbun nameserver update API
    apps.py           App deploy/git/Docker operations
```
