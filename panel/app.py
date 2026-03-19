"""FastAPI application — REST API, static file serving, SPA catch-all."""

import time
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from panel.api.cloudflare import CloudflareAPI
from panel.api.migadu import MigaduAPI
from panel.api.porkbun import PorkbunAPI
from panel.config import AppConfig

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
CACHE_BUST = str(int(time.time()))


def create_app(config: AppConfig) -> FastAPI:
    app = FastAPI(title="3C Panel", docs_url=None, redoc_url=None)

    cf = CloudflareAPI(config.cloudflare.api_token, config.cloudflare.account_id)
    pb = (
        PorkbunAPI(config.porkbun.api_key, config.porkbun.secret_api_key)
        if config.porkbun
        else None
    )
    mg = (
        MigaduAPI(config.migadu.email, config.migadu.api_key)
        if config.migadu
        else None
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _cf_error(e: Exception) -> JSONResponse:
        if isinstance(e, httpx.HTTPStatusError):
            detail = e.response.text
            try:
                body = e.response.json()
                cf_errors = body.get("errors", [])
                if cf_errors:
                    detail = "; ".join(
                        err.get("message", "")
                        for err in cf_errors
                        if err.get("message")
                    ) or detail
            except Exception:
                pass
            return JSONResponse(
                status_code=e.response.status_code,
                content={"error": detail, "detail": detail},
            )
        if isinstance(e, httpx.RequestError):
            return JSONResponse(
                status_code=502,
                content={"error": "Failed to reach Cloudflare API", "detail": str(e)},
            )
        return JSONResponse(
            status_code=500,
            content={"error": "Internal error", "detail": str(e)},
        )

    # ------------------------------------------------------------------
    # Config status
    # ------------------------------------------------------------------

    @app.get("/api/config/status")
    async def api_config_status():
        return {"cloudflare": True, "porkbun": pb is not None, "migadu": mg is not None}

    # ------------------------------------------------------------------
    # Zones
    # ------------------------------------------------------------------

    @app.get("/api/cf/zones")
    async def api_list_zones(
        status: str | None = None,
        name: str | None = None,
        page: int = 1,
        per_page: int = 50,
    ):
        try:
            return await cf.list_zones(
                status=status, name=name, page=page, per_page=per_page
            )
        except Exception as e:
            return _cf_error(e)

    @app.post("/api/cf/zones")
    async def api_create_zone(request: Request):
        try:
            body = await request.json()
            return await cf.create_zone(body["name"])
        except Exception as e:
            return _cf_error(e)

    @app.get("/api/cf/zones/resolve/{domain}")
    async def api_resolve_zone(domain: str):
        try:
            zone = await cf.resolve_zone(domain)
            if zone:
                return {"result": zone}
            return JSONResponse(status_code=404, content={"error": f"Zone not found: {domain}"})
        except Exception as e:
            return _cf_error(e)

    # ------------------------------------------------------------------
    # DNS
    # ------------------------------------------------------------------

    @app.get("/api/cf/zones/{zone_id}/dns")
    async def api_list_dns(zone_id: str, type: str | None = None):
        try:
            return await cf.list_dns_records(zone_id, record_type=type)
        except Exception as e:
            return _cf_error(e)

    @app.post("/api/cf/zones/{zone_id}/dns")
    async def api_create_dns(zone_id: str, request: Request):
        try:
            body = await request.json()
            return await cf.create_dns_record(zone_id, body)
        except Exception as e:
            return _cf_error(e)

    @app.patch("/api/cf/zones/{zone_id}/dns/{record_id}")
    async def api_update_dns(zone_id: str, record_id: str, request: Request):
        try:
            body = await request.json()
            return await cf.update_dns_record(zone_id, record_id, body)
        except Exception as e:
            return _cf_error(e)

    @app.delete("/api/cf/zones/{zone_id}/dns/{record_id}")
    async def api_delete_dns(zone_id: str, record_id: str):
        try:
            return await cf.delete_dns_record(zone_id, record_id)
        except Exception as e:
            return _cf_error(e)

    # ------------------------------------------------------------------
    # Analytics
    # ------------------------------------------------------------------

    @app.get("/api/cf/zones/{zone_id}/analytics")
    async def api_zone_analytics(zone_id: str, days: int = 7):
        try:
            return await cf.get_zone_analytics(zone_id, days=days)
        except Exception as e:
            return _cf_error(e)

    # ------------------------------------------------------------------
    # Bulk Redirects
    # ------------------------------------------------------------------

    @app.get("/api/cf/redirects/lists")
    async def api_list_redirect_lists():
        try:
            return await cf.list_redirect_lists()
        except Exception as e:
            return _cf_error(e)

    @app.get("/api/cf/redirects/lists/{list_id}/items")
    async def api_get_redirect_items(list_id: str):
        try:
            return await cf.get_redirect_list_items(list_id)
        except Exception as e:
            return _cf_error(e)

    @app.post("/api/cf/redirects/lists/{list_id}/items")
    async def api_create_redirect_items(list_id: str, request: Request):
        try:
            body = await request.json()
            return await cf.create_redirect_items(list_id, body)
        except Exception as e:
            return _cf_error(e)

    @app.delete("/api/cf/redirects/lists/{list_id}/items")
    async def api_delete_redirect_items(list_id: str, request: Request):
        try:
            body = await request.json()
            return await cf.delete_redirect_items(list_id, body["item_ids"])
        except Exception as e:
            return _cf_error(e)

    # ------------------------------------------------------------------
    # Cloudflare Pages
    # ------------------------------------------------------------------

    @app.get("/api/cf/pages/projects")
    async def api_list_pages_projects():
        try:
            return await cf.list_pages_projects()
        except Exception as e:
            return _cf_error(e)

    @app.post("/api/cf/pages/projects")
    async def api_create_pages_project(request: Request):
        try:
            body = await request.json()
            return await cf.create_pages_project(
                name=body["name"],
                production_branch=body.get("production_branch", "main"),
            )
        except Exception as e:
            return _cf_error(e)

    @app.post("/api/cf/pages/projects/{project_name}/deploy")
    async def api_trigger_deploy(project_name: str, request: Request):
        try:
            body = await request.json() if await request.body() else {}
            return await cf.trigger_pages_deployment(
                project_name, branch=body.get("branch")
            )
        except Exception as e:
            return _cf_error(e)

    @app.get(
        "/api/cf/pages/projects/{project_name}/deployments/{deployment_id}"
    )
    async def api_get_deployment(project_name: str, deployment_id: str):
        try:
            return await cf.get_pages_deployment(project_name, deployment_id)
        except Exception as e:
            return _cf_error(e)

    # ------------------------------------------------------------------
    # Porkbun
    # ------------------------------------------------------------------

    def _pb_error(e: Exception) -> JSONResponse:
        if isinstance(e, httpx.HTTPStatusError):
            detail = e.response.text
            try:
                body = e.response.json()
                if body.get("message"):
                    detail = body["message"]
            except Exception:
                pass
            return JSONResponse(
                status_code=e.response.status_code,
                content={"error": detail, "detail": detail},
            )
        if isinstance(e, httpx.RequestError):
            return JSONResponse(
                status_code=502,
                content={"error": "Failed to reach Porkbun API", "detail": str(e)},
            )
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "detail": str(e)},
        )

    def _pb_guard() -> JSONResponse | None:
        if not pb:
            return JSONResponse(
                status_code=400,
                content={"error": "Porkbun API credentials not configured"},
            )
        return None

    @app.get("/api/porkbun/available")
    async def api_porkbun_available():
        return {"available": pb is not None}

    @app.post("/api/porkbun/ns/{domain}")
    async def api_update_nameservers(domain: str, request: Request):
        guard = _pb_guard()
        if guard:
            return guard
        try:
            body = await request.json()
            return await pb.update_nameservers(domain, body["nameservers"])
        except Exception as e:
            return _pb_error(e)

    @app.get("/api/domains")
    async def api_list_domains():
        """List all Porkbun domains with NS status and CF comparison."""
        guard = _pb_guard()
        if guard:
            return guard
        try:
            import asyncio
            domains, pricing = await asyncio.gather(
                pb.list_domains(),
                pb.get_pricing(),
            )

            # Fetch all CF zones once
            try:
                cf_data = await cf.list_zones(per_page=50)
                cf_zones = {z["name"]: z for z in cf_data.get("result", [])}
            except Exception:
                cf_zones = {}

            # Fetch nameservers for each domain concurrently
            async def enrich(d):
                domain_name = d.get("domain", "")
                ns_result = await pb.get_nameservers(domain_name)
                ns = ns_result["ns"]
                ns_error = ns_result["error"]

                # Determine TLD and pricing
                tld = domain_name.split(".", 1)[1] if "." in domain_name else ""
                tld_pricing = pricing.get(tld, {})
                renewal_cost = tld_pricing.get("renewal") or tld_pricing.get("renew")

                # CF status
                cf_zone = cf_zones.get(domain_name)
                if cf_zone:
                    cf_ns = sorted(cf_zone.get("name_servers") or [])
                    current_ns = sorted(ns)
                    if current_ns == cf_ns:
                        cf_status = "cf_active"
                    else:
                        cf_status = "cf_pending"
                else:
                    cf_ns = []
                    cf_status = "not_on_cf"

                return {
                    "domain": domain_name,
                    "tld": tld,
                    "status": d.get("status", ""),
                    "expire_date": d.get("expireDate", ""),
                    "auto_renew": d.get("autoRenew", False),
                    "not_local": d.get("notLocal", 0),
                    "nameservers": ns,
                    "ns_error": ns_error,
                    "cf_status": cf_status,
                    "cf_nameservers": cf_ns,
                    "renewal_cost": renewal_cost,
                }

            results = await asyncio.gather(
                *[enrich(d) for d in domains],
                return_exceptions=True,
            )
            # Filter out any failed enrichments
            return {
                "domains": [
                    r for r in results if isinstance(r, dict)
                ]
            }
        except Exception as e:
            return _pb_error(e)

    @app.post("/api/domains/{domain}/update-ns")
    async def api_domain_update_ns(domain: str, request: Request):
        """Update nameservers for a domain on Porkbun."""
        guard = _pb_guard()
        if guard:
            return guard
        try:
            body = await request.json()
            result = await pb.update_nameservers(domain, body["nameservers"])
            return {"success": True, "result": result}
        except Exception as e:
            return _pb_error(e)

    @app.post("/api/domains/{domain}/fix-cf")
    async def api_domain_fix_cf(domain: str):
        """Set CF-assigned nameservers on Porkbun for a domain."""
        guard = _pb_guard()
        if guard:
            return guard
        try:
            zone = await cf.resolve_zone(domain)
            if not zone:
                return JSONResponse(
                    status_code=404,
                    content={"error": f"No Cloudflare zone found for {domain}"},
                )
            cf_ns = zone.get("name_servers", [])
            if not cf_ns:
                return JSONResponse(
                    status_code=400,
                    content={"error": "Cloudflare zone has no assigned nameservers"},
                )
            result = await pb.update_nameservers(domain, cf_ns)
            return {"success": True, "nameservers": cf_ns, "result": result}
        except Exception as e:
            return _pb_error(e)

    # ------------------------------------------------------------------
    # Migadu
    # ------------------------------------------------------------------

    def _mg_error(e: Exception) -> JSONResponse:
        if isinstance(e, httpx.HTTPStatusError):
            detail = e.response.text
            try:
                body = e.response.json()
                if body.get("error"):
                    detail = body["error"]
            except Exception:
                pass
            return JSONResponse(
                status_code=e.response.status_code,
                content={"error": detail, "detail": detail},
            )
        if isinstance(e, httpx.RequestError):
            return JSONResponse(
                status_code=502,
                content={"error": "Failed to reach Migadu API", "detail": str(e)},
            )
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "detail": str(e)},
        )

    def _mg_guard() -> JSONResponse | None:
        if not mg:
            return JSONResponse(
                status_code=400,
                content={"error": "Migadu API credentials not configured"},
            )
        return None

    @app.get("/api/email/available")
    async def api_migadu_available():
        return {"available": mg is not None}

    # -- Domains --

    @app.get("/api/email/domains")
    async def api_email_list_domains():
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.list_domains()
        except Exception as e:
            return _mg_error(e)

    @app.post("/api/email/domains")
    async def api_email_create_domain(request: Request):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            body = await request.json()
            return await mg.create_domain(body["name"])
        except Exception as e:
            return _mg_error(e)

    @app.get("/api/email/domains/{domain}")
    async def api_email_get_domain(domain: str):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.get_domain(domain)
        except Exception as e:
            return _mg_error(e)

    @app.patch("/api/email/domains/{domain}")
    async def api_email_update_domain(domain: str, request: Request):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            body = await request.json()
            return await mg.update_domain(domain, body)
        except Exception as e:
            return _mg_error(e)

    @app.get("/api/email/domains/{domain}/dns-records")
    async def api_email_dns_records(domain: str, wait: float = 0):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            initial_delay = min(max(wait, 0), 10)
            return await mg.get_dns_records(
                domain, initial_delay=initial_delay
            )
        except Exception as e:
            return _mg_error(e)

    @app.get("/api/email/domains/{domain}/diagnostics")
    async def api_email_diagnostics(domain: str):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.run_diagnostics(domain)
        except Exception as e:
            return _mg_error(e)

    @app.post("/api/email/domains/{domain}/activate")
    async def api_email_activate_domain(domain: str):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.activate_domain(domain)
        except Exception as e:
            return _mg_error(e)

    @app.get("/api/email/domains/{domain}/catchall")
    async def api_email_get_catchall(domain: str):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            dests = await mg.get_catchall(domain)
            return {"catchall_destinations": dests}
        except Exception as e:
            return _mg_error(e)

    @app.post("/api/email/domains/{domain}/catchall")
    async def api_email_set_catchall(domain: str, request: Request):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            body = await request.json()
            return await mg.set_catchall(domain, body.get("destinations", []))
        except Exception as e:
            return _mg_error(e)

    @app.delete("/api/email/domains/{domain}/catchall")
    async def api_email_clear_catchall(domain: str):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.set_catchall(domain, [])
        except Exception as e:
            return _mg_error(e)

    @app.post("/api/email/domains/{domain}/setup-dns")
    async def api_email_setup_dns(domain: str):
        """Auto-add Migadu DNS records to Cloudflare for a domain."""
        guard = _mg_guard()
        if guard:
            return guard
        try:
            # 1. Get required DNS records from Migadu
            dns_data = await mg.get_dns_records(domain)

            # 2. Find the CF zone for this domain
            zone = await cf.resolve_zone(domain)
            if not zone:
                return JSONResponse(
                    status_code=404,
                    content={"error": f"No Cloudflare zone found for {domain}"},
                )
            zone_id = zone["id"]

            # 3. Map Migadu records to CF format
            # Migadu returns: {spf: {}, dkim: [], mx_records: [], dmarc: {},
            #                  dns_verification: {}, domain_name: "..."}
            cf_records = []

            def _add(entry):
                if not entry:
                    return
                rec = {
                    "type": (entry.get("type") or "").upper(),
                    "name": entry.get("name") or domain,
                    "content": entry.get("value") or entry.get("content") or "",
                    "ttl": 1,
                    "proxied": False,
                }
                if entry.get("priority") is not None:
                    rec["priority"] = int(entry["priority"])
                if rec["content"]:
                    cf_records.append(rec)

            # Verification TXT
            _add(dns_data.get("dns_verification"))
            # MX records
            for mx in dns_data.get("mx_records") or []:
                _add(mx)
            # DKIM CNAMEs
            for dk in dns_data.get("dkim") or []:
                _add(dk)
            # SPF TXT
            _add(dns_data.get("spf"))
            # DMARC TXT
            _add(dns_data.get("dmarc"))

            # Fallback: legacy array format
            if not cf_records:
                for entry in dns_data.get("entries") or dns_data.get("records") or []:
                    _add(entry)

            # 4. Create all records via the batch function
            result = await cf.add_dns_records(zone_id, cf_records)
            return result
        except Exception as e:
            return _mg_error(e)

    # -- Mailboxes --

    @app.get("/api/email/mailboxes/{domain}")
    async def api_email_list_mailboxes(domain: str):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.list_mailboxes(domain)
        except Exception as e:
            return _mg_error(e)

    @app.post("/api/email/mailboxes/{domain}")
    async def api_email_create_mailbox(domain: str, request: Request):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            body = await request.json()
            return await mg.create_mailbox(domain, body)
        except Exception as e:
            return _mg_error(e)

    @app.put("/api/email/mailboxes/{domain}/{local_part}")
    async def api_email_update_mailbox(
        domain: str, local_part: str, request: Request
    ):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            body = await request.json()
            return await mg.update_mailbox(domain, local_part, body)
        except Exception as e:
            return _mg_error(e)

    @app.delete("/api/email/mailboxes/{domain}/{local_part}")
    async def api_email_delete_mailbox(domain: str, local_part: str):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.delete_mailbox(domain, local_part)
        except Exception as e:
            return _mg_error(e)

    # -- Aliases --

    @app.get("/api/email/aliases/{domain}")
    async def api_email_list_aliases(domain: str):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.list_aliases(domain)
        except Exception as e:
            return _mg_error(e)

    @app.post("/api/email/aliases/{domain}")
    async def api_email_create_alias(domain: str, request: Request):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            body = await request.json()
            return await mg.create_alias(domain, body)
        except Exception as e:
            return _mg_error(e)

    @app.delete("/api/email/aliases/{domain}/{local_part}")
    async def api_email_delete_alias(domain: str, local_part: str):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.delete_alias(domain, local_part)
        except Exception as e:
            return _mg_error(e)

    # -- Identities --

    @app.get("/api/email/identities/{domain}/{mailbox}")
    async def api_email_list_identities(domain: str, mailbox: str):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.list_identities(domain, mailbox)
        except Exception as e:
            return _mg_error(e)

    @app.post("/api/email/identities/{domain}/{mailbox}")
    async def api_email_create_identity(
        domain: str, mailbox: str, request: Request
    ):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            body = await request.json()
            return await mg.create_identity(domain, mailbox, body)
        except Exception as e:
            return _mg_error(e)

    @app.delete("/api/email/identities/{domain}/{mailbox}/{id_local}")
    async def api_email_delete_identity(
        domain: str, mailbox: str, id_local: str
    ):
        guard = _mg_guard()
        if guard:
            return guard
        try:
            return await mg.delete_identity(domain, mailbox, id_local)
        except Exception as e:
            return _mg_error(e)

    # ------------------------------------------------------------------
    # Apps — registry
    # ------------------------------------------------------------------

    from panel.api import apps as apps_mod

    @app.get("/api/apps")
    async def api_list_apps():
        """List all apps from registry with their container status."""
        app_list = apps_mod.load_apps()
        result = []
        for a in app_list:
            try:
                containers = apps_mod.get_app_containers(a["name"])
                running = any(c["running"] for c in containers)
            except Exception:
                containers = []
                running = False
            result.append({**a, "containers": containers, "running": running})
        return {"apps": result}

    @app.post("/api/apps/registry/add")
    async def api_add_app(request: Request):
        try:
            body = await request.json()
            app_entry = apps_mod.add_app(
                name=body["name"],
                app_type=body.get("type", "stack"),
                repo=body.get("repo"),
                branch=body.get("branch", "main"),
                domain=body.get("domain"),
                port=body.get("port", 8000),
                env_vars=body.get("env_vars", {}),
            )
            return {"success": True, "app": app_entry}
        except ValueError as e:
            return JSONResponse(status_code=409, content={"error": str(e)})
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})

    @app.post("/api/apps/registry/remove/{name}")
    async def api_remove_app(name: str):
        apps_mod.remove_app(name)
        return {"success": True}

    # ------------------------------------------------------------------
    # Apps — operations
    # ------------------------------------------------------------------

    @app.post("/api/apps/{name}/deploy")
    async def api_deploy_app(name: str):
        a = apps_mod.get_app(name)
        if not a:
            return JSONResponse(status_code=404, content={"error": f"App not found: {name}"})
        results = apps_mod.full_deploy(a)
        steps = [{"step": s, "success": ok, "message": msg} for s, ok, msg in results]
        success = all(s["success"] for s in steps)
        return {"success": success, "steps": steps}

    @app.post("/api/apps/{name}/pull-restart")
    async def api_pull_restart_app(name: str):
        a = apps_mod.get_app(name)
        if not a:
            return JSONResponse(status_code=404, content={"error": f"App not found: {name}"})
        results = apps_mod.pull_and_restart(a)
        steps = [{"step": s, "success": ok, "message": msg} for s, ok, msg in results]
        success = all(s["success"] for s in steps)
        return {"success": success, "steps": steps}

    @app.post("/api/apps/{name}/stop")
    async def api_stop_app(name: str):
        a = apps_mod.get_app(name)
        if not a:
            return JSONResponse(status_code=404, content={"error": f"App not found: {name}"})
        ok, msg = apps_mod.stop_app(a)
        return {"success": ok, "message": msg}

    @app.post("/api/apps/{name}/restart")
    async def api_restart_app(name: str):
        a = apps_mod.get_app(name)
        if not a:
            return JSONResponse(status_code=404, content={"error": f"App not found: {name}"})
        ok, msg = apps_mod.restart_app(a)
        return {"success": ok, "message": msg}

    @app.post("/api/apps/{name}/delete")
    async def api_delete_app(name: str):
        a = apps_mod.get_app(name)
        if not a:
            return JSONResponse(status_code=404, content={"error": f"App not found: {name}"})
        ok, msg = apps_mod.delete_app_containers(a)
        apps_mod.remove_app(name)
        return {"success": ok, "message": msg}

    @app.get("/api/apps/{name}/logs")
    async def api_app_logs(name: str, tail: int = 200):
        a = apps_mod.get_app(name)
        if not a:
            return JSONResponse(status_code=404, content={"error": f"App not found: {name}"})
        # Get logs from all containers belonging to this app
        containers = apps_mod.get_app_containers(name)
        if not containers:
            return {"logs": "No containers found for this app."}
        logs_parts = []
        for c in containers:
            log = apps_mod.get_container_logs(c["name"], tail=tail)
            if len(containers) > 1:
                logs_parts.append(f"=== {c['name']} ===\n{log}")
            else:
                logs_parts.append(log)
        return {"logs": "\n".join(logs_parts)}

    @app.get("/api/apps/{name}/git-status")
    async def api_app_git_status(name: str):
        return apps_mod.get_git_status(name)

    # ------------------------------------------------------------------
    # Raw Containers
    # ------------------------------------------------------------------

    @app.get("/api/containers")
    async def api_list_containers():
        return {"containers": apps_mod.list_all_containers()}

    @app.post("/api/containers/{name}/start")
    async def api_start_container(name: str):
        ok, msg = apps_mod.start_container(name)
        return {"success": ok, "message": msg}

    @app.post("/api/containers/{name}/stop")
    async def api_stop_container(name: str):
        ok, msg = apps_mod.stop_container(name)
        return {"success": ok, "message": msg}

    @app.post("/api/containers/{name}/restart")
    async def api_restart_container(name: str):
        ok, msg = apps_mod.restart_container(name)
        return {"success": ok, "message": msg}

    @app.get("/api/containers/{name}/logs")
    async def api_container_logs(name: str, tail: int = 200):
        logs = apps_mod.get_container_logs(name, tail=tail)
        return {"logs": logs}

    # ------------------------------------------------------------------
    # 3C Self-Update
    # ------------------------------------------------------------------

    @app.post("/api/3c/pull-restart")
    async def api_3c_pull_restart():
        pull_result = apps_mod.pull_3c()
        if not pull_result["success"]:
            return pull_result
        if pull_result.get("restart_required"):
            ok, msg = apps_mod.restart_3c()
            pull_result["restart"] = {"success": ok, "message": msg}
        return pull_result

    @app.get("/api/3c/git-status")
    async def api_3c_git_status():
        return apps_mod.get_3c_git_status()

    # ------------------------------------------------------------------
    # Static files + SPA catch-all
    # ------------------------------------------------------------------

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    _index_html = (STATIC_DIR / "index.html").read_text().replace(
        "__CACHE_BUST__", CACHE_BUST
    )

    def _serve_index():
        return HTMLResponse(_index_html)

    @app.get("/")
    async def root():
        return _serve_index()

    @app.get("/{full_path:path}")
    async def spa_catch_all(full_path: str):
        return _serve_index()

    return app
