"""Porkbun API client — domain listing, nameservers, pricing."""

import httpx


class PorkbunAPI:
    BASE_URL = "https://api.porkbun.com/api/json/v3"

    def __init__(self, api_key: str, secret_api_key: str):
        self.api_key = api_key
        self.secret_api_key = secret_api_key
        self.client = httpx.AsyncClient(timeout=30.0)

    def _auth(self) -> dict:
        return {"apikey": self.api_key, "secretapikey": self.secret_api_key}

    async def list_domains(self) -> list:
        """List all domains on the account."""
        resp = await self.client.post(
            f"{self.BASE_URL}/domain/listAll",
            json=self._auth(),
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("domains", [])

    async def get_nameservers(self, domain: str) -> list:
        """Get current nameservers for a domain."""
        resp = await self.client.post(
            f"{self.BASE_URL}/domain/getNs/{domain}",
            json=self._auth(),
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("ns", [])

    async def update_nameservers(
        self, domain: str, nameservers: list[str]
    ) -> dict:
        """Update nameservers for a domain on Porkbun."""
        resp = await self.client.post(
            f"{self.BASE_URL}/domain/updateNs/{domain}",
            json={**self._auth(), "ns": nameservers},
        )
        resp.raise_for_status()
        return resp.json()

    async def get_pricing(self) -> dict:
        """Get renewal pricing per TLD."""
        resp = await self.client.post(
            f"{self.BASE_URL}/pricing/get",
            json=self._auth(),
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("pricing", {})
