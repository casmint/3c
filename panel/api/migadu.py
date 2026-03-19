"""Migadu API client — domain, mailbox, alias, identity management."""

import logging

import httpx

logger = logging.getLogger(__name__)


class MigaduAPI:
    BASE_URL = "https://api.migadu.com/v1"

    def __init__(self, email: str, api_key: str):
        self.client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            auth=httpx.BasicAuth(email, api_key),
            headers={"Content-Type": "application/json"},
            timeout=30.0,
        )

    # ------------------------------------------------------------------
    # Domains
    # ------------------------------------------------------------------

    async def list_domains(self) -> list:
        resp = await self.client.get("/domains")
        resp.raise_for_status()
        return resp.json()

    async def get_domain(self, domain: str) -> dict:
        resp = await self.client.get(f"/domains/{domain}")
        resp.raise_for_status()
        return resp.json()

    async def create_domain(self, domain: str) -> dict:
        resp = await self.client.post("/domains", json={"name": domain})
        resp.raise_for_status()
        return resp.json()

    async def get_dns_records(self, domain: str) -> dict:
        resp = await self.client.get(f"/domains/{domain}/dns")
        resp.raise_for_status()
        return resp.json()

    async def run_diagnostics(self, domain: str) -> dict:
        resp = await self.client.get(f"/domains/{domain}/diagnostics")
        resp.raise_for_status()
        return resp.json()

    async def activate_domain(self, domain: str) -> dict:
        resp = await self.client.post(f"/domains/{domain}/activate")
        resp.raise_for_status()
        return resp.json()

    async def update_domain(self, domain: str, data: dict) -> dict:
        resp = await self.client.patch(f"/domains/{domain}", json=data)
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Mailboxes
    # ------------------------------------------------------------------

    async def list_mailboxes(self, domain: str) -> list:
        resp = await self.client.get(f"/domains/{domain}/mailboxes")
        resp.raise_for_status()
        return resp.json()

    async def create_mailbox(self, domain: str, data: dict) -> dict:
        resp = await self.client.post(
            f"/domains/{domain}/mailboxes", json=data
        )
        resp.raise_for_status()
        return resp.json()

    async def update_mailbox(
        self, domain: str, local_part: str, data: dict
    ) -> dict:
        resp = await self.client.put(
            f"/domains/{domain}/mailboxes/{local_part}", json=data
        )
        resp.raise_for_status()
        return resp.json()

    async def delete_mailbox(self, domain: str, local_part: str) -> dict:
        resp = await self.client.delete(
            f"/domains/{domain}/mailboxes/{local_part}"
        )
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Aliases
    # ------------------------------------------------------------------

    async def list_aliases(self, domain: str) -> list:
        resp = await self.client.get(f"/domains/{domain}/aliases")
        resp.raise_for_status()
        return resp.json()

    async def create_alias(self, domain: str, data: dict) -> dict:
        resp = await self.client.post(
            f"/domains/{domain}/aliases", json=data
        )
        resp.raise_for_status()
        return resp.json()

    async def delete_alias(self, domain: str, local_part: str) -> dict:
        resp = await self.client.delete(
            f"/domains/{domain}/aliases/{local_part}"
        )
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Identities
    # ------------------------------------------------------------------

    async def list_identities(self, domain: str, mailbox: str) -> list:
        resp = await self.client.get(
            f"/domains/{domain}/mailboxes/{mailbox}/identities"
        )
        resp.raise_for_status()
        return resp.json()

    async def create_identity(
        self, domain: str, mailbox: str, data: dict
    ) -> dict:
        resp = await self.client.post(
            f"/domains/{domain}/mailboxes/{mailbox}/identities", json=data
        )
        resp.raise_for_status()
        return resp.json()

    async def delete_identity(
        self, domain: str, mailbox: str, id_local: str
    ) -> dict:
        resp = await self.client.delete(
            f"/domains/{domain}/mailboxes/{mailbox}/identities/{id_local}"
        )
        resp.raise_for_status()
        return resp.json()
