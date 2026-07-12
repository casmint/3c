# AI Backends

3C intentionally uses two AI stacks instead of forcing every app through one route.

## Tier 1: Oracle-local Ollama

Oracle-local Ollama runs on the Oracle server as the root Compose service `oracle-ollama`.

| Property | Value |
|---|---|
| Container | `oracle-ollama` |
| Network | `3c-network` |
| Internal URL | `http://oracle-ollama:11434` |
| Current model | `qwen2.5:1.5b` |
| Hardware | Oracle ARM CPU only |
| Root compose limit | 4 GB memory |
| Parallelism | `OLLAMA_NUM_PARALLEL=4` |

This tier is for cheap, always-on, low-stakes generation. It should keep working even if the home PC is asleep, gaming, offline, or disconnected from Tailscale.

Current users:

| App | Domain | Endpoint | Model |
|---|---|---|---|
| vibeslopwiki | `vibeslop.wiki` | `http://oracle-ollama:11434/api/generate` | `qwen2.5:1.5b` |
| chatrequest | `chatre.quest` | `http://oracle-ollama:11434/api/chat` | `qwen2.5:1.5b` |

### Oracle Ollama environment pattern

```env
OLLAMA_HOST=http://oracle-ollama:11434
MODEL_NAME=qwen2.5:1.5b
```

Use only `3c-network`; `gpu-network` is not needed.

```yaml
networks:
  - 3c-network
```

### Oracle Ollama health checks

From an app container on `3c-network`:

```bash
curl -s http://oracle-ollama:11434/api/tags
```

Generation test:

```bash
curl -s http://oracle-ollama:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen2.5:1.5b",
    "prompt": "Reply with exactly: oracle ollama ok",
    "stream": false
  }'
```

## Tier 2: Home GPU through CompGate

CompGate runs on the home PC, not on the Oracle server. 3C reaches it through Tailscale and the `gpu-proxy-compgate` socat forward.

| Property | Value |
|---|---|
| Home service | CompGate on home PC |
| Oracle-side app URL | `http://tailscale:9090` |
| Oracle bridge | `gpu-proxy-compgate` sharing `tailscale` network namespace |
| Home LLM backend | home Ollama |
| Current main model | `gpt-oss:20b` |
| Home TTS backends | Kokoro and Bark |
| Auth | `X-API-Key: $AI_GATEWAY_KEY` |
| Task routing/logging | `X-Task`, e.g. `eldquest` or `cchannel` |

This tier is for higher-quality text and TTS. It depends on the home PC being online, Tailscale being connected, and CompGate permitting the request.

Current users:

| App | Domain | Services used |
|---|---|---|
| genquest / EldQuest | `eld.quest` | CompGate → home Ollama → `gpt-oss:20b` |
| CChannel | `cchannel.org` | CompGate → home Ollama + Kokoro + Bark |

### CompGate environment pattern

```env
AI_GATEWAY=http://tailscale:9090
AI_GATEWAY_KEY=...
MODEL_NAME=gpt-oss:20b
```

or for EldQuest/GenQuest split models:

```env
AI_GATEWAY=http://tailscale:9090
AI_GATEWAY_KEY=...
MODEL_PROSE=gpt-oss:20b
MODEL_LOGIC=gpt-oss:20b
```

Apps using CompGate must join both networks:

```yaml
networks:
  - 3c-network
  - gpu-network
```

## Which tier should a new app use?

Use Oracle Ollama when the app needs:

- cheap always-on text generation;
- small outputs;
- simple chat or slop generation;
- independence from the home PC.

Use CompGate when the app needs:

- stronger generation quality;
- `gpt-oss:20b`;
- TTS through Kokoro or Bark;
- home GPU acceleration;
- game-aware 503 handling.

Do not migrate lightweight apps to CompGate just for cleanliness. The split is intentional.

## Desired future panel view

3C should eventually expose an **AI Backends** panel showing:

```text
Oracle Ollama
- reachable?
- models available?
- qwen2.5:1.5b loaded?
- apps using it

CompGate
- reachable?
- home Ollama reachable?
- Kokoro reachable?
- Bark reachable?
- current model
- GPU paused / available
- apps using it
```
