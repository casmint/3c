# CompGate

CompGate is the AI gateway running on the home PC. It is not installed as part of the 3C repo, but 3C apps can reach it through Tailscale.

CompGate fronts home AI services:

```text
CompGate :9090
   ├── home Ollama :11434       gpt-oss:20b
   ├── home Kokoro :8880        TTS
   └── home Bark :8881          expressive/slow TTS
```

From Oracle-side app containers, the intended URL is:

```text
http://tailscale:9090
```

That name resolves to the `tailscale` container on `gpu-network`; `gpu-proxy-compgate` listens on port `9090` inside that network namespace and forwards to the home PC's Tailscale IP.

## Root Compose bridge

Relevant root services:

```text
tailscale
  - joins gpu-network
  - owns the Tailscale network namespace
  - publishes 127.0.0.1:9090 on the Oracle host for host-level tools

gpu-proxy-compgate
  - alpine/socat
  - network_mode: service:tailscale
  - listens on :9090
  - forwards to ${HOME_GPU_TAILSCALE_IP}:${HOME_GPU_COMPGATE_PORT:-9090}
```

Host-level tools on Oracle can use:

```text
http://127.0.0.1:9090
```

App containers on `gpu-network` should use:

```text
http://tailscale:9090
```

## Required app config

```env
AI_GATEWAY=http://tailscale:9090
AI_GATEWAY_KEY=...
MODEL_NAME=gpt-oss:20b
```

EldQuest/GenQuest uses:

```env
MODEL_PROSE=gpt-oss:20b
MODEL_LOGIC=gpt-oss:20b
```

## Required headers

LLM requests should include:

```http
X-API-Key: <AI_GATEWAY_KEY>
X-Task: eldquest|cchannel|other-task-name
Content-Type: application/json
```

TTS requests should include:

```http
X-API-Key: <AI_GATEWAY_KEY>
Content-Type: application/json
```

`X-Task` is useful for routing/logging/model policy on LLM requests. CChannel currently does not use `X-Task` for TTS calls.

## Expected API contract

CompGate should behave like a mostly Ollama-compatible gateway for chat requests and like a path router for TTS.

### Health

```http
GET /health
```

Expected success:

```json
{"status":"ok"}
```

### LLM chat

```http
POST /api/chat
```

Expected request shape:

```json
{
  "model": "gpt-oss:20b",
  "messages": [
    {"role": "user", "content": "Reply with exactly: compgate ok"}
  ],
  "stream": false,
  "options": {"temperature": 0.7}
}
```

Expected non-streaming response shape should match Ollama enough for clients to read:

```json
{
  "message": {"content": "..."}
}
```

Streaming responses should be newline-delimited JSON compatible with Ollama `/api/chat`, where clients read:

```python
data.get("message", {}).get("content", "")
```

### Kokoro TTS

```http
GET /tts/v1/audio/voices
POST /tts/v1/audio/speech
```

CChannel expects `/tts/v1/audio/speech` to return MP3 bytes when given an OpenAI-ish request:

```json
{
  "model": "kokoro",
  "input": "text to speak",
  "voice": "am_onyx",
  "response_format": "mp3",
  "speed": 1.0
}
```

### Bark

```http
GET /bark/voices
POST /bark/generate
```

CChannel expects `/bark/generate` to return JSON containing at least:

```json
{
  "audio_base64": "...",
  "sample_rate": 24000
}
```

## GPU pause behavior

CompGate is expected to return HTTP `503` when the home GPU is unavailable, paused, or reserved for games.

Clients should treat `503` as recoverable, not fatal. Existing clients raise `GatewayUnavailableError` so app-level logic can pause, retry, or surface a friendly unavailable state.

This is part of the design: games on the home PC take priority over AI jobs.

## Layered health checks

### 1. On the home PC

```bash
curl -s http://localhost:9090/health
curl -s http://localhost:11434/api/tags
```

LLM test:

```bash
curl -s http://localhost:9090/api/chat \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $AI_GATEWAY_KEY" \
  -H 'X-Task: manual-test' \
  -d '{
    "model": "gpt-oss:20b",
    "messages": [{"role":"user","content":"Reply with exactly: compgate ok"}],
    "stream": false
  }'
```

### 2. From the Oracle host

```bash
curl -s http://127.0.0.1:9090/health
```

If this works, the root compose port mapping to the `tailscale` namespace is working.

### 3. From the Tailscale namespace

```bash
docker run --rm --network container:tailscale curlimages/curl:latest \
  http://127.0.0.1:9090/health
```

### 4. From the app network

```bash
docker run --rm --network gpu-network curlimages/curl:latest \
  http://tailscale:9090/health
```

This is the most important test for app reachability.

### 5. Full LLM test from `gpu-network`

```bash
docker run --rm --network gpu-network curlimages/curl:latest \
  -s http://tailscale:9090/api/chat \
  -H 'Content-Type: application/json' \
  -H "X-API-Key: $AI_GATEWAY_KEY" \
  -H 'X-Task: manual-test' \
  -d '{
    "model": "gpt-oss:20b",
    "messages": [{"role":"user","content":"Reply with exactly: 3c can reach compgate"}],
    "stream": false
  }'
```

### 6. TTS tests from `gpu-network`

Kokoro voices:

```bash
docker run --rm --network gpu-network curlimages/curl:latest \
  -s http://tailscale:9090/tts/v1/audio/voices \
  -H "X-API-Key: $AI_GATEWAY_KEY"
```

Bark voices:

```bash
docker run --rm --network gpu-network curlimages/curl:latest \
  -s http://tailscale:9090/bark/voices \
  -H "X-API-Key: $AI_GATEWAY_KEY"
```

## Common failures

| Symptom | Likely cause |
|---|---|
| Home `localhost:9090` fails | CompGate service not running on home PC |
| Oracle `127.0.0.1:9090` fails | Tailscale container/proxy down, wrong `HOME_GPU_TAILSCALE_IP`, or home PC unreachable |
| `http://tailscale:9090` fails inside app | App is not on `gpu-network` or DNS/container networking issue |
| LLM returns 401/403 | Missing or wrong `AI_GATEWAY_KEY` |
| LLM returns 503 | GPU paused/busy/offline; app should retry or degrade gracefully |
| Kokoro/Bark endpoints fail but `/health` works | CompGate is up but TTS backend is down on home PC |

## Current app clients

- `apps/genquest/backend/compgate.py`: thin LLM transport for EldQuest.
- `apps/cchannel/backend/compgate.py`: LLM + Kokoro + Bark transport for CChannel.

Both clients intentionally avoid hardcoding `num_ctx` defaults or `keep_alive`; model lifecycle and routing policy belong in CompGate/home Ollama, not in each app.
