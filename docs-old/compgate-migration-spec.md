# Compgate Migration Spec — EldQuest and CChannel

## What this document covers

Both EldQuest and CChannel currently call Ollama, Kokoro, and Bark directly via
Tailscale. This spec migrates both apps to route all AI calls through Compgate instead.
Direct service connections are removed entirely.

Read `ai-router-spec.md` (the Compgate spec) first.

---

## The change in one sentence

Every app swaps its individual service URLs for a single Compgate URL, adds two headers
to every request, and handles 503 responses gracefully.

---

## Compgate connection details

```
Tailscale hostname:  http://home-ai.your-tailnet.ts.net:9090
                     (or whatever your Tailscale MagicDNS hostname is)
Local (home PC):     http://localhost:9090
API key:             set in Compgate config.yaml, shared to all apps via env
```

---

## Environment variable changes

### EldQuest (`.env`)

```bash
# Remove these:
OLLAMA_HOST=http://...
MODEL_PROSE=qwen2.5:14b
MODEL_LOGIC=qwen2.5:1.5b

# Add these:
AI_GATEWAY=http://home-ai.your-tailnet.ts.net:9090
AI_GATEWAY_KEY=your-compgate-api-key
MODEL_PROSE=gpt-oss:20b
MODEL_LOGIC=gpt-oss:20b
```

### CChannel (`.env`)

```bash
# Remove these:
OLLAMA_HOST=http://...
KOKORO_HOST=http://...
BARK_HOST=http://...
MODEL_NAME=qwen2.5:1.5b

# Add these:
AI_GATEWAY=http://home-ai.your-tailnet.ts.net:9090
AI_GATEWAY_KEY=your-compgate-api-key
MODEL_NAME=gpt-oss:20b
```

---

## EldQuest changes

### New shared HTTP client helper (`backend/compgate.py`)

Add this file. All LLM calls in EldQuest go through it.

```python
"""
compgate.py — Compgate client for EldQuest.
Replaces direct Ollama calls. All requests route through Compgate.
"""

import httpx, os, logging, json

logger = logging.getLogger(__name__)

GATEWAY_URL = os.getenv("AI_GATEWAY", "http://localhost:9090")
GATEWAY_KEY = os.getenv("AI_GATEWAY_KEY", "")

GATEWAY_HEADERS = {
    "X-API-Key": GATEWAY_KEY,
    "X-Task": "eldquest",
    "Content-Type": "application/json",
}


class GatewayUnavailableError(Exception):
    """Raised when Compgate returns 503 — GPU is paused (game running)."""
    pass


async def call_logic_json(prompt: str, temperature: float = 0.2) -> dict:
    """
    Send a logic/validation prompt to Compgate → Ollama → gpt-oss:20b.
    Returns parsed JSON dict. Raises GatewayUnavailableError on 503.
    """
    model = os.getenv("MODEL_LOGIC", "gpt-oss:20b")

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "format": "json",
        "options": {"temperature": temperature, "num_ctx": 4096},
    }

    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{GATEWAY_URL}/api/chat",
                    json=payload,
                    headers=GATEWAY_HEADERS,
                )

            if resp.status_code == 503:
                raise GatewayUnavailableError(resp.json().get("detail", "GPU unavailable"))

            resp.raise_for_status()
            raw = resp.json().get("message", {}).get("content", "")

            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                if attempt == 0:
                    prompt = "Respond ONLY with valid JSON. No other text.\n\n" + prompt
                    continue
                raise ValueError(f"Invalid JSON after 2 attempts: {raw[:200]}")

        except GatewayUnavailableError:
            raise
        except Exception as e:
            if attempt == 1:
                raise
            logger.warning(f"compgate: attempt {attempt+1} failed: {e}, retrying")

    raise ValueError("call_logic_json failed after retries")


async def stream_prose(prompt: str, temperature: float = 0.85):
    """
    Stream prose generation from Compgate → Ollama → gpt-oss:20b.
    Yields text tokens. Raises GatewayUnavailableError on 503.
    """
    model = os.getenv("MODEL_PROSE", "gpt-oss:20b")

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": True,
        "options": {"temperature": temperature, "num_ctx": 4096},
    }

    async with httpx.AsyncClient(timeout=600.0) as client:
        async with client.stream(
            "POST",
            f"{GATEWAY_URL}/api/generate",
            json=payload,
            headers=GATEWAY_HEADERS,
        ) as resp:
            if resp.status_code == 503:
                detail = await resp.aread()
                raise GatewayUnavailableError(detail.decode())

            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if data.get("done"):
                        break
                    yield data.get("response", "")
                except json.JSONDecodeError:
                    continue
```

### Update `backend/validator.py`

Replace all direct Ollama `httpx` calls with imports from `compgate.py`.

```python
# Remove:
from httpx import AsyncClient
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# Add:
from backend.compgate import call_logic_json, GatewayUnavailableError

# Every function that calls the logic model:
# Was:
async with httpx.AsyncClient(timeout=120.0) as client:
    resp = await client.post(f"{OLLAMA_HOST}/api/chat", json={...})
    raw = resp.json()["message"]["content"]
    return json.loads(raw)

# Now:
return await call_logic_json(prompt, temperature=0.2)
```

### Update `backend/generator.py`

Replace streaming Ollama calls with `stream_prose`:

```python
# Remove:
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# Add:
from backend.compgate import stream_prose, GatewayUnavailableError

# Was:
async with httpx.AsyncClient(timeout=600.0) as client:
    async with client.stream("POST", f"{OLLAMA_HOST}/api/generate", json={...}) as resp:
        async for line in resp.aiter_lines():
            ...

# Now:
async for token in stream_prose(prompt, temperature=0.85):
    yield {"event": "token", "data": token}
```

### 503 handling in `engine.py`

When Compgate returns 503, the GPU is in use by a game. Handle it gracefully:

```python
from backend.compgate import GatewayUnavailableError

# In run_pipeline(), wrap the validation and prose calls:
try:
    [pipeline steps]
except GatewayUnavailableError as e:
    logger.warning(f"engine: Compgate unavailable: {e}")
    # Clear processing flag so player isn't stuck
    clear_processing_flag(character_id, universe_id)
    # Return a neutral in-world denial — not an error message
    yield {
        "event": "denied",
        "data": "The world grows quiet for a moment. Try again shortly."
    }
    return
```

The player gets a soft denial that doesn't break immersion. They can retry immediately
or in a few seconds. No state is corrupted because the pipeline exits cleanly before
any DB writes.

---

## CChannel changes

### New shared client (`backend/compgate.py`)

Same pattern as EldQuest but with different task header and TTS/Bark routing.

```python
"""
compgate.py — Compgate client for CChannel.
"""

import httpx, os, logging, json, base64

logger = logging.getLogger(__name__)

GATEWAY_URL = os.getenv("AI_GATEWAY", "http://localhost:9090")
GATEWAY_KEY = os.getenv("AI_GATEWAY_KEY", "")

LLM_HEADERS = {
    "X-API-Key": GATEWAY_KEY,
    "X-Task": "cchannel",
    "Content-Type": "application/json",
}

TTS_HEADERS = {
    "X-API-Key": GATEWAY_KEY,
    "Content-Type": "application/json",
}


class GatewayUnavailableError(Exception):
    pass


async def generate_script(prompt: str, system: str = "", temperature: float = 0.85) -> str:
    """
    Generate a radio segment script via Compgate → gpt-oss:20b.
    Returns raw text. Raises GatewayUnavailableError on 503.
    """
    model = os.getenv("MODEL_NAME", "gpt-oss:20b")
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{GATEWAY_URL}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"temperature": temperature, "num_ctx": 4096},
            },
            headers=LLM_HEADERS,
        )

    if resp.status_code == 503:
        raise GatewayUnavailableError(resp.json().get("detail", "GPU paused"))

    resp.raise_for_status()
    return resp.json().get("message", {}).get("content", "")


async def extract_lore(prompt: str) -> dict:
    """JSON extraction call for lore mining."""
    model = os.getenv("MODEL_NAME", "gpt-oss:20b")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{GATEWAY_URL}/api/chat",
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.2, "num_ctx": 2048},
            },
            headers=LLM_HEADERS,
        )

    if resp.status_code == 503:
        raise GatewayUnavailableError("GPU paused during lore extraction")

    resp.raise_for_status()
    raw = resp.json().get("message", {}).get("content", "")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"new_facts": [], "storyline_updates": []}


async def generate_kokoro_tts(script: str, voice_id: str) -> tuple[bytes, float]:
    """
    Send TTS request through Compgate → Kokoro.
    Returns (audio_bytes, duration_seconds).
    """
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{GATEWAY_URL}/tts/v1/audio/speech",   # /tts/ prefix → Compgate routes to Kokoro
            json={
                "model": "kokoro",
                "input": script,
                "voice": voice_id,
                "response_format": "mp3",
                "speed": 1.0,
            },
            headers=TTS_HEADERS,
        )

    if resp.status_code == 503:
        raise GatewayUnavailableError("GPU paused — Kokoro unavailable")

    resp.raise_for_status()
    return resp.content


async def generate_bark_audio(script: str, voice_preset: str) -> dict:
    """
    Send Bark request through Compgate → Bark server.
    Returns Bark response dict with audio_base64.
    """
    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.post(
            f"{GATEWAY_URL}/bark/generate",   # /bark/ prefix → Compgate routes to Bark
            json={
                "text": script,
                "voice_preset": voice_preset,
                "use_small_model": os.getenv("BARK_QUALITY", "large") == "small",
            },
            headers=TTS_HEADERS,
        )

    if resp.status_code == 503:
        raise GatewayUnavailableError("GPU paused — Bark unavailable")

    resp.raise_for_status()
    return resp.json()
```

### Update `backend/generator.py`

```python
# Remove:
OLLAMA_HOST = os.getenv("OLLAMA_HOST")

# Add:
from backend.compgate import generate_script, extract_lore, GatewayUnavailableError

# Was:
async with httpx.AsyncClient(timeout=120.0) as client:
    resp = await client.post(f"{OLLAMA_HOST}/api/chat", json={...})
    return resp.json()["message"]["content"]

# Now:
return await generate_script(prompt, system=system_prompt)
```

### Update `backend/tts.py`

```python
# Remove:
KOKORO_HOST = os.getenv("KOKORO_HOST")

# Add:
from backend.compgate import generate_kokoro_tts, GatewayUnavailableError

# Was:
async with httpx.AsyncClient(timeout=120.0) as client:
    resp = await client.post(f"{KOKORO_HOST}/v1/audio/speech", json={...})
    audio_bytes = resp.content

# Now:
audio_bytes = await generate_kokoro_tts(script, voice_id)
```

### Update `backend/bark.py`

```python
# Remove:
BARK_HOST = os.getenv("BARK_HOST")

# Add:
from backend.compgate import generate_bark_audio, GatewayUnavailableError

# Was:
async with httpx.AsyncClient(timeout=300.0) as client:
    resp = await client.post(f"{BARK_HOST}/bark/generate", json={...})
    return resp.json()

# Now:
return await generate_bark_audio(script, voice_preset)
```

### 503 handling in CChannel — different from EldQuest

CChannel cannot go silent. A 503 means the GPU is busy with a game. The station
needs a graceful fallback strategy, not a hard failure.

```python
# In backend/broadcaster.py, generation queue:

async def generate_next_segment_safe(segment_type: str, engine: str) -> bool:
    """
    Attempt segment generation. On GatewayUnavailableError:
    - Mark segment slot as 'pending_gpu'
    - Play station IDs on loop until GPU returns
    - Retry generation with exponential backoff
    Returns True if segment generated, False if deferred.
    """
    try:
        await generate_segment(segment_type, engine)
        return True

    except GatewayUnavailableError as e:
        logger.warning(f"broadcaster: GPU unavailable, deferring segment: {e}")
        set_broadcast_status("gpu_paused")
        asyncio.create_task(retry_when_available(segment_type, engine))
        return False


async def retry_when_available(segment_type: str, engine: str):
    """Poll Compgate health until GPU returns, then generate."""
    backoff = 15  # seconds
    while True:
        await asyncio.sleep(backoff)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{GATEWAY_URL}/health",
                    headers={"X-API-Key": GATEWAY_KEY}
                )
                data = resp.json()
                if data.get("status") == "ok":
                    logger.info("broadcaster: GPU back, resuming generation")
                    await generate_segment(segment_type, engine)
                    set_broadcast_status("active")
                    return
        except Exception:
            pass
        backoff = min(backoff * 1.5, 120)   # cap at 2 minutes


# In broadcaster, always keep fallback station IDs pre-generated
# (these are short TTS-only segments with no LLM call — generate on startup,
# refresh weekly, never expire)

STATION_ID_FALLBACKS = []   # pre-generated at startup

async def get_emergency_segment() -> dict:
    """Return a pre-generated station ID to play while GPU is unavailable."""
    if STATION_ID_FALLBACKS:
        import random
        return random.choice(STATION_ID_FALLBACKS)
    # absolute last resort — return None, frontend shows "stand by" state
    return None
```

**Frontend:** when `GET /api/status` returns `{"gpu_paused": true}`, the player UI
shows the VU meters as flat lines and a "Stand by — C Channel will return shortly" message
instead of "tuning in...". This is intentional — it adds to the atmosphere rather than
looking like a broken app.

---

## Pre-generated station ID fallbacks

Generate a set of 5-10 station IDs at startup using a single LLM call (before
entering the main loop). These are stored in memory and on disk. They don't require
the LLM to regenerate — they just need Kokoro for TTS, which is also offline during
games.

The real fallback is audio files on disk:

```python
FALLBACK_AUDIO_DIR = os.path.join(os.getenv("AUDIO_PATH", "/audio"), "fallbacks")

# On CChannel startup:
# 1. Check if FALLBACK_AUDIO_DIR has any .mp3 files
# 2. If yes, load them into STATION_ID_FALLBACKS
# 3. If no, generate 5 station IDs immediately (LLM + TTS)
#    and save them to FALLBACK_AUDIO_DIR
# 4. These files persist across container restarts
```

When both LLM and TTS are offline (GPU paused), these pre-generated MP3s play on loop.
The station never goes fully silent.

---

## Compgate routing config additions

Add these routes to `config.yaml` on the Compgate side:

```yaml
routing:
  eldquest:
    service: ollama
    model: "gpt-oss:20b"

  cchannel:
    service: ollama
    model: "gpt-oss:20b"

  # tts and bark routes already defined in main spec
  # they match the /tts/ and /bark/ path prefixes in gateway.py
```

---

## Migration testing checklist

### Compgate (do first)

- [ ] Compgate running on home PC, accessible via Tailscale
- [ ] `GET http://home-ai:9090/health` returns `{"status": "ok"}`
- [ ] Direct Ollama test: `POST /api/chat` with X-API-Key → response from gpt-oss:20b
- [ ] Direct TTS test: `POST /tts/v1/audio/speech` → Kokoro audio returned
- [ ] Direct Bark test: `POST /bark/generate` → Bark audio returned
- [ ] Launch CS2 → Compgate returns 503 on all generation endpoints
- [ ] Close CS2 → Compgate returns 200 again
- [ ] Manual pause via control panel → 503 returned
- [ ] Manual resume → 200 returned

### EldQuest

- [ ] `.env` updated, container rebuilt
- [ ] Basic action (examine something) → prose generated via Compgate
- [ ] Logic call (validation) → returns correct JSON
- [ ] Admin panel pipeline_debug shows gpt-oss:20b as model
- [ ] Launch a game → EldQuest action returns "The world grows quiet" denial
- [ ] Close game → EldQuest actions work again
- [ ] No direct Ollama calls remain in codebase (`grep -r "OLLAMA_HOST"` returns nothing)

### CChannel

- [ ] `.env` updated, container rebuilt
- [ ] Script generation → segment generated with gpt-oss:20b
- [ ] TTS via Compgate → Kokoro audio served to frontend
- [ ] Bark segment via Compgate → Bark audio served to frontend
- [ ] Launch a game → CChannel plays fallback station IDs, shows "stand by"
- [ ] Close game → CChannel resumes normal generation within 15-30 seconds
- [ ] Fallback audio files exist in `/audio/fallbacks/`
- [ ] No direct OLLAMA_HOST, KOKORO_HOST, or BARK_HOST references remain

---

## Deployment order

1. Deploy Compgate on home PC, verify it's reachable via Tailscale
2. Generate fallback station ID audio files (before migrating CChannel)
3. Migrate EldQuest first (simpler — LLM only, no TTS)
4. Verify EldQuest fully working through Compgate
5. Migrate CChannel (LLM + Kokoro + Bark)
6. Verify CChannel fully working including fallback behavior
7. Disable all direct Tailscale exposure of Ollama, Kokoro, Bark ports
