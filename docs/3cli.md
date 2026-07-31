# 3cli

`3cli` is the 3C panel's trusted local Codex operator interface. It is not an app, MCP server, HTTP service, public hostname, or ChatGPT integration. It runs only inside the existing `3c-panel` container and directly uses the panel's configured Cloudflare and Porkbun clients.

```text
Codex on the trusted 3C host
  -> docker exec 3c-panel 3cli
  -> panel-owned config and typed provider clients
  -> Cloudflare / Porkbun
```

Anyone with arbitrary command access to `3c-panel` is already a trusted 3C administrator. `3cli` creates no additional network entry point and never prints provider credentials or configuration values. Plans, idempotency records, and audit data are persisted at `/data/3cli.db` in the panel container (the root stack's `./data` bind mount).

## Commands

All commands require an accountable actor and return structured JSON on stdout.

```bash
docker exec 3c-panel 3cli --actor codex domains list --limit 5
docker exec 3c-panel 3cli --actor codex domains status example.com
docker exec 3c-panel 3cli --actor codex sites list
docker exec 3c-panel 3cli --actor codex migrations plan example.com example.net
docker exec 3c-panel 3cli --actor codex migrations create-zones --plan-id 3cli-plan-... --idempotency-key stable-key
docker exec 3c-panel 3cli --actor codex migrations apply-nameservers --plan-id 3cli-plan-... --domains example.com --expected-nameservers-json '{"example.com":["ada.ns.cloudflare.com","bob.ns.cloudflare.com"]}' --idempotency-key stable-key --confirm
docker exec 3c-panel 3cli --actor codex migrations status --plan-id 3cli-plan-...
```

Until the panel image is rebuilt with the `3cli` console entry point, use the equivalent fallback:

```bash
docker exec 3c-panel python -m panel.cli --actor codex domains list --limit 5
```

## Migration safeguards and pilot

The default batch limit is five domains and plan TTL is 15 minutes. A plan is bound to its creating actor. Writes require a stable idempotency key; nameserver changes also require `--confirm`, explicit selected domains, and an exact two-nameserver pair. Immediately before Porkbun is changed, 3cli rechecks the approved plan and Cloudflare's current assigned pair.

For a one-domain pilot: create and review the plan; create its zone; inspect the returned/active Cloudflare nameservers; apply precisely that pair with `--confirm`; then poll migration status until Cloudflare is active. If delegation must be rolled back, restore the previous pair recorded by the plan/audit trail from Porkbun's dashboard.

The tool deliberately has no generic provider/API call, arbitrary HTTP request, command execution, raw DNS mutation, or deletion operation. Site association reporting currently includes Pages and deployed panel apps; Workers, Tunnel routes, and Access associations are reported as empty until a safe, typed panel client is added.
