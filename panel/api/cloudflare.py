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
        self, zone_id: str, records: list[dict],
        replace_conflicting: bool = False,
    ) -> dict:
        """Create multiple DNS records, optionally replacing conflicts.

        Each record dict should contain at minimum:
            type, name, content
        Optional: ttl, proxied, priority

        When replace_conflicting=True, if a record fails due to a conflict
        (e.g. existing TXT/CNAME at same name), the conflicting record is
        found and updated in-place rather than failing.

        Returns: {"created": [...], "skipped": [...], "failed": [...]}
        """
        created = []
        skipped = []
        failed = []

        for record in records:
            try:
                result = await self.create_dns_record(zone_id, record)
                created.append(result.get("result", result))
            except httpx.HTTPStatusError as e:
                error_msg = str(e)
                error_code = 0
                try:
                    body = e.response.json()
                    cf_errors = body.get("errors", [])
                    if cf_errors:
                        error_msg = cf_errors[0].get("message", error_msg)
                        error_code = cf_errors[0].get("code", 0)
                except Exception:
                    pass

                # 81058 = identical record already exists — skip
                if error_code == 81058:
                    skipped.append({"record": record, "message": "Already exists"})
                # 81053 = conflicting record at same name — try to replace
                elif error_code == 81053 and replace_conflicting:
                    replaced = await self._replace_conflicting(
                        zone_id, record
                    )
                    if replaced:
                        created.append(replaced)
                    else:
                        failed.append({"record": record, "error": error_msg})
                else:
                    failed.append({"record": record, "error": error_msg})
            except Exception as e:
                failed.append({"record": record, "error": str(e)})

        return {"created": created, "skipped": skipped, "failed": failed}

    async def _replace_conflicting(
        self, zone_id: str, record: dict
    ) -> dict | None:
        """Find and replace a conflicting DNS record.

        Looks up existing records matching type+name, then updates the first
        match. For TXT records where there may be multiple (SPF, verification,
        DMARC), matches on content prefix to find the right one to replace.
        """
        import logging
        log = logging.getLogger("cloudflare")

        rec_type = record.get("type", "").upper()
        rec_name = record.get("name", "").rstrip(".")
        rec_content = record.get("content", "")

        def _names_match(cf_name: str, our_name: str) -> bool:
            """Compare DNS names: CF returns FQDNs, we may send short names.

            e.g. cf_name='key1._domainkey.3c.lol' matches our_name='key1._domainkey'
            """
            cf = cf_name.rstrip(".")
            ours = our_name.rstrip(".")
            return cf == ours or cf.startswith(ours + ".")

        try:
            # First try same record type
            existing = await self.list_dns_records(zone_id, record_type=rec_type)
            candidates = [
                r for r in existing.get("result", [])
                if _names_match(r.get("name", ""), rec_name)
            ]

            if not candidates:
                # For TXT/MX, a CNAME at the same name blocks creation
                if rec_type in ("TXT", "MX"):
                    cname_data = await self.list_dns_records(
                        zone_id, record_type="CNAME"
                    )
                    candidates = [
                        r for r in cname_data.get("result", [])
                        if _names_match(r.get("name", ""), rec_name)
                    ]
                # For CNAME, an A/AAAA at the same name blocks creation
                elif rec_type == "CNAME":
                    for check_type in ("A", "AAAA"):
                        data = await self.list_dns_records(
                            zone_id, record_type=check_type
                        )
                        candidates.extend(
                            r for r in data.get("result", [])
                            if _names_match(r.get("name", ""), rec_name)
                        )

            if not candidates:
                log.warning(
                    "No conflicting record found for %s %s", rec_type, rec_name
                )
                return None

            log.info(
                "Found %d conflicting record(s) for %s %s, replacing",
                len(candidates), rec_type, rec_name,
            )

            # For TXT records, try to match by content prefix to replace
            # the right record (e.g. replace old SPF, not verification TXT)
            target = candidates[0]
            if rec_type == "TXT" and len(candidates) > 1:
                prefix = rec_content.split()[0] if rec_content else ""
                for c in candidates:
                    existing_prefix = (c.get("content", "").split() or [""])[0]
                    if prefix and existing_prefix == prefix:
                        target = c
                        break

            # If conflicting record is a different type (e.g. A blocking CNAME),
            # delete it first then create the new one
            if target.get("type", "").upper() != rec_type:
                log.info(
                    "Deleting conflicting %s record %s to make way for %s",
                    target.get("type"), target.get("name"), rec_type,
                )
                await self.delete_dns_record(zone_id, target["id"])
                result = await self.create_dns_record(zone_id, record)
                return result.get("result", result)

            result = await self.update_dns_record(zone_id, target["id"], record)
            return result.get("result", result)
        except Exception as exc:
            log.error("_replace_conflicting failed: %s", exc)
            return None

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
