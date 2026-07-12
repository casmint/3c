# Manifest

This rewritten docs directory replaces the prior mixed/overlapping docs set.

## Kept / rewritten

| New file | Replaces / consolidates |
|---|---|
| `README.md` | docs landing page |
| `architecture.md` | old architecture notes plus current Docker/Tailscale/AI topology |
| `ai-backends.md` | new explicit documentation of Oracle Ollama vs CompGate/home GPU |
| `compgate.md` | old CompGate migration spec plus current app contract and tests |
| `apps.md` | old apps inventory, updated for genquest/cchannel/klipke and current AI routing |
| `adding-an-app.md` | old adding-an-app docs, updated for app autodetection and both AI tiers |
| `panel.md` | panel/API docs, updated for filesystem app registry |
| `operations.md` | operational commands and health checks |
| `security.md` | secrets, Docker socket, Cloudflare Access, Tailscale notes |
| `TODO.md` | current prioritized work |
| `legacy-c3-audit.md` | condensed legacy recovery inventory |
| `add-app-session.md` | replaces old short `add-app.md` prompt template |
| `my-domains.txt` | copied from previous docs |

## Removed as standalone files

These topics are now folded into the main docs:

- `compgate-migration-spec.md` → `compgate.md` and `ai-backends.md`
- `gpu-watchdog-old.md` → CompGate 503/game-pause sections in `compgate.md`
- `add-app.md` → `add-app-session.md`

## Explicit current truth

- `apps.json` is no longer used.
- App discovery is filesystem-based: subdirectories of `apps/` with Compose files.
- Oracle Ollama exists and is CPU-only.
- CompGate runs on the home PC, not on the Oracle server.
- Some apps intentionally use Oracle Ollama; others intentionally use CompGate.
