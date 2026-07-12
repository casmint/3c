# Apps

Apps live under:

```text
/home/ubuntu/3c/apps/
```

The panel discovers apps automatically. There is no `apps.json`.

## Current app inventory

| App directory | Domain | Container | Networks | Backend / purpose |
|---|---|---|---|---|
| `vibeslopwiki` | `vibeslop.wiki` | `vibeslop-app` | `3c-network` | Hallucinatory wiki, Oracle Ollama CPU |
| `chatrequest` | `chatre.quest` | `chatrequest` | `3c-network` | Embeddable chatbot, Oracle Ollama CPU |
| `genquest` | `eld.quest` | `genquest` | `3c-network`, `gpu-network` | EldQuest, CompGate/home GPU |
| `cchannel` | `cchannel.org` | `cchannel` | `3c-network`, `gpu-network` | AI radio, CompGate/home GPU + TTS |
| `woketown` | `woke.town` | `woketown` | `3c-network` | Social network |
| `skitter-server` | `server.skitter.lol` | `skitter-server` | `3c-network` | Godot multiplayer server, WebSocket port 4567 |
| `klipke` | `klipke.com` | `klipke` | `3c-network` | Web app / game server |

## AI-backed apps

### vibeslopwiki

| Item | Value |
|---|---|
| Domain | `vibeslop.wiki` |
| Backend | Oracle-local Ollama |
| Endpoint | `http://oracle-ollama:11434/api/generate` |
| Model | `qwen2.5:1.5b` |
| Network | `3c-network` only |
| Database | SQLite volume |

Purpose: generate plausible-sounding fake encyclopedia articles and related stubs.

### chatrequest

| Item | Value |
|---|---|
| Domain | `chatre.quest` |
| Backend | Oracle-local Ollama |
| Endpoint | `http://oracle-ollama:11434/api/chat` |
| Model | `qwen2.5:1.5b` |
| Network | `3c-network` only |
| Database | SQLite volume |

Purpose: embeddable chatbot for static sites. Uses token/domain validation and rate limiting.

### genquest / EldQuest

| Item | Value |
|---|---|
| Domain | `eld.quest` |
| Backend | CompGate through Tailscale |
| Gateway | `http://tailscale:9090` |
| Model(s) | `MODEL_PROSE=gpt-oss:20b`, `MODEL_LOGIC=gpt-oss:20b` |
| Networks | `3c-network`, `gpu-network` |
| Database | SQLite volume |

Purpose: generated exploration/RPG world. Uses a thin `backend/compgate.py` client.

### CChannel

| Item | Value |
|---|---|
| Domain | `cchannel.org` |
| Backend | CompGate through Tailscale |
| Gateway | `http://tailscale:9090` |
| Model | `gpt-oss:20b` |
| TTS | Kokoro and Bark through CompGate |
| Networks | `3c-network`, `gpu-network` |
| Database/audio | SQLite + audio/music volumes |

Purpose: AI-generated radio station. Uses home GPU for script generation and home TTS for speech/audio.

## Non-AI / support apps

### woketown

Social network with posts, replies, follows, likes, and JWT auth.

Current note: architecture differs from the standard app template because it builds from a backend subdirectory and bind-mounts `data/` and `frontend/`. It works, but it is less consistent than the standard FastAPI app pattern.

### skitter-server

Godot 4 multiplayer server. Routes WebSocket traffic on internal port `4567` through Traefik.

### klipke

App at `klipke.com`, routed through Traefik on port `8000`.

## Panel classification

The panel groups Docker things into:

- **Core**: root services that are the platform itself: `panel`, `traefik`, `cloudflared`.
- **Shared**: root services that apps consume, such as Oracle Ollama and Tailscale/CompGate bridge helpers.
- **Apps**: discovered app directories under `apps/` with their own Compose files.
- **Other**: containers on the host not accounted for by the above.

## App metadata source of truth

App metadata belongs in the app repo, mostly in `docker-compose.yml`:

- domain: Traefik `Host()` label;
- port: Traefik load balancer label;
- networks: Compose `networks`;
- AI backend: environment variables and network membership;
- lifecycle: Docker Compose status;
- source state: Git status in app directory.

Do not create or update an `apps.json` file. It is obsolete.
