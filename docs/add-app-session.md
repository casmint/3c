# Add-App Session Prompt

Use this when starting an agent session for a 3C app.

```text
Read /home/ubuntu/3c/docs/ before starting.

Important current facts:
- 3C runs on the Oracle PAYG server at /home/ubuntu/3c.
- Apps live under /home/ubuntu/3c/apps/{appname}/.
- There is no apps.json. Do not create or edit apps.json.
- Apps are auto-detected when they have their own docker-compose.yml/compose.yml.
- Public traffic is Cloudflare Tunnel -> Traefik -> app container.
- Apps must join 3c-network for Traefik routing.
- Apps that use home GPU/CompGate must also join gpu-network.

Working on: {project name} at apps/{project dir}
Domain: {domain}
Stack: FastAPI + SQLite + vanilla frontend
AI backend: choose one:
  - Oracle Ollama CPU-only: OLLAMA_HOST=http://oracle-ollama:11434, MODEL_NAME=qwen2.5:1.5b
  - CompGate/home GPU: AI_GATEWAY=http://tailscale:9090, MODEL_NAME=gpt-oss:20b
Admin token/auth: {Cloudflare Access / app auth / none}

Current state:
{short current state}

Goal for this session:
{specific goal}

Constraints:
- Keep changes minimal and reviewable.
- Do not introduce Node/build tooling unless explicitly asked.
- Do not hardcode secrets.
- Do not reintroduce apps.json.
- Prefer env_file: .env for app secrets.
- If using CompGate, handle HTTP 503 as GPU unavailable/paused and degrade gracefully.
```
