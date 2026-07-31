from typing import Any

from panel.api.apps import discover_apps
from panel.cli.store import Store
from panel.cli.validation import domain, nameservers


class MigrationService:
    """Restricted direct use of the panel's existing provider clients."""
    def __init__(self, cloudflare: Any, porkbun: Any, store: Store, max_batch: int = 5, plan_ttl: int = 900):
        self.cloudflare, self.porkbun, self.store = cloudflare, porkbun, store
        self.max_batch, self.plan_ttl = max_batch, plan_ttl

    async def list_domains(self, filter_text: str | None, cursor: int, limit: int) -> dict:
        if cursor < 0 or not 1 <= limit <= 100:
            raise ValueError("cursor and limit are out of range")
        registry, zones = await self.porkbun.list_domains(), await self.cloudflare.list_zones(per_page=50)
        zone_by_name = {zone.get("name", "").lower(): zone for zone in zones.get("result", [])}
        items = [{"domain": item["domain"].lower(), "registrar_status": item.get("status", ""), "cloudflare_zone_status": zone_by_name.get(item["domain"].lower(), {}).get("status", "not_on_cloudflare")} for item in registry if item.get("domain")]
        if filter_text:
            items = [item for item in items if filter_text.lower() in item["domain"]]
        page = items[cursor:cursor + limit]
        return {"domains": page, "next_cursor": cursor + limit if cursor + limit < len(items) else None}

    async def domain_status(self, value: str) -> dict:
        name = domain(value)
        registry = {item.get("domain", "").lower(): item for item in await self.porkbun.list_domains()}
        if name not in registry:
            raise ValueError("domain is not managed by 3C")
        current, zone = await self.porkbun.get_nameservers(name), await self.cloudflare.resolve_zone(name)
        safe_zone = {key: zone.get(key) for key in ("id", "name", "status", "name_servers")} if zone else None
        deployed = [{"name": app["name"], "domain": app["domain"], "status": app["status"]} for app in discover_apps() if app.get("domain") == name]
        return {"domain": name, "registrar": "porkbun", "registrar_status": registry[name].get("status", ""), "assigned_nameservers": current.get("ns", []), "cloudflare_zone": safe_zone, "pages": [], "workers": [], "tunnel_routes": [], "access_associations": [], "deployed_apps": deployed}

    async def list_sites(self) -> dict:
        pages = await self.cloudflare.list_pages_projects()
        return {"pages": [{"name": page.get("name", ""), "domains": [item for item in page.get("domains", []) if isinstance(item, str)]} for page in pages.get("result", [])], "workers": [], "tunnel_routes": [], "apps": [{"name": app["name"], "domain": app["domain"], "status": app["status"]} for app in discover_apps()]}

    async def plan(self, actor: str, requested: list[str]) -> dict:
        requested = sorted(set(domain(item) for item in requested))
        if not requested or len(requested) > self.max_batch:
            raise ValueError(f"domains must contain between 1 and {self.max_batch} entries")
        known = {item["domain"] for item in (await self.list_domains(None, 0, 100))["domains"]}
        entries, blockers = [], []
        for name in requested:
            if name not in known:
                blockers.append({"domain": name, "reason": "domain is not a 3C-managed Porkbun domain"})
                continue
            status = await self.domain_status(name)
            zone = status["cloudflare_zone"]
            entries.append({"domain": name, "existing_zone": bool(zone), "eligible_zone_creation": not bool(zone), "expected_nameservers": (zone or {}).get("name_servers", []), "current_nameservers": status["assigned_nameservers"]})
        return self.store.create_plan(actor, {"domains": entries, "blockers": blockers, "warnings": ["Zone creation does not change registrar delegation.", "Apply nameservers only after reviewing the exact assigned pair."]}, self.plan_ttl)

    async def create_zones(self, actor: str, plan_id: str, idempotency_key: str) -> dict:
        plan = self.store.plan(plan_id, actor)
        payload = {"plan_id": plan_id}
        if replay := self.store.replay(idempotency_key, "create_cloudflare_zones", payload): return replay
        targets = [item["domain"] for item in plan["domains"]]
        try:
            if plan["blockers"]: raise ValueError("approved plan contains blockers")
            results = []
            for item in plan["domains"]:
                existing = await self.cloudflare.resolve_zone(item["domain"])
                zone = existing or (await self.cloudflare.create_zone(item["domain"])).get("result", {})
                results.append({"domain": item["domain"], "status": "already_exists" if existing else "created", "nameservers": zone.get("name_servers", [])})
            result = {"plan_id": plan_id, "results": results}
            self.store.save_replay(idempotency_key, "create_cloudflare_zones", payload, result); self.store.audit(actor, "create_cloudflare_zones", targets, "success")
            return result
        except Exception:
            self.store.audit(actor, "create_cloudflare_zones", targets, "failed")
            raise

    async def apply_nameservers(self, actor: str, plan_id: str, selected: list[str], expected: dict[str, list[str]], confirmed: bool, idempotency_key: str) -> dict:
        if not confirmed: raise ValueError("--confirm is required before nameserver changes")
        plan = self.store.plan(plan_id, actor)
        selected = sorted(set(domain(item) for item in selected))
        allowed = {item["domain"] for item in plan["domains"]}
        if not selected or not set(selected) <= allowed: raise ValueError("selected domains do not exactly belong to this plan")
        normalized = {domain(name): nameservers(pair) for name, pair in expected.items()}
        if set(normalized) != set(selected): raise ValueError("an expected nameserver pair is required for every selected domain")
        payload = {"plan_id": plan_id, "domains": selected, "expected": normalized}
        if replay := self.store.replay(idempotency_key, "apply_porkbun_nameservers", payload): return replay
        try:
            results = []
            for name in selected:
                zone = await self.cloudflare.resolve_zone(name)
                if not zone or sorted(zone.get("name_servers", [])) != sorted(normalized[name]):
                    raise ValueError(f"Cloudflare nameservers changed or zone is absent for {name}; create a new plan")
                await self.porkbun.update_nameservers(name, normalized[name])
                results.append({"domain": name, "status": "updated", "nameservers": normalized[name]})
            result = {"plan_id": plan_id, "results": results}
            self.store.save_replay(idempotency_key, "apply_porkbun_nameservers", payload, result); self.store.audit(actor, "apply_porkbun_nameservers", selected, "success")
            return result
        except Exception:
            self.store.audit(actor, "apply_porkbun_nameservers", selected, "failed")
            raise

    async def migration_status(self, actor: str, plan_id: str | None, requested: list[str] | None) -> dict:
        if plan_id:
            requested = [item["domain"] for item in self.store.plan(plan_id, actor)["domains"]]
        if not requested: raise ValueError("provide --plan-id or --domains")
        return {"domains": [await self.domain_status(item) for item in requested]}
