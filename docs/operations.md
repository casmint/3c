# Operations

Common commands for running 3C and debugging apps/backends.

## Root services

```bash
cd /home/ubuntu/3c

# Start/update root stack
docker compose -p 3c up -d

# Rebuild panel only
docker compose -p 3c up -d --build panel

# Root service status
docker compose -p 3c ps

# Panel logs
docker logs 3c-panel -f

# Tunnel logs
docker logs 3c-tunnel -f

# Traefik logs
docker logs traefik -f
```

## App lifecycle

```bash
cd /home/ubuntu/3c/apps/{appname}

# Status
docker compose ps

# Build and start
docker compose up -d --build

# Restart
docker compose restart

# Stop
docker compose stop

# Logs
docker compose logs -f --tail=200
```

## App autodetection sanity check

```bash
find /home/ubuntu/3c/apps -maxdepth 2 \
  \( -name 'docker-compose.yml' -o -name 'docker-compose.yaml' -o -name 'compose.yml' -o -name 'compose.yaml' \) \
  -print
```

If an app does not appear in the panel, check:

1. The directory exists under `/home/ubuntu/3c/apps/`.
2. It has a Compose file.
3. `docker compose config --format json` works inside the app directory.
4. Traefik labels are present and valid.

## Test Traefik routing internally

```bash
docker exec 3c-panel python - <<'PY'
import urllib.request
req = urllib.request.Request('http://traefik:80/', headers={'Host': 'example.com'})
print(urllib.request.urlopen(req).status)
PY
```

Replace `example.com` with the app domain.

## Oracle Ollama checks

From a container on `3c-network`:

```bash
docker run --rm --network 3c-network curlimages/curl:latest \
  -s http://oracle-ollama:11434/api/tags
```

Generation test:

```bash
docker run --rm --network 3c-network curlimages/curl:latest \
  -s http://oracle-ollama:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen2.5:1.5b",
    "prompt": "Reply with exactly: oracle ollama ok",
    "stream": false
  }'
```

## CompGate checks

From the Oracle host:

```bash
curl -s http://127.0.0.1:9090/health
```

From `gpu-network`, which is the path apps use:

```bash
docker run --rm --network gpu-network curlimages/curl:latest \
  -s http://tailscale:9090/health
```

LLM test:

```bash
docker run --rm --network gpu-network curlimages/curl:latest \
  -s http://tailscale:9090/api/chat \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $AI_GATEWAY_KEY" \
  -H 'X-Task: manual-test' \
  -d '{
    "model": "gpt-oss:20b",
    "messages": [{"role":"user","content":"Reply with exactly: compgate ok"}],
    "stream": false
  }'
```

Kokoro test:

```bash
docker run --rm --network gpu-network curlimages/curl:latest \
  -s http://tailscale:9090/tts/v1/audio/voices \
  -H "X-API-Key: $AI_GATEWAY_KEY"
```

Bark test:

```bash
docker run --rm --network gpu-network curlimages/curl:latest \
  -s http://tailscale:9090/bark/voices \
  -H "X-API-Key: $AI_GATEWAY_KEY"
```

## Tailscale bridge checks

```bash
# Root stack containers
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Networks}}'

# Tailscale status from the container
docker exec tailscale tailscale status

# Check home CompGate path from inside tailscale namespace
docker run --rm --network container:tailscale curlimages/curl:latest \
  -s http://127.0.0.1:9090/health
```

## Common failure guide

| Failure | Check |
|---|---|
| App not reachable publicly | Cloudflare Tunnel public hostname exists and points to `http://traefik:80`; Traefik labels correct |
| App not in panel | It has a Compose file under `apps/{name}/` and `docker compose config` succeeds |
| App reaches Traefik but not AI | Check network membership: Oracle Ollama apps need `3c-network`; CompGate apps need `3c-network` + `gpu-network` |
| Oracle Ollama slow | It is CPU-only; keep models small and prompts bounded |
| CompGate returns 503 | Home GPU paused/busy/offline; app should retry or degrade gracefully |
| CompGate unreachable from app | `gpu-network` missing, Tailscale down, wrong home IP/port, or home PC offline |
| Panel app actions fail | Docker socket/binary mount, root project name, or app Compose error |

## Safe restart order

When the platform feels cursed, restart in this order:

```bash
cd /home/ubuntu/3c
docker compose -p 3c up -d cloudflared traefik oracle-ollama tailscale gpu-proxy-compgate panel
```

Then restart affected apps individually.
