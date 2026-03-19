"""Porkbun API client — domain listing, nameservers, pricing."""

import logging

import httpx

logger = logging.getLogger(__name__)


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

    async def get_nameservers(self, domain: str) -> dict:
        """Get current nameservers for a domain.

        Returns {"ns": [...], "error": None} on success,
        or {"ns": [], "error": "message"} on failure.
        """
        try:
            resp = await self.client.post(
                f"{self.BASE_URL}/domain/getNs/{domain}",
                json=self._auth(),
            )
            data = resp.json()
            if resp.status_code != 200 or data.get("status") == "ERROR":
                msg = data.get("message", f"HTTP {resp.status_code}")
                logger.warning("getNs failed for %s: %s", domain, msg)
                return {"ns": [], "error": msg}
            return {"ns": data.get("ns", []), "error": None}
        except Exception as e:
            logger.error("getNs exception for %s: %s", domain, e)
            return {"ns": [], "error": str(e)}

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
