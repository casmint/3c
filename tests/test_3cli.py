import asyncio
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

from panel.cli.services.migration import MigrationService
from panel.cli.store import Store
from panel.cli.validation import domain, nameservers, safe_error


class FakeCloudflare:
    def __init__(self): self.zones = {}
    async def list_zones(self, **_): return {"result": list(self.zones.values())}
    async def resolve_zone(self, name): return self.zones.get(name)
    async def create_zone(self, name):
        zone = {"id": name, "name": name, "status": "pending", "name_servers": ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]}; self.zones[name] = zone
        return {"result": zone}
    async def list_pages_projects(self): return {"result": []}


class FakePorkbun:
    def __init__(self): self.domains = [{"domain": "example.com", "status": "ACTIVE"}]; self.updates = []
    async def list_domains(self): return self.domains
    async def get_nameservers(self, name): return {"ns": ["old.example.net", "old2.example.net"], "error": None}
    async def update_nameservers(self, name, values): self.updates.append((name, values)); return {"status": "SUCCESS"}


class ThreeCliTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory(); self.cf, self.pb = FakeCloudflare(), FakePorkbun()
        self.service = MigrationService(self.cf, self.pb, Store(f"{self.dir.name}/3cli.db"))
    def tearDown(self): self.dir.cleanup()
    def execute(self, task): return asyncio.run(task)

    def test_validation_and_redaction(self):
        self.assertEqual(domain("Example.COM."), "example.com")
        self.assertEqual(nameservers(["Ada.NS.Cloudflare.com", "bob.ns.cloudflare.com"])[0], "ada.ns.cloudflare.com")
        with self.assertRaises(ValueError): nameservers(["one.example.com"])
        self.assertEqual(safe_error(ValueError("Authorization: secret")), "provider operation failed")

    def test_actor_bound_expiration_idempotency_and_confirmation(self):
        plan = self.execute(self.service.plan("codex", ["example.com"]))
        with self.assertRaises(ValueError): self.service.store.plan(plan["plan_id"], "other")
        with self.assertRaises(ValueError): self.execute(self.service.apply_nameservers("codex", plan["plan_id"], ["example.com"], {"example.com": ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]}, False, "k" * 16))
        created = self.execute(self.service.create_zones("codex", plan["plan_id"], "a" * 16))
        self.assertEqual(created["results"][0]["status"], "created")
        self.assertEqual(self.execute(self.service.create_zones("codex", plan["plan_id"], "a" * 16)), created)
        with self.assertRaises(ValueError): self.service.store.replay("a" * 16, "create_cloudflare_zones", {"plan_id": "different"})
        self.service.store.conn.execute("UPDATE plans SET expires=0"); self.service.store.conn.commit()
        with self.assertRaises(ValueError): self.service.store.plan(plan["plan_id"], "codex")

    def test_nameserver_mismatch_and_mocked_update(self):
        plan = self.execute(self.service.plan("codex", ["example.com"]))
        self.execute(self.service.create_zones("codex", plan["plan_id"], "b" * 16))
        with self.assertRaises(ValueError): self.execute(self.service.apply_nameservers("codex", plan["plan_id"], ["example.com"], {"example.com": ["wrong.example.com", "other.example.com"]}, True, "c" * 16))
        result = self.execute(self.service.apply_nameservers("codex", plan["plan_id"], ["example.com"], {"example.com": ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]}, True, "d" * 16))
        self.assertEqual(result["results"][0]["status"], "updated")
        self.assertEqual(self.pb.updates[0][0], "example.com")


if __name__ == "__main__": unittest.main()
