# Adding a New App to 3C

This is the current app model. It does not use `apps.json`.

An app is any directory under `/home/ubuntu/3c/apps/` with its own Compose file.

```text
/home/ubuntu/3c/apps/{appname}/docker-compose.yml
```

The panel auto-detects it, reads its Traefik labels, and manages it with Docker Compose.

## Quick checklist

1. Create or clone the app under `/home/ubuntu/3c/apps/{appname}/`.
2. Ensure the app has its own `docker-compose.yml`.
3. Ensure the app joins `3c-network`.
4. Add Traefik labels for domain routing.
5. Add a public hostname in the Cloudflare Tunnel dashboard pointing to `http://traefik:80`.
6. Deploy from the app directory:

```bash
cd /home/ubuntu/3c/apps/{appname}
docker compose up -d --build
```

The app should now appear in 3C's `/apps` panel.

## Standard FastAPI app structure

```text
apps/{appname}/
  Dockerfile
  docker-compose.yml
  .env
  .env.example
  backend/
    main.py
    db.py
    requirements.txt
  frontend/
    index.html
    app.js
    style.css
```

## Dockerfile template

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY frontend/ ./frontend/
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Base Compose template: no AI

```yaml
services:
  app:
    build: .
    container_name: {appname}
    restart: unless-stopped
    mem_limit: 512m
    env_file: .env
    environment:
      - DB_PATH=/data/{appname}.db
    volumes:
      - app_data:/data
    networks:
      - 3c-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.{appname}.rule=Host(`{domain}`)"
      - "traefik.http.routers.{appname}.entrypoints=web"
      - "traefik.http.services.{appname}.loadbalancer.server.port=8000"
      - "traefik.docker.network=3c-network"

volumes:
  app_data:

networks:
  3c-network:
    external: true
```

## Template: Oracle-local Ollama app

Use this for lightweight CPU-only AI on the Oracle server.

```yaml
services:
  app:
    build: .
    container_name: {appname}
    restart: unless-stopped
    mem_limit: 512m
    env_file: .env
    environment:
      - OLLAMA_HOST=http://oracle-ollama:11434
      - MODEL_NAME=qwen2.5:1.5b
      - DB_PATH=/data/{appname}.db
    volumes:
      - app_data:/data
    networks:
      - 3c-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.{appname}.rule=Host(`{domain}`)"
      - "traefik.http.routers.{appname}.entrypoints=web"
      - "traefik.http.services.{appname}.loadbalancer.server.port=8000"
      - "traefik.docker.network=3c-network"

volumes:
  app_data:

networks:
  3c-network:
    external: true
```

Python single-turn example:

```python
import json
import os
import httpx

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://oracle-ollama:11434")
MODEL_NAME = os.environ.get("MODEL_NAME", "qwen2.5:1.5b")

async def generate(prompt: str):
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", f"{OLLAMA_HOST}/api/generate", json={
            "model": MODEL_NAME,
            "prompt": prompt,
            "stream": True,
            "options": {"num_ctx": 2048},
        }) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                data = json.loads(line)
                if data.get("done"):
                    break
                yield data.get("response", "")
```

Python chat example:

```python
async with httpx.AsyncClient(timeout=120.0) as client:
    async with client.stream("POST", f"{OLLAMA_HOST}/api/chat", json={
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "Hello"},
        ],
        "stream": True,
        "options": {"num_ctx": 2048, "num_predict": 256},
    }) as resp:
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            data = json.loads(line)
            if data.get("done"):
                break
            token = data.get("message", {}).get("content", "")
```

## Template: CompGate/home GPU app

Use this for apps that need `gpt-oss:20b` or home TTS.

```yaml
services:
  app:
    build: .
    container_name: {appname}
    restart: unless-stopped
    mem_limit: 512m
    env_file: .env
    environment:
      - AI_GATEWAY=${AI_GATEWAY:-http://tailscale:9090}
      - AI_GATEWAY_KEY=${AI_GATEWAY_KEY}
      - MODEL_NAME=${MODEL_NAME:-gpt-oss:20b}
      - DB_PATH=/data/{appname}.db
    volumes:
      - app_data:/data
    networks:
      - 3c-network
      - gpu-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.{appname}.rule=Host(`{domain}`)"
      - "traefik.http.routers.{appname}.entrypoints=web"
      - "traefik.http.services.{appname}.loadbalancer.server.port=8000"
      - "traefik.docker.network=3c-network"

volumes:
  app_data:

networks:
  3c-network:
    external: true
  gpu-network:
    external: true
```

Python CompGate chat example:

```python
import os
import httpx

AI_GATEWAY = os.environ.get("AI_GATEWAY", "http://tailscale:9090")
AI_GATEWAY_KEY = os.environ.get("AI_GATEWAY_KEY", "")
MODEL_NAME = os.environ.get("MODEL_NAME", "gpt-oss:20b")

async def chat_once(messages: list[dict], task: str) -> str:
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{AI_GATEWAY}/api/chat",
            headers={
                "X-API-Key": AI_GATEWAY_KEY,
                "X-Task": task,
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL_NAME,
                "messages": messages,
                "stream": False,
            },
        )
    if resp.status_code == 503:
        raise RuntimeError("CompGate unavailable: GPU paused or offline")
    resp.raise_for_status()
    return resp.json().get("message", {}).get("content", "")
```

## FastAPI static-file pattern

```python
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

@app.get("/")
async def index():
    return FileResponse("frontend/index.html")

# API routes here.

# Mount static last.
app.mount("/static", StaticFiles(directory="frontend"), name="static")
```

## SQLite pattern

```python
import os
import sqlite3

DB_PATH = os.environ.get("DB_PATH", "app.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
```

## Cloudflare Tunnel hostname

The panel API token does not manage tunnel public hostnames. Add app hostnames in the Cloudflare Zero Trust dashboard:

1. Zero Trust → Networks → Tunnels.
2. Open the 3C tunnel.
3. Configure → Public Hostname → Add.
4. Hostname: `{domain}`.
5. Service: `HTTP` → `http://traefik:80`.

## Cloudflare Access

Admin apps should be protected at Cloudflare Access. The app itself does not need login code if Cloudflare Access blocks unauthenticated traffic before it reaches Traefik.

## App clone/deploy from panel

`POST /api/apps` can clone a repo into `apps/{name}`. The repo must already contain a Compose file following this document. 3C does not auto-generate Dockerfiles or inject app metadata from `apps.json`.

## Troubleshooting

```bash
# List all containers
docker ps -a

# List detected app dirs
find /home/ubuntu/3c/apps -maxdepth 2 -name 'docker-compose.yml' -print

# App logs
docker logs {container_name} -f

# App compose status
cd /home/ubuntu/3c/apps/{appname}
docker compose ps

# Rebuild one app
cd /home/ubuntu/3c/apps/{appname}
docker compose up -d --build

# Test Traefik routing internally
docker exec 3c-panel python - <<'PY'
import urllib.request
req = urllib.request.Request('http://traefik:80/', headers={'Host': '{domain}'})
print(urllib.request.urlopen(req).status)
PY
```
