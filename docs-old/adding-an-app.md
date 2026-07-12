# Adding a New App to 3c

## Quick Checklist

1. Create `/home/ubuntu/3c/apps/{appname}/`
2. Write `Dockerfile` (python:3.12-slim pattern)
3. Write `docker-compose.yml` (join 3c-network, add traefik labels)
4. Write your app code
5. Build and start: `cd apps/{appname} && docker compose up -d --build`
6. Add hostname to Cloudflare tunnel (Zero Trust dashboard)

## Standard App Structure

```
apps/{appname}/
  Dockerfile
  docker-compose.yml
  .env
  .env.example
  backend/
    main.py           # FastAPI app
    db.py             # SQLite (raw sqlite3 + WAL mode)
    requirements.txt
  frontend/
    index.html        # Vanilla HTML/JS/CSS, no build step
```

## `Dockerfile` Template

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY frontend/ ./frontend/
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## `docker-compose.yml` Template

```yaml
services:
  app:
    build: .
    container_name: {appname}
    environment:
      - OLLAMA_HOST=http://ollama:11434   # if using Ollama
      - MODEL_NAME=qwen2.5:1.5b
      - DB_PATH=/data/{appname}.db
    volumes:
      - app_data:/data
    restart: unless-stopped
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

## `backend/requirements.txt` (standard stack)

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
httpx==0.27.2
sse-starlette==2.1.3
```

## SQLite Pattern (`backend/db.py`)

```python
import sqlite3, os

DB_PATH = os.environ.get("DB_PATH", "app.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ...;
    """)
    conn.close()
```

## FastAPI Pattern (`backend/main.py`)

```python
import logging
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

logging.basicConfig(level=logging.INFO)
app = FastAPI()

@app.on_event("startup")
def startup():
    init_db()

@app.get("/")
async def index():
    return FileResponse("frontend/index.html")

# ... routes ...

# MUST be last — static mount catches everything else
app.mount("/static", StaticFiles(directory="frontend"), name="static")
```

## Ollama Usage

Access Ollama from any app on 3c-network:

```python
# Single-turn (vibeslopwiki pattern)
async with httpx.AsyncClient(timeout=600.0) as client:
    async with client.stream("POST", f"{OLLAMA_HOST}/api/generate", json={
        "model": MODEL_NAME, "prompt": "...", "stream": True,
        "options": {"num_ctx": 2048},
    }) as resp:
        async for line in resp.aiter_lines():
            data = json.loads(line)
            if data.get("done"): break
            yield data.get("response", "")

# Multi-turn (chatrequest pattern)
async with httpx.AsyncClient(timeout=120.0) as client:
    async with client.stream("POST", f"{OLLAMA_HOST}/api/chat", json={
        "model": MODEL_NAME,
        "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}],
        "stream": True, "options": {"num_ctx": 2048, "num_predict": 256},
    }) as resp:
        async for line in resp.aiter_lines():
            data = json.loads(line)
            if data.get("done"): break
            yield data.get("message", {}).get("content", "")
```

## SSE Streaming (FastAPI)

```python
from sse_starlette.sse import EventSourceResponse

@app.get("/api/stream/{slug}")
async def stream(slug: str):
    async def generate():
        async for token in my_llm_stream():
            yield {"event": "token", "data": token}
        yield {"event": "done", "data": ""}

    return EventSourceResponse(
        generate(),
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
```

## Adding the Cloudflare Tunnel Hostname

The API token in config.toml does NOT have tunnel management permissions. Add new hostnames via the **Cloudflare Zero Trust dashboard**:

1. Go to Zero Trust → Networks → Tunnels
2. Find the tunnel (ID: `2d44e991-6a1b-4bc0-af13-a05498efa10d`)
3. Configure → Public Hostname → Add
4. Hostname: `{domain}`, Service: `HTTP`, URL: `traefik:80`

## Cloudflare Access (Admin Protection)

To protect an admin route behind Google OAuth (like 3c.lol and chatre.quest):
- Go to Zero Trust → Access → Applications → Add
- No code changes needed in the app — Cloudflare handles auth before the request reaches the container

## Troubleshooting

```bash
# Check all containers
docker ps

# View app logs
docker logs {appname} -f

# Test routing through traefik internally
docker exec 3c-panel python -c "
import urllib.request
req = urllib.request.Request('http://traefik:80/', headers={'Host': '{domain}'})
print(urllib.request.urlopen(req).status)
"

# Restart a service
cd /home/ubuntu/3c/apps/{appname} && docker compose restart

# Rebuild after code changes
cd /home/ubuntu/3c/apps/{appname} && docker compose up -d --build
```
