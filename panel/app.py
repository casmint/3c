"""FastAPI application — REST API, static file serving, SPA catch-all."""

from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from panel.api.cloudflare import CloudflareAPI
from panel.api.porkbun import PorkbunAPI
from panel.config import AppConfig

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def create_app(config: AppConfig) -> FastAPI:
    app = FastAPI(title="3C Panel", docs_url=None, redoc_url=None)

    cf = CloudflareAPI(config.cloudflare.api_token, config.cloudflare.account_id)
    pb = (
        PorkbunAPI(config.porkbun.api_key, config.porkbun.secret_api_key)
        if config.porkbun
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
        return {"cloudflare": True, "porkbun": pb is not None}

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

    @app.get("/api/porkbun/available")
    async def api_porkbun_available():
        return {"available": pb is not None}

    @app.post("/api/porkbun/ns/{domain}")
    async def api_update_nameservers(domain: str, request: Request):
        if not pb:
            return JSONResponse(
                status_code=400,
                content={"error": "Porkbun is not configured"},
            )
        try:
            body = await request.json()
            return await pb.update_nameservers(domain, body["nameservers"])
        except httpx.HTTPStatusError as e:
            return JSONResponse(
                status_code=e.response.status_code,
                content={"error": "Porkbun API error", "detail": e.response.text},
            )
        except Exception as e:
            return JSONResponse(
                status_code=500,
                content={"error": str(e)},
            )

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

    @app.get("/")
    async def root():
        return FileResponse(str(STATIC_DIR / "index.html"))

    @app.get("/{full_path:path}")
    async def spa_catch_all(full_path: str):
        return FileResponse(str(STATIC_DIR / "index.html"))

    return app
