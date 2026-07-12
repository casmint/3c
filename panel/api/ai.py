"""Read-only health checks for 3C's two AI backends."""

import os

import httpx


ORACLE_OLLAMA_URL = os.environ.get("ORACLE_OLLAMA_URL", "http://oracle-ollama:11434")
COMPGATE_URL = os.environ.get("COMPGATE_URL", "http://tailscale:9090")
ORACLE_MODEL = "qwen2.5:1.5b"
COMPGATE_MODEL = "gpt-oss:20b"


async def _oracle_ollama_status() -> dict:
    result = {"name": "Oracle-Ollama", "reachable": False, "state": "unreachable", "expected_model": ORACLE_MODEL, "model_present": False, "apps": ["vibeslopwiki", "chatrequest"]}
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{ORACLE_OLLAMA_URL}/api/tags")
        if response.status_code != 200:
            result["state"] = "error"
            return result
        names = {model.get("name", "") for model in response.json().get("models", []) if isinstance(model, dict)}
        result.update({"reachable": True, "state": "available", "model_present": ORACLE_MODEL in names})
    except (httpx.HTTPError, ValueError):
        pass
    return result


async def _compgate_status() -> dict:
    result = {"name": "Tailscale-CompGate", "reachable": False, "state": "unreachable", "expected_model": COMPGATE_MODEL, "apps": ["genquest", "cchannel"], "services": {"home_ollama": "unknown", "kokoro": "unknown", "bark": "unknown"}}
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{COMPGATE_URL}/health")
        if response.status_code == 200:
            result.update({"reachable": True, "state": "available"})
        elif response.status_code == 503:
            result.update({"reachable": True, "state": "paused_or_busy"})
        else:
            result["state"] = "error"
    except httpx.HTTPError:
        pass
    return result


async def get_ai_status() -> dict:
    """Return only operational state; never expose backend URLs or credentials."""
    return {"oracle_ollama": await _oracle_ollama_status(), "tailscale_compgate": await _compgate_status()}
