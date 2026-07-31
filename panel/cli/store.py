import hashlib
import json
import sqlite3
import time
import uuid
from pathlib import Path


class Store:
    """Persistent plans, idempotency records, and safe operational audit data."""
    def __init__(self, path: str = "/data/3cli.db"):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript("""
        CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, actor TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, action TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (at REAL NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, targets TEXT NOT NULL, outcome TEXT NOT NULL);
        """)

    def create_plan(self, actor: str, payload: dict, ttl_seconds: int) -> dict:
        now = time.time()
        plan = {**payload, "plan_id": f"3cli-plan-{uuid.uuid4()}", "created_at": int(now), "expires_at": int(now + ttl_seconds)}
        self.conn.execute("INSERT INTO plans VALUES (?, ?, ?, ?, ?)", (plan["plan_id"], actor, now, now + ttl_seconds, json.dumps(plan, sort_keys=True)))
        self.conn.commit()
        return plan

    def plan(self, plan_id: str, actor: str) -> dict:
        row = self.conn.execute("SELECT * FROM plans WHERE id=? AND actor=?", (plan_id, actor)).fetchone()
        if not row:
            raise ValueError("plan was not found for this actor")
        if row["expires"] < time.time():
            raise ValueError("plan has expired; create a fresh plan")
        return json.loads(row["payload"])

    def replay(self, key: str, action: str, payload: dict) -> dict | None:
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        row = self.conn.execute("SELECT * FROM idempotency WHERE key=?", (key,)).fetchone()
        if not row:
            return None
        if row["action"] != action or row["fingerprint"] != fingerprint:
            raise ValueError("idempotency key was already used for a different request")
        return json.loads(row["result"])

    def save_replay(self, key: str, action: str, payload: dict, result: dict) -> None:
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        self.conn.execute("INSERT INTO idempotency VALUES (?, ?, ?, ?)", (key, action, fingerprint, json.dumps(result, sort_keys=True)))
        self.conn.commit()

    def audit(self, actor: str, action: str, targets: list[str], outcome: str) -> None:
        self.conn.execute("INSERT INTO audit VALUES (?, ?, ?, ?, ?)", (time.time(), actor, action, json.dumps(targets), outcome))
        self.conn.commit()
