# 3C Infrastructure Architecture

## Overview

3C runs on an Oracle PAYG ARM64 server. Public traffic enters only through Cloudflare Tunnel, then reaches Traefik, then the appropriate app container.

```text
Internet
   ↓
Cloudflare
   - TLS termination
   - DDoS protection
   - Cloudflare Access for admin surfaces
   ↓ Cloudflare Tunnel
3c-tunnel container
   ↓ http://traefik:80
Traefik v2.11
   ↓ Host() routing from Docker labels
App containers on 3c-network
```

No public host ports are required for app traffic. Cloudflare Tunnel is the public ingress path.

## Server

| Item | Value |
|---|---|
| Provider | Oracle Cloud Infrastructure PAYG |
| Architecture | ARM64 / aarch64 |
| RAM | about 23 GB |
| Shell user | `ubuntu` |
| Project root | `/home/ubuntu/3c` |
| Panel URL | `https://3c.lol` |

## Root Compose services

Root services live in `/home/ubuntu/3c/docker-compose.yml`.

| Service | Container | Network(s) | Purpose |
|---|---|---|---|
| `cloudflared` | `3c-tunnel` | `3c-network` | Cloudflare Tunnel client |
| `traefik` | `traefik` | `3c-network` | Internal reverse proxy |
| `panel` | `3c-panel` | `3c-network` | 3C control panel |
| `oracle-ollama` | `oracle-ollama` | `3c-network` | Oracle-local CPU-only Ollama |
| `tailscale` | `tailscale` | `gpu-network` | Tailscale namespace used by GPU bridge containers |
| `gpu-proxy` | `gpu-proxy` | `network_mode: service:tailscale` | Legacy/debug forward to home Ollama `:11434` |
| `gpu-proxy-kokoro` | `gpu-proxy-kokoro` | `network_mode: service:tailscale` | Legacy/debug forward to home Kokoro `:8880` |
| `gpu-proxy-bark` | `gpu-proxy-bark` | `network_mode: service:tailscale` | Legacy/debug forward to home Bark `:8881` |
| `gpu-proxy-compgate` | `gpu-proxy-compgate` | `network_mode: service:tailscale` | Forward to home CompGate `:9090` |

The direct `gpu-proxy`, `gpu-proxy-kokoro`, and `gpu-proxy-bark` forwards may still exist for legacy/debug access. New app integrations should prefer CompGate at `http://tailscale:9090` so each app talks to one gateway instead of directly coupling itself to home Ollama/Kokoro/Bark.

## Docker networks

### `3c-network`

Main application network. Traefik, the panel, Oracle Ollama, and public app containers join this network.

Apps must join this network to be reachable by Traefik.

```yaml
networks:
  3c-network:
    external: true
```

### `gpu-network`

Private network for app containers that need home GPU services through the Tailscale bridge.

Apps using CompGate must join both networks:

```yaml
networks:
  - 3c-network
  - gpu-network
```

Traefik should still be told to route over `3c-network`:

```yaml
labels:
  - "traefik.docker.network=3c-network"
```

## Ingress and routing

Cloudflare Tunnel public hostnames should point to:

```text
http://traefik:80
```

Traefik performs final routing using app labels:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.{name}.rule=Host(`{domain}`)"
  - "traefik.http.routers.{name}.entrypoints=web"
  - "traefik.http.services.{name}.loadbalancer.server.port=8000"
  - "traefik.docker.network=3c-network"
```

TLS is terminated at Cloudflare. Traefik only needs HTTP internally.

## App discovery: filesystem registry

There is no registry database and no `apps.json`.

The panel discovers apps by scanning:

```text
/home/ubuntu/3c/apps/
```

Any child directory with one of these files is an app:

```text
docker-compose.yml
docker-compose.yaml
compose.yml
compose.yaml
```

The panel derives metadata from live Docker/Compose state:

- domain and port from Traefik labels in the app Compose file;
- container status from `docker compose ps`;
- Git state from the app directory;
- resource stats from `docker stats`.

This means app metadata should live in the app's Compose file, not in a separate registry file.

## AI architecture

3C currently has two AI stacks.

```text
Lightweight apps
   ↓
Oracle-local Ollama
   ↓
qwen2.5:1.5b on CPU
```

```text
Heavy apps / TTS apps
   ↓
http://tailscale:9090 on gpu-network
   ↓
gpu-proxy-compgate
   ↓
Tailscale to home PC
   ↓
CompGate
   ↓
home Ollama / Kokoro / Bark
```

See [`ai-backends.md`](ai-backends.md) and [`compgate.md`](compgate.md).

## Secrets and config locations

| Path | Purpose |
|---|---|
| `/home/ubuntu/3c/.env` | Root compose variables: Cloudflare tunnel token, GitHub token, Tailscale auth key, home GPU IP/ports |
| `~/.config/3c/config.toml` | Cloudflare, Porkbun, Migadu API credentials for the panel |
| `apps/{app}/.env` | Per-app secrets and runtime config |

Do not commit real `.env` files. Use `.env.example` for templates.
