# 3C Docs

3C is a self-hosted personal cloud control plane running on the Oracle PAYG server at `/home/ubuntu/3c`.

It manages two kinds of things:

1. **Public infrastructure**: Cloudflare zones, DNS, analytics, Pages, redirects, Porkbun domains, Migadu email, and the Cloudflare Tunnel path into the server.
2. **Hosted apps**: Docker Compose apps under `apps/`, routed by Traefik and controlled by the 3C panel.

3C also hosts two AI tiers:

- **Oracle-local Ollama**: CPU-only Ollama on the Oracle server, currently used by lightweight apps with `qwen2.5:1.5b`.
- **Home GPU via CompGate**: a Tailscale bridge to the home PC, where CompGate fronts home Ollama, Kokoro, and Bark. This is used by heavier apps that need `gpt-oss:20b` or TTS.

## Current AI routing

| App | Domain | AI backend | Model/services |
|---|---|---|---|
| vibeslopwiki | `vibeslop.wiki` | Oracle Ollama | `qwen2.5:1.5b` CPU-only |
| chatrequest | `chatre.quest` | Oracle Ollama | `qwen2.5:1.5b` CPU-only |
| genquest / EldQuest | `eld.quest` | CompGate over Tailscale | home Ollama, `gpt-oss:20b` |
| CChannel | `cchannel.org` | CompGate over Tailscale | home Ollama `gpt-oss:20b`, home Kokoro, home Bark |

## Important current rule: no `apps.json`

`apps.json` is obsolete and must not be reintroduced.

The app registry is the filesystem:

```text
/home/ubuntu/3c/apps/{appname}/docker-compose.yml
```

Every subdirectory of `apps/` with its own Compose file is auto-detected by the panel. Domain, port, container status, and Git state are derived live from Docker Compose, Traefik labels, and the app directory.

## Docs map

| File | Purpose |
|---|---|
| [`architecture.md`](architecture.md) | Overall server, networks, ingress, and service layout |
| [`ai-backends.md`](ai-backends.md) | Oracle Ollama vs CompGate/home GPU routing |
| [`compgate.md`](compgate.md) | CompGate contract, expected endpoints, headers, and health checks |
| [`apps.md`](apps.md) | Current app inventory and backend ownership |
| [`adding-an-app.md`](adding-an-app.md) | Current app template, including both AI tiers |
| [`panel.md`](panel.md) | 3C panel backend/frontend structure and API surface |
| [`operations.md`](operations.md) | Common operational commands and checks |
| [`security.md`](security.md) | Secrets, Docker socket risk, Cloudflare Access, Tailscale boundaries |
| [`TODO.md`](TODO.md) | Current prioritized improvement list |
| [`legacy-c3-audit.md`](legacy-c3-audit.md) | Read-only inventory of old `~/c3-old` recoverable apps |
| [`add-app-session.md`](add-app-session.md) | Copyable prompt template for starting app work with an agent |
| [`my-domains.txt`](my-domains.txt) | Domain notes / inventory |
