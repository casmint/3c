"""Cloudflare API client — wraps all REST and GraphQL calls."""

import asyncio
from datetime import datetime, timedelta, timezone

import httpx


class CloudflareAPI:
    def __init__(self, api_token: str, account_id: str):
        self.account_id = account_id
        self.client = httpx.AsyncClient(
            base_url="https://api.cloudflare.com/client/v4",
            headers={
                "Authorization": f"Bearer {api_token}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    # ------------------------------------------------------------------
    # Zones
    # ------------------------------------------------------------------

    async def list_zones(
        self,
        status: str | None = None,
        name: str | None = None,
        page: int = 1,
        per_page: int = 50,
    ) -> dict:
        params: dict = {"page": page, "per_page": per_page}
        if status:
            params["status"] = status
        if name:
            params["name"] = name
        resp = await self.client.get("/zones", params=params)
        resp.raise_for_status()
        return resp.json()

    async def create_zone(self, name: str) -> dict:
        resp = await self.client.post(
            "/zones",
            json={
                "name": name,
                "account": {"id": self.account_id},
                "type": "full",
            },
        )
        resp.raise_for_status()
        return resp.json()

    async def resolve_zone(self, domain: str) -> dict | None:
        """Resolve a domain name to its zone object (or None)."""
        data = await self.list_zones(name=domain)
        results = data.get("result", [])
        return results[0] if results else None

    # ------------------------------------------------------------------
    # DNS Records
    # ------------------------------------------------------------------

    async def list_dns_records(
        self, zone_id: str, record_type: str | None = None
    ) -> dict:
        params: dict = {"per_page": 5000}
        if record_type:
            params["type"] = record_type
        resp = await self.client.get(
            f"/zones/{zone_id}/dns_records", params=params
        )
        resp.raise_for_status()
        return resp.json()

    async def create_dns_record(self, zone_id: str, record: dict) -> dict:
        resp = await self.client.post(
            f"/zones/{zone_id}/dns_records", json=record
        )
        resp.raise_for_status()
        return resp.json()

    async def update_dns_record(
        self, zone_id: str, record_id: str, record: dict
    ) -> dict:
        resp = await self.client.patch(
            f"/zones/{zone_id}/dns_records/{record_id}", json=record
        )
        resp.raise_for_status()
        return resp.json()

    async def delete_dns_record(self, zone_id: str, record_id: str) -> dict:
        resp = await self.client.delete(
            f"/zones/{zone_id}/dns_records/{record_id}"
        )
        resp.raise_for_status()
        return resp.json()

    async def add_dns_records(
        self, zone_id: str, records: list[dict]
    ) -> dict:
        """Create multiple DNS records in a single call.

        This is a reusable utility designed to be called by any module that
        needs to provision DNS records programmatically. The primary future
        consumer is the Migadu email module, which will call this to auto-add
        MX, SPF (TXT), DKIM (CNAME), and DMARC (TXT) records when a domain
        is configured for email hosting.

        Each record dict should contain at minimum:
            type     — record type (A, AAAA, CNAME, MX, TXT, etc.)
            name     — record name (e.g. "example.com" or "mail.example.com")
            content  — record value
        Optional fields:
            ttl      — TTL in seconds (default: 1 = automatic)
            proxied  — whether to proxy through Cloudflare (default: false)
            priority — MX priority (required for MX records)

        Returns:
            {
                "created": [<record objects that succeeded>],
                "failed":  [{"record": <input>, "error": <message>}]
            }
        """
        created = []
        skipped = []
        failed = []

        for record in records:
            try:
                result = await self.create_dns_record(zone_id, record)
                created.append(result.get("result", result))
            except httpx.HTTPStatusError as e:
                # Parse CF error to get human-readable message
                error_msg = str(e)
                is_duplicate = False
                try:
                    body = e.response.json()
                    cf_errors = body.get("errors", [])
                    if cf_errors:
                        error_msg = cf_errors[0].get("message", error_msg)
                        # 81058 = identical record, 81053 = conflicting record
                        is_duplicate = any(
                            err.get("code") in (81058, 81057)
                            for err in cf_errors
                        )
                except Exception:
                    pass
                if is_duplicate:
                    skipped.append({"record": record, "message": "Already exists"})
                else:
                    failed.append({"record": record, "error": error_msg})
            except Exception as e:
                failed.append({
                    "record": record,
                    "error": str(e),
                })

        return {"created": created, "skipped": skipped, "failed": failed}

    # ------------------------------------------------------------------
    # Analytics (GraphQL)
    # ------------------------------------------------------------------

    async def get_zone_analytics(self, zone_id: str, days: int = 7) -> dict:
        """Query Cloudflare GraphQL for httpRequests1dGroups.

        Uses the free-tier-compatible daily aggregation dataset.
        Returns raw GraphQL response data for the viewer.zones[0] node.
        """
        now = datetime.now(timezone.utc)
        since = (now - timedelta(days=days)).strftime("%Y-%m-%d")
        until = now.strftime("%Y-%m-%d")

        query = """
        query {{
          viewer {{
            zones(filter: {{zoneTag: "{zone_id}"}}) {{
              httpRequests1dGroups(
                limit: {limit}
                filter: {{date_geq: "{since}", date_lt: "{until}"}}
                orderBy: [date_ASC]
              ) {{
                dimensions {{ date }}
                sum {{
                  requests
                  bytes
                  cachedBytes
                  threats
                  pageViews
                }}
                uniq {{ uniques }}
              }}
            }}
          }}
        }}
        """.format(zone_id=zone_id, limit=days, since=since, until=until)

        resp = await self.client.post(
            "https://api.cloudflare.com/client/v4/graphql",
            json={"query": query},
        )
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Bulk Redirects
    # ------------------------------------------------------------------

    async def list_redirect_lists(self) -> dict:
        resp = await self.client.get(
            f"/accounts/{self.account_id}/rules/lists",
            params={"kind": "redirect"},
        )
        resp.raise_for_status()
        return resp.json()

    async def get_redirect_list_items(self, list_id: str) -> dict:
        resp = await self.client.get(
            f"/accounts/{self.account_id}/rules/lists/{list_id}/items"
        )
        resp.raise_for_status()
        return resp.json()

    async def create_redirect_items(
        self, list_id: str, items: list[dict]
    ) -> dict:
        resp = await self.client.post(
            f"/accounts/{self.account_id}/rules/lists/{list_id}/items",
            json=items,
        )
        resp.raise_for_status()
        data = resp.json()
        # Cloudflare returns an operation_id for async list mutations.
        # Poll until the operation completes.
        op_id = data.get("result", {}).get("operation_id")
        if op_id:
            await self._poll_bulk_operation(op_id)
        return data

    async def delete_redirect_items(
        self, list_id: str, item_ids: list[str]
    ) -> dict:
        resp = await self.client.delete(
            f"/accounts/{self.account_id}/rules/lists/{list_id}/items",
            json={"items": [{"id": iid} for iid in item_ids]},
        )
        resp.raise_for_status()
        data = resp.json()
        op_id = data.get("result", {}).get("operation_id")
        if op_id:
            await self._poll_bulk_operation(op_id)
        return data

    async def _poll_bulk_operation(
        self, operation_id: str, timeout: float = 30.0
    ) -> dict:
        """Poll a bulk list operation until complete or timeout."""
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            resp = await self.client.get(
                f"/accounts/{self.account_id}/rules/lists/bulk_operations/{operation_id}"
            )
            resp.raise_for_status()
            data = resp.json()
            status = data.get("result", {}).get("status")
            if status in ("completed", "failed"):
                return data
            await asyncio.sleep(0.5)
        return {"error": "Operation timed out"}

    # ------------------------------------------------------------------
    # Cloudflare Pages
    # ------------------------------------------------------------------

    async def list_pages_projects(self) -> dict:
        resp = await self.client.get(
            f"/accounts/{self.account_id}/pages/projects"
        )
        resp.raise_for_status()
        return resp.json()

    async def create_pages_project(
        self, name: str, production_branch: str = "main"
    ) -> dict:
        resp = await self.client.post(
            f"/accounts/{self.account_id}/pages/projects",
            json={
                "name": name,
                "production_branch": production_branch,
            },
        )
        resp.raise_for_status()
        return resp.json()

    async def trigger_pages_deployment(
        self, project_name: str, branch: str | None = None
    ) -> dict:
        data = {}
        if branch:
            data["branch"] = branch
        resp = await self.client.post(
            f"/accounts/{self.account_id}/pages/projects/{project_name}/deployments",
            json=data if data else None,
        )
        resp.raise_for_status()
        return resp.json()

    async def get_pages_deployment(
        self, project_name: str, deployment_id: str
    ) -> dict:
        resp = await self.client.get(
            f"/accounts/{self.account_id}/pages/projects/{project_name}/deployments/{deployment_id}"
        )
        resp.raise_for_status()
        return resp.json()
