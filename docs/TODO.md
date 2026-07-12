# TODO

## Highest-value next work

### 1. Add an AI Backends page

3C should show both AI tiers clearly:

```text
Oracle Ollama
- reachable?
- models available?
- qwen2.5:1.5b present?
- apps using it: vibeslopwiki, chatrequest

CompGate
- reachable from Oracle host?
- reachable from gpu-network?
- home Ollama reachable?
- Kokoro reachable?
- Bark reachable?
- GPU paused / available?
- apps using it: genquest, cchannel
```

Suggested backend endpoint:

```text
GET /api/ai/status
```

Suggested frontend route:

```text
/ai
```

### 2. Add real health checks

Current status mostly means "container process exists." Add health/readiness checks for:

- panel;
- each app HTTP root or `/health` endpoint;
- Oracle Ollama `/api/tags`;
- CompGate `/health`;
- Kokoro and Bark through CompGate.

### 3. Standardize secrets

Move all apps toward:

```yaml
env_file: .env
```

Avoid inline secrets and insecure fallback defaults.

Known inconsistent cases:

- `vibeslopwiki` inlines `ADMIN_TOKEN=${ADMIN_TOKEN}`;
- `woketown` has a fallback `SECRET_KEY` default that should not be active in production.

### 4. Update old direct-GPU assumptions

Some code/comments/docs may still imply apps should call home Ollama/Kokoro/Bark directly at `tailscale:11434`, `tailscale:8880`, or `tailscale:8881`.

Current desired direction:

```text
EldQuest and CChannel → http://tailscale:9090 → CompGate
```

Direct forwards can remain for legacy/debug, but new app code should use CompGate.

### 5. Redesign Woketown architecture

`woketown` diverges from the standard app template:

- builds from `./backend` instead of root Dockerfile;
- bind-mounts `./data` and `./frontend`;
- uses a different persistence pattern.

Not urgent, but it should either be standardized or documented as intentionally different.

### 6. Migrate selected old C3 apps

See [`legacy-c3-audit.md`](legacy-c3-audit.md).

Candidates mentioned as worth considering:

- `76e-radio`;
- `cxtwitter`;
- static sites.

Migrate one simple app first to validate the process.

## Architecture questions

### Should app management and third-party integrations remain one panel?

The panel currently contains two categories:

1. local app/container orchestration;
2. external API integrations: Cloudflare, Porkbun, Migadu.

They can remain unified if the UI clearly separates sections. Avoid mixing app actions with external domain/email actions in one muddled screen.

### Should direct GPU forwards stay?

Root Compose currently forwards home Ollama/Kokoro/Bark directly in addition to CompGate.

Reasons to keep them:

- debugging;
- emergency bypass;
- host-level experiments.

Reasons to remove eventually:

- one gateway is easier to secure and reason about;
- apps should not care where home AI services live;
- direct service URLs create configuration drift.

Current compromise: keep direct forwards, but document CompGate as the app integration path.
