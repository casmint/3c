"""Porkbun API client — nameserver update for zone provisioning."""

import httpx


class PorkbunAPI:
    BASE_URL = "https://api.porkbun.com/api/json/v3"

    def __init__(self, api_key: str, secret_api_key: str):
        self.api_key = api_key
        self.secret_api_key = secret_api_key
        self.client = httpx.AsyncClient(timeout=30.0)

    async def update_nameservers(
        self, domain: str, nameservers: list[str]
    ) -> dict:
        """Update nameservers for a domain on Porkbun."""
        resp = await self.client.post(
            f"{self.BASE_URL}/domain/updateNs/{domain}",
            json={
                "apikey": self.api_key,
                "secretapikey": self.secret_api_key,
                "ns": nameservers,
            },
        )
        resp.raise_for_status()
        return resp.json()
