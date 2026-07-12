# Legacy C3 Audit (`~/c3-old`)

`~/c3-old` is the predecessor of 3C, back when it was called **C3 — Container Control Center**. It is a separate project directory on the same host.

This file is a read-only recovery inventory. Do not treat old C3 architecture as the current pattern.

## Old C3 architecture

| Area | Old C3 | Current 3C |
|---|---|---|
| UI | FastAPI + Jinja2/HTMX/Alpine | FastAPI + vanilla JS SPA |
| Auth | HTTP Basic + optional IP allowlist | Cloudflare Access |
| App registry | old app model/types | filesystem autodetection under `apps/` |
| Network | `c3-network` | `3c-network` |
| External integrations | none | Cloudflare, Porkbun, Migadu |

Old app types included `stack`, `web`, and `worker`. Current 3C does not use an `apps.json` type system. A current app is simply a directory with its own Compose file.

## Recoverable apps noted from old C3

| App | Domain(s) | Stack | Notes |
|---|---|---|---|
| `76e-radio` | `76e.net`, `admin.76e.net` | AzuraCast + MariaDB + Redis | Complex multi-container migration. Has data volumes. |
| `cxtwitter` | `cxtwitter.com` | nginx proxy + custom archiver + MongoDB | Check old bind-mounted DB. |
| `signoutmaster` | `signout.act25.com` | custom app, port 5000 | Sign-out management tool. |
| `megumin-chat` | `megumin.lol` plus subdomains | custom chat app | Multiple Traefik routers from one container. |
| `cntbot` | none | Discord bot worker | Needs token from old env or regenerated. |
| `realbot` | none | Discord bot worker | Minimal active-dev bot. |
| `statics` | `76e.net`, `aei.my` | nginx static sites | Good first migration candidate, but reconcile domain overlap. |

## Migration rules

- Update `c3-network` to `3c-network`.
- Add or update Traefik labels for current routing.
- Add Cloudflare Tunnel public hostnames through Zero Trust dashboard.
- Do not migrate old `apps.json` concepts.
- Preserve app data carefully before running destructive Compose commands.
- Put migrated app under `/home/ubuntu/3c/apps/{appname}/` with its own Compose file.

Recommended order:

1. migrate a trivial static app first;
2. migrate `cxtwitter` or `76e-radio` only after confirming data paths and desired domains;
3. migrate workers only after secrets are handled cleanly.
