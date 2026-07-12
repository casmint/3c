# 3c TODO

Working list of known gaps, prioritized loosely by impact. Not all of these have an agreed approach yet — see "Open architecture question" at the bottom before making further changes to how apps and 3rd-party integrations are organized in the panel.

## Done
- [x] Resource limits (`mem_limit`) added to every service, root compose + all 4 app composes. Ollama already had one (4g); added cloudflared 256m, traefik 256m, panel 512m, chatrequest 512m, vibeslopwiki 512m, woketown 512m, skitter-server 1g. Total worst case ~7.7GB of 23GB host RAM — plenty of headroom. Revisit under real load (add `cpus` limits too if something misbehaves).
- [x] Real-time app control panel. Removed `apps.json` entirely — `apps/` is now the registry (every subdirectory with its own `docker-compose.yml` is discovered live via `docker compose ps`/`config`). Apps and Containers are unified into one `/apps` page: Core Infrastructure / Shared Services / Apps (rich per-app rows: domain, git status, per-container live mem/cpu, start/stop/restart/deploy/pull-rebuild/logs/delete) / Other. Fixed two real bugs found during rollout: (1) root-project `docker compose` calls need `-p 3c` pinned explicitly since the panel container's cwd doesn't match the host directory name; (2) git commands needed `safe.directory '*'` in the Dockerfile since bind-mounted repos are owned by the host UID. See [panel.md](panel.md) for the current API shape.

## Open

### 1. Container health + request visibility on the dashboard
Right now nothing verifies a container is actually healthy — Traefik and `docker ps` only know the process is running, not that it's responding. Want the dashboard to show real health (and ideally basic request stats) per app, not just "Up 7 weeks". Needs: Docker `HEALTHCHECK` (or Traefik health check) per service, plus a panel UI surface for it. Bigger version: lightweight request/latency counters per app, exposed to the panel.

### 2. Secrets handling is inconsistent across apps — fix later
Three different patterns in use right now:
- chatrequest: `env_file: .env` (correct)
- vibeslopwiki: `ADMIN_TOKEN=${ADMIN_TOKEN}` inlined from shell/compose env
- woketown: `SECRET_KEY=${SECRET_KEY:-change_me_in_production_please}` — insecure literal default, silently active if `.env` isn't loaded

Standardize everything on `env_file: .env` and remove the woketown fallback default.

### 3. Redesign woketown architecture
woketown diverges from the standard app template in `adding-an-app.md`: builds from `./backend` subdir instead of a root Dockerfile, bind-mounts `./data` and `./frontend` instead of a named volume + baked-in static files. Not broken, just inconsistent with chatrequest/vibeslopwiki and harder to reason about. Worth bringing in line with the standard pattern (or deciding the standard pattern should flex for apps like this).

### 4. Migrate recoverable apps from `~/c3-old`
See [legacy-c3-audit.md](legacy-c3-audit.md) for the full inventory. `~/c3-old` is the predecessor project (then called "C3") and still has 7 apps, several with cached images and intact data volumes on this same host — recovery cost is low, no rebuild-from-scratch needed. Candidates mentioned so far: 76e-radio, cxtwitter. Needs a per-app decision on which are still wanted before migrating.

## Open architecture question

Current 3c panel bundles two fairly different concerns:
- **1st-party app management** (local Docker apps: deploy, start/stop/restart, logs) — this was the *entire* focus of the old C3 panel.
- **3rd-party service integrations** (Cloudflare zones/DNS/Pages/analytics, Porkbun domains, Migadu email) — new in 3c, not present in old C3 at all.

Both are "things running on/for this server," but one is container orchestration and the other is API wrappers around external services. Not yet decided whether they should:
- stay unified in one panel (current state), or
- split into two UIs/backends that share auth/network but are otherwise independent, or
- stay one backend/panel but split the *frontend* into clearly separated sections (already partially true — `static/js/` has `apps.js` vs `dns.js`/`domains.js`/`email.js`/`zones.js`/`redirects.js`/`pages.js` as distinct files).

No action until this is decided — it affects how any further app-management or integration work above gets organized.
