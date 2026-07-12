# Legacy C3 Audit (`~/c3-old`)

`~/c3-old` is the predecessor of 3c, back when it was called **C3 — Container Control Center**. It's a separate, still-intact project directory (own `.git`, own `.env`) sitting alongside `~/3c` on the same host. Nothing here has been touched — this is a read-only inventory of what's recoverable.

## Old C3 panel architecture (for context, not reused as-is)

- **Stack**: FastAPI + Jinja2/HTMX/Alpine.js (server-rendered, no SPA) + Traefik v2.11 + Docker SDK (`docker_client.py`), vs. current 3c's FastAPI + vanilla JS SPA.
- **Auth**: HTTP Basic Auth (`C3_USERNAME`/`C3_PASSWORD`, constant-time comparison) + optional IP allowlist (`C3_ALLOWED_IPS`) — no Cloudflare Access, no Google OAuth. 3c's move to Cloudflare Access is strictly better.
- **App types**: `stack` (own docker-compose.yml), `web` (single container, auto-Dockerfile), `worker` (no HTTP routing) — a distinction 3c's registry doesn't currently make (everything is implicitly a "stack").
- **Deploy flow**: clone repo → build image → run container w/ Traefik labels + `c3-network` (old network name, not `3c-network`).
- **No Cloudflare/Porkbun/Migadu integration at all** — old C3 was purely container/app management. That entire integration layer is new to 3c.
- Source: `~/c3-old/src/` (`main.py`, `apps.py` — 734 lines, `docker_client.py`, `panel/routes.py` — 333 lines, `panel/templates/*.html`).

## Apps in `~/c3-old/apps/` — recoverability inventory

All of the below have their **Docker images still cached on the host** (confirmed via `docker system df -v` — zero containers currently using them, but the images exist, so no rebuild-from-scratch needed to bring them back up). Volumes for stateful apps also still exist as anonymous-project volumes.

| App | Domain | Stack | Cached image | Data volumes present | Notes |
|-----|--------|-------|--------------|----------------------|-------|
| **76e-radio** | `76e.net` / `admin.76e.net` (radio), | AzuraCast (radio streaming) + MariaDB + Redis | `ghcr.io/azuracast/azuracast:latest` (2.96GB), `mariadb:11`, `redis:7-alpine` | Yes — `76e-radio_db_data`, `76e-radio_azuracast_data/tmp/uploads/backups` all present on host | Most complex app to migrate: 3 containers, custom Traefik admin-path redirect middleware, ports 8000/8010/8020/2022 (SFTP) in old compose. Explicitly mentioned as wanted for migration. |
| **cxtwitter** | `cxtwitter.com` | nginx proxy + custom Twitter-archiver app (`build: .`) + MongoDB | `cxtwitter-twitfix` (227MB), `mongo:5.0.9` (928MB) | DB was a bind mount (`./db:/data/db`), not a named volume — check `~/c3-old/apps/cxtwitter/db/` on disk directly | Explicitly mentioned as wanted for migration. 3-container stack (proxy/app/db). |
| **signoutmaster** | `signout.act25.com` | Custom Flask-ish app, port 5000 | `signoutmaster-web` (229MB) | Bind mount `./instance` | Sign-out management tool. |
| **megumin-chat** | `megumin.lol` (+ `www.`/`app.`/`admin.` subdomains) | Custom chat app, port 8000 | `megumin-chat-web` (273MB) | Bind mount `./data` | 3 Traefik routers off one container (www/app/admin subdomain split). |
| **cntbot** | none (worker) | Discord bot (py-cord) | `cntbot-bot` (837MB) | Bind mount `./recordings` | No HTTP/Traefik routing — background worker only. Needs its Discord token from `~/c3-old/.env`. |
| **realbot** | none (worker) | Discord bot (discord.py, NOT py-cord) | `realbot-bot` (244MB) | none | Marked "ACTIVE DEV" in old C3's CLAUDE.md — base bot class + cog autoloader + one `/ping` command, minimal. Needs `REALBOT_TOKEN`. |
| **statics** | `76e.net`, `aei.my` | Plain nginx serving static sites | none cached (trivial — just `nginx:alpine` + config) | Bind mount `./sites` | Simplest to migrate — just a Docker-labeled nginx with static files, no app logic. Note: claims `76e.net` too, which overlaps with 76e-radio's admin subdomain — old setup must have split root domain (statics) vs `admin.`/`radio.` subdomains (azuracast). Reconcile domain ownership before migrating both. |

## Secrets referenced in `~/c3-old/.env` (names only — not read into this doc)

`C3_USERNAME`, `C3_PASSWORD`, `C3_GITHUB_TOKEN`, `C3_ALLOWED_IPS`, `CLOUDFLARE_TUNNEL_TOKEN`, `REALBOT_TOKEN`. If migrating cntbot/realbot, their bot tokens will need to be pulled from this `.env` (or regenerated) into 3c's own secret handling.

## Migration notes

- Old network was named `c3-network`; current is `3c-network` — every migrated app's compose needs the network name updated.
- Old apps used `container_name` values that don't collide with anything currently running on 3c, so no naming conflicts expected.
- New hostnames (`76e.net`, `cxtwitter.com`, etc.) will need to be added to the Cloudflare Tunnel via the Zero Trust dashboard, same as any new 3c app (see [adding-an-app.md](adding-an-app.md)).
- Recommend migrating **statics** first (trivial, no state) to validate the process, then **cxtwitter** or **76e-radio** depending on which is actually still wanted live.
