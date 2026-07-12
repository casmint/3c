# Security Notes

3C is a personal control plane with powerful access. Treat it like infrastructure, not a normal website.

## Public boundary

Public traffic should enter only through Cloudflare Tunnel.

```text
Internet → Cloudflare → Cloudflare Tunnel → Traefik → app
```

Do not expose Traefik, the panel, Ollama, CompGate, or app ports directly on the Oracle host unless there is a deliberate reason.

## Cloudflare Access

The panel has no built-in auth. `3c.lol` must be protected by Cloudflare Access.

Admin surfaces for apps should also use Cloudflare Access where practical.

## Docker socket risk

The panel mounts the Docker socket:

```yaml
/var/run/docker.sock:/var/run/docker.sock
```

This means the panel can effectively control the host. A compromised panel is a compromised server.

Mitigations:

- protect panel with Cloudflare Access;
- keep panel dependencies minimal;
- avoid exposing panel API to unauthenticated users;
- avoid arbitrary shell endpoints unless heavily gated;
- prefer explicit app/container actions over general command execution.

## Secrets

Never commit real secrets.

Sensitive files include:

```text
/home/ubuntu/3c/.env
/home/ubuntu/3c/apps/*/.env
~/.config/3c/config.toml
*.db
```

Use `.env.example` for templates.

Recommended ignore patterns:

```gitignore
.env
apps/*/.env
*.db
__pycache__/
*.pyc
```

## Config file permissions

```bash
chmod 600 ~/.config/3c/config.toml
```

## Tailscale / CompGate boundary

Oracle reaches home GPU services through the `tailscale` container and socat forwards.

CompGate should require `X-API-Key` for app requests. The key should be shared to apps as `AI_GATEWAY_KEY` and not committed.

If the home PC is gaming or unavailable, CompGate may return 503. This is expected and safer than allowing server apps to fight the user for GPU resources.

## Generated docs / archives

When sharing repo archives with agents or humans, avoid including:

```text
.git/
.env
apps/*/.env
*.db
backups/
__pycache__/
.venv/
```

Safer archive pattern:

```bash
zip -r repo.zip . \
  -x '.git/*' \
  -x '.env' \
  -x 'apps/*/.env' \
  -x '*.db' \
  -x '*/__pycache__/*' \
  -x '*/.venv/*'
```
