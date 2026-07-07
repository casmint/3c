"""App & container discovery/management.

The filesystem is the registry: every subdirectory of apps/ with its own
docker-compose.yml is an app. Core/shared services are read directly from
the root docker-compose.yml's own compose project (no apps.json — a
registry file can drift from reality; the filesystem can't).
"""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

BASE_DIR = Path(os.environ.get("APP_BASE_DIR", Path(__file__).resolve().parent.parent.parent))
APPS_DIR = BASE_DIR / "apps"
NETWORK = "3c-network"

# docker compose infers the project name from the current directory's basename.
# Inside the panel container BASE_DIR is /app, but the root stack was actually
# brought up from /home/ubuntu/3c on the host — so project-scoped commands
# against the root compose file must pin the name explicitly or they'll
# silently match zero containers.
ROOT_PROJECT = "3c"

# Services defined in the root docker-compose.yml that ARE the platform itself.
# Everything else in the root compose (e.g. ollama) is a shared service apps consume.
CORE_SERVICES = {"panel", "traefik", "cloudflared"}


def _get_github_token() -> str:
    return os.environ.get("GITHUB_TOKEN", os.environ.get("C3_GITHUB_TOKEN", ""))


def _inject_github_token(repo_url: str) -> str:
    token = _get_github_token()
    if not token:
        return repo_url
    if "github.com" in repo_url and repo_url.startswith("https://"):
        return repo_url.replace("https://github.com", f"https://{token}@github.com")
    return repo_url


def _redact_token(text: str) -> str:
    token = _get_github_token()
    if token:
        return text.replace(token, "***")
    return text


# ================================================================
# Low-level docker / compose helpers
# ================================================================

def _docker(*args: str, timeout: int = 30) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        return subprocess.CompletedProcess(args=["docker", *args], returncode=1, stdout="", stderr="docker not found")
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args=["docker", *args], returncode=1, stdout="", stderr="timed out")


def _compose(*args: str, cwd: str | Path, timeout: int = 300) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(["docker", "compose", *args], cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args=["docker", "compose", *args], returncode=1, stdout="", stderr="timed out")


def _parse_ndjson(text: str) -> list[dict]:
    items = []
    for line in text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return items


def _compose_ps(cwd: str | Path) -> list[dict]:
    r = _compose("ps", "-a", "--format", "json", cwd=cwd, timeout=15)
    if r.returncode != 0:
        return []
    return _parse_ndjson(r.stdout)


def _compose_config(cwd: str | Path) -> dict:
    r = _compose("config", "--format", "json", cwd=cwd, timeout=15)
    if r.returncode != 0:
        return {}
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return {}


_HOST_RULE_RE = re.compile(r"Host\(`([^`]+)`\)")


def _extract_routing(labels: dict) -> tuple[str | None, str | None]:
    """Pull the first Host() domain and load-balancer port out of Traefik labels."""
    domain = None
    port = None
    for k, v in labels.items():
        if domain is None:
            m = _HOST_RULE_RE.search(str(v))
            if m:
                domain = m.group(1)
        if port is None and k.endswith(".loadbalancer.server.port"):
            port = str(v)
    return domain, port


def get_container_logs(name: str, tail: int = 200) -> str:
    r = _docker("logs", "--tail", str(tail), "--timestamps", name, timeout=15)
    if r.returncode != 0:
        return r.stderr or f"Failed to get logs for {name}"
    return r.stdout + r.stderr  # docker logs sends some output to stderr


# ================================================================
# Live resource stats (fetched separately — `docker stats` takes ~2s
# to sample regardless of container count, so this is its own
# endpoint the frontend loads after the initial page paint)
# ================================================================

def get_docker_stats() -> dict[str, dict]:
    r = _docker("stats", "--no-stream", "--format", "json", timeout=15)
    if r.returncode != 0:
        return {}
    stats = {}
    for item in _parse_ndjson(r.stdout):
        name = item.get("Name")
        if not name:
            continue
        stats[name] = {
            "mem_usage": item.get("MemUsage", ""),
            "mem_pct": item.get("MemPerc", ""),
            "cpu_pct": item.get("CPUPerc", ""),
        }
    return stats


# ================================================================
# Root services (core + shared)
# ================================================================

def discover_root_services() -> dict:
    """Classify every service in the root docker-compose.yml as core or shared."""
    r = _compose("-p", ROOT_PROJECT, "ps", "-a", "--format", "json", cwd=BASE_DIR, timeout=15)
    ps = _parse_ndjson(r.stdout) if r.returncode == 0 else []
    core, shared = [], []
    for c in ps:
        service = c.get("Service", "")
        entry = {
            "name": c.get("Name", ""),
            "service": service,
            "image": c.get("Image", ""),
            "status_text": c.get("Status", ""),
            "running": c.get("State") == "running",
        }
        (core if service in CORE_SERVICES else shared).append(entry)
    return {"core": core, "shared": shared}


def discover_other_containers(known_names: set[str]) -> list[dict]:
    """Anything running on the host that isn't a core/shared/app container."""
    r = _docker("ps", "-a", "--format", "json", timeout=15)
    if r.returncode != 0:
        return []
    out = []
    for c in _parse_ndjson(r.stdout):
        name = c.get("Names", "")
        if not name or name in known_names:
            continue
        out.append({
            "name": name,
            "image": c.get("Image", ""),
            "status_text": c.get("Status", ""),
            "running": c.get("State") == "running",
        })
    return out


# ================================================================
# Git status (used by both apps and 3c self)
# ================================================================

def _git_status(repo_dir: Path) -> dict:
    if not (repo_dir / ".git").exists():
        return {"is_repo": False}

    result = {"is_repo": True, "branch": "", "last_commit": "", "dirty": False, "ahead": 0, "behind": 0, "remote": ""}
    try:
        subprocess.run(["git", "fetch"], cwd=str(repo_dir), capture_output=True, timeout=10)
    except Exception:
        pass
    try:
        r = subprocess.run(["git", "branch", "--show-current"], cwd=str(repo_dir), capture_output=True, text=True, timeout=5)
        result["branch"] = r.stdout.strip()

        r = subprocess.run(["git", "log", "-1", "--format=%h %s"], cwd=str(repo_dir), capture_output=True, text=True, timeout=5)
        result["last_commit"] = r.stdout.strip()

        r = subprocess.run(["git", "status", "--porcelain"], cwd=str(repo_dir), capture_output=True, text=True, timeout=5)
        result["dirty"] = len(r.stdout.strip()) > 0

        r = subprocess.run(["git", "rev-list", "--left-right", "--count", "HEAD...@{u}"], cwd=str(repo_dir), capture_output=True, text=True, timeout=5)
        if r.returncode == 0 and r.stdout.strip():
            parts = r.stdout.strip().split()
            if len(parts) >= 2:
                result["ahead"] = int(parts[0])
                result["behind"] = int(parts[1])

        r = subprocess.run(["git", "remote", "get-url", "origin"], cwd=str(repo_dir), capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            result["remote"] = _redact_token(r.stdout.strip())
    except Exception as e:
        result["error"] = str(e)
    return result


def get_git_status(app_name: str) -> dict:
    app_dir = APPS_DIR / app_name
    if not app_dir.exists():
        return {"error": "App folder not found"}
    status = _git_status(app_dir)
    if not status.get("is_repo"):
        return {"error": "Not a git repo"}
    return status


def get_3c_git_status() -> dict:
    return _git_status(BASE_DIR)


# ================================================================
# App discovery (apps/ dir is the registry)
# ================================================================

def _compose_file(app_dir: Path) -> Path | None:
    for candidate in ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"):
        p = app_dir / candidate
        if p.exists():
            return p
    return None


def list_app_names() -> list[str]:
    if not APPS_DIR.exists():
        return []
    return sorted(
        d.name for d in APPS_DIR.iterdir()
        if d.is_dir() and _compose_file(d) is not None
    )


def _app_dir(name: str) -> Path:
    return APPS_DIR / name


def _discover_app(name: str) -> dict:
    app_dir = _app_dir(name)
    ps = _compose_ps(app_dir)
    config = _compose_config(app_dir)
    services_cfg = config.get("services", {}) if config else {}

    domain = None
    port = None
    uses_ollama = False
    for svc in services_cfg.values():
        labels = svc.get("labels") or {}
        d, p = _extract_routing(labels)
        domain = domain or d
        port = port or p
        env = svc.get("environment") or {}
        if any("OLLAMA" in k.upper() for k in env):
            uses_ollama = True

    containers = [{
        "name": c.get("Name", ""),
        "service": c.get("Service", ""),
        "image": c.get("Image", ""),
        "status_text": c.get("Status", ""),
        "running": c.get("State") == "running",
    } for c in ps]

    if not containers:
        status = "not_deployed"
    elif all(c["running"] for c in containers):
        status = "running"
    elif any(c["running"] for c in containers):
        status = "partial"
    else:
        status = "stopped"

    return {
        "name": name,
        "domain": domain,
        "port": port,
        "uses_ollama": uses_ollama,
        "status": status,
        "running": status in ("running", "partial"),
        "containers": containers,
        "git": _git_status(app_dir),
    }


def discover_apps() -> list[dict]:
    return [_discover_app(name) for name in list_app_names()]


# ================================================================
# App actions (compose-based — correct for both single- and
# multi-container apps)
# ================================================================

def start_app(name: str) -> tuple[bool, str]:
    r = _compose("start", cwd=_app_dir(name), timeout=60)
    if r.returncode != 0:
        return False, r.stderr or "Failed to start"
    return True, "Started"


def stop_app(name: str) -> tuple[bool, str]:
    r = _compose("stop", cwd=_app_dir(name), timeout=60)
    if r.returncode != 0:
        return False, r.stderr or "Failed to stop"
    return True, "Stopped"


def restart_app(name: str) -> tuple[bool, str]:
    r = _compose("restart", cwd=_app_dir(name), timeout=60)
    if r.returncode != 0:
        return False, r.stderr or "Failed to restart"
    return True, "Restarted"


def deploy_app(name: str) -> tuple[bool, str]:
    """Rebuild image(s) and (re)start — docker compose up -d --build."""
    r = _compose("up", "-d", "--build", cwd=_app_dir(name), timeout=300)
    if r.returncode != 0:
        return False, r.stderr[-1000:] if len(r.stderr) > 1000 else r.stderr
    return True, "Deployed"


def pull_and_restart(name: str) -> list[tuple[str, bool, str]]:
    """git pull -> rebuild -> redeploy."""
    app_dir = _app_dir(name)
    results = []
    try:
        r = subprocess.run(["git", "pull"], cwd=str(app_dir), capture_output=True, text=True, timeout=60)
        ok = r.returncode == 0
        msg = _redact_token(r.stdout.strip() or r.stderr.strip() or ("Already up to date" if ok else "Pull failed"))
        results.append(("pull", ok, msg))
        if not ok:
            return results
    except Exception as e:
        results.append(("pull", False, _redact_token(str(e))))
        return results

    ok, msg = deploy_app(name)
    results.append(("deploy", ok, msg))
    return results


def delete_app(name: str) -> tuple[bool, str]:
    app_dir = _app_dir(name)
    if app_dir.exists():
        _compose("down", "--remove-orphans", "-v", cwd=app_dir, timeout=60)
        shutil.rmtree(app_dir, ignore_errors=True)
    return True, "Deleted"


def get_app_logs(name: str, tail: int = 200) -> str:
    ps = _compose_ps(_app_dir(name))
    if not ps:
        return "No containers found for this app."
    parts = []
    for c in ps:
        log = get_container_logs(c.get("Name", ""), tail=tail)
        parts.append(f"=== {c.get('Name')} ===\n{log}" if len(ps) > 1 else log)
    return "\n".join(parts)


def clone_app(name: str, repo: str, branch: str = "main") -> tuple[bool, str]:
    if not re.match(r"^[a-zA-Z0-9_-]+$", name):
        return False, "Invalid app name — use letters, numbers, - and _ only"

    target = APPS_DIR / name
    if target.exists():
        return False, f"Directory already exists: {target}"

    APPS_DIR.mkdir(parents=True, exist_ok=True)
    repo_url = _inject_github_token(repo)
    try:
        r = subprocess.run(
            ["git", "clone", "-b", branch, repo_url, str(target)],
            capture_output=True, text=True, timeout=120,
        )
        if r.returncode != 0:
            return False, _redact_token(r.stderr)
    except subprocess.TimeoutExpired:
        return False, "Clone timed out"
    except Exception as e:
        return False, _redact_token(str(e))

    if _compose_file(target) is None:
        return False, (
            f"Cloned to {target}, but no docker-compose.yml was found. "
            "Add one following docs/adding-an-app.md, then hit Deploy."
        )
    return True, f"Cloned to {target}"


# ================================================================
# Raw container actions (core / shared services)
# ================================================================

def start_container(name: str) -> tuple[bool, str]:
    r = _docker("start", name, timeout=30)
    if r.returncode != 0:
        return False, r.stderr or f"Failed to start {name}"
    return True, f"Started {name}"


def stop_container(name: str) -> tuple[bool, str]:
    r = _docker("stop", name, timeout=30)
    if r.returncode != 0:
        return False, r.stderr or f"Failed to stop {name}"
    return True, f"Stopped {name}"


def restart_container(name: str) -> tuple[bool, str]:
    r = _docker("restart", name, timeout=30)
    if r.returncode != 0:
        return False, r.stderr or f"Failed to restart {name}"
    return True, f"Restarted {name}"


# ================================================================
# 3C Self-Update
# ================================================================

def pull_3c() -> dict:
    result = {"success": False, "message": "", "changed_files": [], "restart_required": False}

    try:
        head_before = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(BASE_DIR), capture_output=True, text=True, timeout=5)
        old_head = head_before.stdout.strip() if head_before.returncode == 0 else None

        pull = subprocess.run(["git", "pull"], cwd=str(BASE_DIR), capture_output=True, text=True, timeout=60)
        if pull.returncode != 0:
            result["message"] = pull.stderr.strip() or "Pull failed"
            return result

        if "Already up to date" in pull.stdout:
            result["success"] = True
            result["message"] = "Already up to date"
            return result

        head_after = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(BASE_DIR), capture_output=True, text=True, timeout=5)
        new_head = head_after.stdout.strip() if head_after.returncode == 0 else None

        if old_head and new_head and old_head != new_head:
            diff = subprocess.run(["git", "diff", "--name-only", old_head, new_head], cwd=str(BASE_DIR), capture_output=True, text=True, timeout=10)
            if diff.returncode == 0:
                result["changed_files"] = [f for f in diff.stdout.strip().split("\n") if f]

        for f in result["changed_files"]:
            if f.endswith(".py") or f in ("Dockerfile", "docker-compose.yml", "pyproject.toml"):
                result["restart_required"] = True
                break

        result["success"] = True
        result["message"] = pull.stdout.strip()
        return result

    except subprocess.TimeoutExpired:
        result["message"] = "Pull timed out"
        return result
    except Exception as e:
        result["message"] = str(e)
        return result


def restart_3c() -> tuple[bool, str]:
    """Rebuild and restart the 3C panel via docker compose."""
    try:
        r = subprocess.run(
            ["docker", "compose", "-p", ROOT_PROJECT, "up", "--build", "-d", "panel"],
            cwd=str(BASE_DIR),
            capture_output=True, text=True, timeout=300,
        )
        if r.returncode != 0:
            return False, r.stderr
        return True, "Restarting..."
    except Exception as e:
        return False, str(e)
