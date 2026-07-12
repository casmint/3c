# 3C Panel

The 3C panel is a FastAPI backend plus a vanilla JavaScript single-page frontend. It runs as `3c-panel` and is routed at `https://3c.lol` through Cloudflare Tunnel and Traefik.

The panel has no login code. Cloudflare Access is expected to authenticate users before requests reach the container.

## Backend layout

```text
panel/
  __main__.py
  app.py
  config.py
  api/
    apps.py
    cloudflare.py
    porkbun.py
    migadu.py
```

## Frontend layout

```text
static/
  index.html
  css/main.css
  js/app.js
  js/apps.js
  js/zones.js
  js/dns.js
  js/analytics.js
  js/redirects.js
  js/pages.js
  js/domains.js
  js/email.js
  js/settings.js
```

The frontend is intentionally no-build: no Node, no bundler, no framework.

## Config

The panel reads API config from:

```text
~/.config/3c/config.toml
```

Mounted into the container read-only as:

```text
/root/.config/3c/config.toml
```

Expected sections:

```toml
[cloudflare]
api_token = "..."
account_id = "..."

[porkbun]
api_key = "..."
secret_api_key = "..."

[migadu]
api_key = "..."
```

Porkbun and Migadu are optional, but the UI should degrade gracefully if they are absent.

## Docker control model

The panel mounts:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - /usr/bin/docker:/usr/bin/docker:ro
  - /usr/libexec/docker/cli-plugins:/usr/libexec/docker/cli-plugins:ro
  - ./apps:/app/apps
  - ./.env:/app/.env:ro
```

This gives the panel host-level Docker control. Treat the panel as highly privileged. Cloudflare Access is a required security boundary, not decoration.

## App discovery

Implemented in `panel/api/apps.py`.

No `apps.json` is used.

Discovery algorithm:

1. Scan `BASE_DIR/apps`.
2. Include any directory with a Compose file:
   - `docker-compose.yml`
   - `docker-compose.yaml`
   - `compose.yml`
   - `compose.yaml`
3. Run `docker compose config --format json` in each app directory.
4. Read Traefik labels for domain/port.
5. Run `docker compose ps -a --format json` for live status.
6. Run Git commands in the app directory for branch/dirty/ahead/behind/remote.

The filesystem is the registry. If an app is absent from `/apps`, it is absent from the panel.

## Root compose project name

The root compose project is pinned as:

```python
ROOT_PROJECT = "3c"
```

This matters because inside the panel container the repo path is `/app`, while the host directory is `/home/ubuntu/3c`. Docker Compose would otherwise infer the wrong project name.

Root service operations should use:

```bash
docker compose -p 3c ...
```

## Core/shared/app classification

`CORE_SERVICES` currently includes:

```python
{"panel", "traefik", "cloudflared"}
```

Everything else in root Compose is treated as shared infrastructure, such as:

- Oracle Ollama;
- Tailscale;
- GPU/CompGate proxy containers.

App containers are derived from app Compose projects.

Anything else running on the host becomes `other`.

## API surface

### General

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Basic panel health |
| `GET` | `/api/ai/status` | Read-only Oracle-Ollama and Tailscale-CompGate status |
| `GET` | `/api/settings` | Configured integration availability / settings |
| `GET` | `/api/notes/{namespace}` | Get namespaced notes |
| `POST` | `/api/notes/{namespace}` | Save namespaced notes |

### Cloudflare zones

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cf/zones` | List zones |
| `POST` | `/api/cf/zones` | Create zone |
| `GET` | `/api/cf/zones/resolve/{domain}` | Resolve domain to zone |

### DNS

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cf/zones/{zone_id}/dns` | List DNS records |
| `POST` | `/api/cf/zones/{zone_id}/dns` | Create DNS record |
| `PATCH` | `/api/cf/zones/{zone_id}/dns/{record_id}` | Update DNS record |
| `DELETE` | `/api/cf/zones/{zone_id}/dns/{record_id}` | Delete DNS record |

### Analytics

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cf/zones/{zone_id}/analytics?days=7` | Cloudflare zone analytics |

### Redirects

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cf/redirects/lists` | List redirect lists |
| `GET` | `/api/cf/redirects/lists/{list_id}/items` | List redirect items |
| `POST` | `/api/cf/redirects/lists/{list_id}/items` | Add redirect items |
| `DELETE` | `/api/cf/redirects/lists/{list_id}/items` | Delete redirect items |

### Pages

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cf/pages/projects` | List Pages projects |
| `POST` | `/api/cf/pages/projects` | Create Pages project |
| `POST` | `/api/cf/pages/projects/{name}/deploy` | Trigger deployment |
| `GET` | `/api/cf/pages/projects/{name}/deployments/{id}` | Deployment status |

### Porkbun

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/porkbun/available` | Credential availability |
| `GET` | `/api/domains` | Domain list with CF status/pricing |
| `POST` | `/api/domains/{domain}/update-ns` | Update nameservers |
| `POST` | `/api/domains/{domain}/fix-cf` | Set Cloudflare-assigned nameservers |
| `POST` | `/api/porkbun/ns/{domain}` | Low-level nameserver update |

### Migadu

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/email/available` | Credential availability |
| `GET` | `/api/email/domains` | List email domains |
| `POST` | `/api/email/domains` | Add email domain |
| `GET` | `/api/email/domains/{domain}` | Domain details |
| `PATCH` | `/api/email/domains/{domain}` | Update domain settings |
| `GET` | `/api/email/domains/{domain}/dns-records` | Required DNS records |
| `GET` | `/api/email/domains/{domain}/diagnostics` | Diagnostics |
| `POST` | `/api/email/domains/{domain}/activate` | Activate domain |
| `GET` | `/api/email/domains/{domain}/catchall` | Get catch-all |
| `POST` | `/api/email/domains/{domain}/catchall` | Set catch-all |
| `DELETE` | `/api/email/domains/{domain}/catchall` | Clear catch-all |
| `POST` | `/api/email/domains/{domain}/setup-dns` | Add Migadu DNS records to Cloudflare |
| `GET` | `/api/email/mailboxes/{domain}` | List mailboxes |
| `POST` | `/api/email/mailboxes/{domain}` | Create mailbox |
| `PUT` | `/api/email/mailboxes/{domain}/{local_part}` | Update mailbox |
| `DELETE` | `/api/email/mailboxes/{domain}/{local_part}` | Delete mailbox |
| `GET` | `/api/email/aliases/{domain}` | List aliases |
| `POST` | `/api/email/aliases/{domain}` | Create alias |
| `DELETE` | `/api/email/aliases/{domain}/{local_part}` | Delete alias |
| `GET` | `/api/email/identities/{domain}/{mailbox}` | List identities |
| `POST` | `/api/email/identities/{domain}/{mailbox}` | Create identity |
| `DELETE` | `/api/email/identities/{domain}/{mailbox}/{id_local}` | Delete identity |

### Apps

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/apps` | Return `{core, shared, apps, other}` |
| `GET` | `/api/stats` | Live memory/CPU stats keyed by container name |
| `POST` | `/api/apps` | Clone a new app repo into `apps/{name}` |
| `POST` | `/api/apps/{name}/deploy` | `docker compose up -d --build` |
| `POST` | `/api/apps/{name}/pull-restart` | Git pull, then rebuild/redeploy |
| `POST` | `/api/apps/{name}/start` | `docker compose start` |
| `POST` | `/api/apps/{name}/stop` | `docker compose stop` |
| `POST` | `/api/apps/{name}/restart` | `docker compose restart` |
| `POST` | `/api/apps/{name}/delete` | Compose down, remove volumes/orphans, delete directory |
| `GET` | `/api/apps/{name}/logs?tail=200` | Logs from all app containers |
| `GET` | `/api/apps/{name}/git-status` | Git state for app directory |

### Raw containers

For core/shared/other containers that are not managed as app Compose projects:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/containers/{name}/start` | Start container |
| `POST` | `/api/containers/{name}/stop` | Stop container |
| `POST` | `/api/containers/{name}/restart` | Restart container |
| `GET` | `/api/containers/{name}/logs?tail=200` | Container logs |

### 3C self-update

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/3c/git-status` | Git state of the 3C repo |
| `POST` | `/api/3c/pull-restart` | Git pull and restart panel if needed |

## Run / update commands

```bash
# Rebuild and restart panel
cd /home/ubuntu/3c
docker compose -p 3c up -d --build panel

# Logs
docker logs 3c-panel -f

# Restart root services
cd /home/ubuntu/3c
docker compose -p 3c up -d
```

## Known panel gaps

- No first-class AI Backend status page yet.
- Container health is mostly process-level, not app-level readiness.
- Docker socket access means panel compromise is host compromise.
- App secrets are not fully standardized across all apps.
