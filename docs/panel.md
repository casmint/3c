# 3c Panel

The 3c panel is the control interface for the entire server, running at `3c.lol` behind Cloudflare Access (Google OAuth). It is a FastAPI + vanilla JS SPA.

## File Structure

```
/home/ubuntu/3c/
  Dockerfile              # python:3.11-slim, runs panel as a package
  docker-compose.yml      # core services: cloudflared, traefik, ollama, panel
  pyproject.toml          # panel package definition
  notes.json              # key-value annotations (managed by panel)
  apps/                   # one subdirectory per app (gitignored) — this IS the app registry
  docs/                   # this documentation
  static/                 # frontend SPA (HTML/JS/CSS, no build step)
  panel/
    __init__.py
    __main__.py           # uvicorn entrypoint
    app.py                # FastAPI route definitions (all routes)
    config.py             # loads ~/.config/3c/config.toml
    api/
      apps.py             # app/container discovery (filesystem + docker compose) and git ops
      cloudflare.py       # Cloudflare API client
      porkbun.py          # Porkbun domain registrar API client
      migadu.py           # Migadu email API client
```

## Docker Access

The panel container has direct access to the Docker socket:
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - /usr/bin/docker:/usr/bin/docker:ro
  - /usr/libexec/docker/cli-plugins:/usr/libexec/docker/cli-plugins:ro
```
This lets it run `docker` and `docker compose` commands on the host, used for deploying/stopping/restarting apps.

## Config (`~/.config/3c/config.toml`)

Mounted read-only into the panel at startup. Contains:
- Cloudflare API token + account ID
- Porkbun API key + secret
- Migadu email + API key

The panel's `config.py` loads this file. Missing sections (porkbun, migadu) are optional — those integrations are disabled if credentials are absent.

## App Registry — the filesystem (`apps/`)

There is no registry file. Every subdirectory of `apps/` with its own `docker-compose.yml` (or `compose.yml`) *is* an app — the panel discovers apps by scanning the directory and cross-referencing `docker compose ps`/`config --format json` for live container status, domain, and port (parsed from each app's own Traefik labels). This replaced an earlier `apps.json` registry file that had drifted from reality (all real apps were deployed by hand outside it) — the filesystem can't drift from itself.

Root-level services (`cloudflared`, `traefik`, `panel`) are classified as **core**; anything else defined in the root `docker-compose.yml` (currently just `ollama`) is a **shared service** consumed by apps, not an app itself.

## Notes (`notes.json`)

Key-value store with namespaces, e.g. `{"dns": {"vibeslop.wiki": "some note"}}`. Persisted to disk, used by the panel frontend for user annotations on domains, apps, etc.

## API Routes

### Config & Status
- `GET /api/config/status` — which integrations are configured (cloudflare/porkbun/migadu)
- `GET /api/settings/status` — live connectivity check for all integrations
- `POST /api/settings/test/{service}` — test a specific integration
- `GET /api/cf/account-id` — return configured Cloudflare account ID

### Notes
- `GET /api/notes/{namespace}` — get all notes in a namespace
- `PUT /api/notes/{namespace}/{key}` — set a note
- `DELETE /api/notes/{namespace}/{key}` — delete a note

### Cloudflare — Zones
- `GET /api/cf/zones` — list zones (supports `?status=`, `?name=`, pagination)
- `POST /api/cf/zones` — create a zone
- `GET /api/cf/zones/resolve/{domain}` — find zone by domain name

### Cloudflare — DNS
- `GET /api/cf/zones/{zone_id}/dns` — list DNS records
- `POST /api/cf/zones/{zone_id}/dns` — create DNS record
- `PATCH /api/cf/zones/{zone_id}/dns/{record_id}` — update DNS record
- `DELETE /api/cf/zones/{zone_id}/dns/{record_id}` — delete DNS record

### Cloudflare — Analytics
- `GET /api/cf/zones/{zone_id}/analytics?days=7` — zone traffic analytics

### Cloudflare — Bulk Redirects
- `GET /api/cf/redirects/lists` — list redirect lists
- `GET /api/cf/redirects/lists/{list_id}/items` — list items in a redirect list
- `POST /api/cf/redirects/lists/{list_id}/items` — add items
- `DELETE /api/cf/redirects/lists/{list_id}/items` — delete items (body: `{item_ids: [...]}`)

### Cloudflare — Pages
- `GET /api/cf/pages/projects` — list Pages projects
- `POST /api/cf/pages/projects` — create a Pages project
- `POST /api/cf/pages/projects/{name}/deploy` — trigger a deployment
- `GET /api/cf/pages/projects/{name}/deployments/{id}` — get deployment status

### Porkbun — Domains
- `GET /api/porkbun/available` — whether Porkbun credentials are configured
- `GET /api/domains` — list all Porkbun domains with CF zone status and renewal pricing
- `POST /api/domains/{domain}/update-ns` — update nameservers (body: `{nameservers: [...]}`)
- `POST /api/domains/{domain}/fix-cf` — set Cloudflare-assigned NS on Porkbun automatically
- `POST /api/porkbun/ns/{domain}` — low-level NS update

### Migadu — Email
- `GET /api/email/available` — whether Migadu is configured
- `GET /api/email/domains` — list email domains
- `POST /api/email/domains` — add email domain
- `GET /api/email/domains/{domain}` — get domain details
- `PATCH /api/email/domains/{domain}` — update domain settings
- `GET /api/email/domains/{domain}/dns-records` — get required DNS records
- `GET /api/email/domains/{domain}/diagnostics` — run diagnostics
- `POST /api/email/domains/{domain}/activate` — activate domain
- `GET /api/email/domains/{domain}/catchall` — get catch-all destination
- `POST /api/email/domains/{domain}/catchall` — set catch-all
- `DELETE /api/email/domains/{domain}/catchall` — clear catch-all
- `POST /api/email/domains/{domain}/setup-dns` — auto-add Migadu DNS records to CF
- `GET /api/email/mailboxes/{domain}` — list mailboxes
- `POST /api/email/mailboxes/{domain}` — create mailbox
- `PUT /api/email/mailboxes/{domain}/{local_part}` — update mailbox
- `DELETE /api/email/mailboxes/{domain}/{local_part}` — delete mailbox
- `GET /api/email/aliases/{domain}` — list aliases
- `POST /api/email/aliases/{domain}` — create alias
- `DELETE /api/email/aliases/{domain}/{local_part}` — delete alias
- `GET /api/email/identities/{domain}/{mailbox}` — list send-as identities
- `POST /api/email/identities/{domain}/{mailbox}` — create identity
- `DELETE /api/email/identities/{domain}/{mailbox}/{id_local}` — delete identity

### Apps — unified dashboard
- `GET /api/apps` — `{core, shared, apps, other}`: root services classified core/shared, discovered apps (domain/port/status/containers/git), and any stray containers not accounted for elsewhere
- `GET /api/stats` — live mem/cpu per container, keyed by container name (separate endpoint since `docker stats` takes ~2s to sample regardless of container count — frontend loads it after the initial page paint)
- `POST /api/apps` — clone a new app: body `{name, repo, branch}`; the repo must already have its own `docker-compose.yml` following [adding-an-app.md](adding-an-app.md) — domain/port are read from it, not supplied here

### App Operations (compose-based — correct for both single- and multi-container apps)
- `POST /api/apps/{name}/deploy` — docker compose up -d --build
- `POST /api/apps/{name}/pull-restart` — git pull + docker compose up -d --build
- `POST /api/apps/{name}/start` — docker compose start
- `POST /api/apps/{name}/stop` — docker compose stop
- `POST /api/apps/{name}/restart` — docker compose restart
- `POST /api/apps/{name}/delete` — docker compose down --remove-orphans -v + delete the app directory
- `GET /api/apps/{name}/logs?tail=200` — logs from all containers in the app's compose project
- `GET /api/apps/{name}/git-status` — git status for the app directory

### Raw Container Control (core / shared services — single containers, not compose projects)
- `POST /api/containers/{name}/start` — start a container
- `POST /api/containers/{name}/stop` — stop a container
- `POST /api/containers/{name}/restart` — restart a container
- `GET /api/containers/{name}/logs?tail=200` — tail logs

### 3c Self-Update
- `GET /api/3c/git-status` — git status of the 3c repo itself
- `POST /api/3c/pull-restart` — git pull + restart the panel container

## Running / Updating the Panel

```bash
# Rebuild and restart the panel (from /home/ubuntu/3c/)
docker compose up -d --build panel

# View panel logs
docker logs 3c-panel -f

# Restart all core services
docker compose up -d
```
