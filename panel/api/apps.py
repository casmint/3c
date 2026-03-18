"""App management: registry, git ops, build, deploy, logs, self-update.

Adapted from the C3 reference implementation. Uses subprocess for all
Docker operations (both compose and single-container) since the panel
container mounts the Docker binary and socket directly.
"""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Literal

# Paths — /app is the working directory inside the container
BASE_DIR = Path(os.environ.get("APP_BASE_DIR", Path(__file__).resolve().parent.parent.parent))
APPS_FILE = BASE_DIR / "apps.json"
APPS_DIR = BASE_DIR / "apps"
GENERATED_DIR = BASE_DIR / "generated"

NETWORK = "3c-network"
CONTAINER_PREFIX = "3c"


def _get_github_token() -> str:
    return os.environ.get("C3_GITHUB_TOKEN", "")


def _inject_github_token(repo_url: str) -> str:
    """Inject GitHub token into HTTPS repo URL for private repo access."""
    token = _get_github_token()
    if not token:
        return repo_url
    if "github.com" in repo_url and repo_url.startswith("https://"):
        return repo_url.replace("https://github.com", f"https://{token}@github.com")
    return repo_url


def _redact_token(text: str) -> str:
    """Strip token from any error messages before returning to client."""
    token = _get_github_token()
    if token:
        return text.replace(token, "***")
    return text


# ================================================================
# App Registry (apps.json)
# ================================================================

AppType = Literal["web", "worker", "stack"]


def load_apps() -> list[dict]:
    if not APPS_FILE.exists():
        return []
    with open(APPS_FILE) as f:
        data = json.load(f)
    return data.get("apps", []) if isinstance(data, dict) else data


def save_apps(apps: list[dict]) -> None:
    with open(APPS_FILE, "w") as f:
        json.dump({"apps": apps}, f, indent=2)


def get_app(name: str) -> dict | None:
    for app in load_apps():
        if app["name"] == name:
            return app
    return None


def add_app(
    name: str,
    app_type: AppType,
    repo: str | None = None,
    branch: str = "main",
    domain: str | None = None,
    port: int = 8000,
    env_vars: dict | None = None,
) -> dict:
    apps = load_apps()
    if any(a["name"] == name for a in apps):
        raise ValueError(f"App '{name}' already exists")

    app = {
        "name": name,
        "type": app_type,
        "repo": repo,
        "branch": branch,
        "domain": domain,
        "port": port,
        "env_vars": env_vars or {},
        "enabled": True,
    }
    apps.append(app)
    save_apps(apps)
    return app


def remove_app(name: str) -> bool:
    apps = load_apps()
    apps = [a for a in apps if a["name"] != name]
    save_apps(apps)
    return True


def get_app_path(app: dict | str) -> Path:
    name = app["name"] if isinstance(app, dict) else app
    return APPS_DIR / name


# ================================================================
# Docker helpers (subprocess-based)
# ================================================================

def _docker(*args: str, timeout: int = 30) -> subprocess.CompletedProcess:
    """Run a docker CLI command. Returns a failed result if docker is not available."""
    try:
        return subprocess.run(
            ["docker", *args],
            capture_output=True, text=True, timeout=timeout,
        )
    except FileNotFoundError:
        return subprocess.CompletedProcess(
            args=["docker", *args], returncode=1,
            stdout="", stderr="docker not found",
        )


def _compose(*args: str, cwd: str | Path, timeout: int = 300) -> subprocess.CompletedProcess:
    """Run a docker compose command in a directory."""
    return subprocess.run(
        ["docker", "compose", *args],
        cwd=str(cwd),
        capture_output=True, text=True, timeout=timeout,
    )


def get_container_status(name: str) -> dict | None:
    """Get container status by name. Returns None if not found."""
    r = _docker("inspect", "--format",
                '{"status":"{{.State.Status}}","running":{{.State.Running}}}',
                name, timeout=10)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout.strip())
    except json.JSONDecodeError:
        return None


def list_network_containers() -> list[dict]:
    """List all containers on the 3c-network."""
    r = _docker("network", "inspect", NETWORK,
                "--format", "{{range .Containers}}{{.Name}} {{end}}",
                timeout=10)
    if r.returncode != 0:
        return []
    names = r.stdout.strip().split()
    result = []
    for name in names:
        info = get_container_status(name)
        if info:
            info["name"] = name
            result.append(info)
    return result


def get_container_logs(name: str, tail: int = 200) -> str:
    """Get last N lines of container logs."""
    # For stack apps, try the project name pattern
    r = _docker("logs", "--tail", str(tail), "--timestamps", name, timeout=15)
    if r.returncode != 0:
        return r.stderr or f"Failed to get logs for {name}"
    return r.stdout + r.stderr  # docker logs sends some output to stderr


def get_app_containers(app_name: str) -> list[dict]:
    """Find all running containers that belong to an app.

    Matches containers named: {app_name}, {app_name}-*, {app_name}_*
    These patterns cover both single-container and docker-compose services.
    """
    r = _docker("ps", "-a", "--format", "{{.Names}}\t{{.Status}}\t{{.State}}", timeout=10)
    if r.returncode != 0:
        return []
    containers = []
    for line in r.stdout.strip().split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        cname, status_text, state = parts[0], parts[1], parts[2]
        if (cname == app_name
                or cname.startswith(f"{app_name}-")
                or cname.startswith(f"{app_name}_")):
            containers.append({
                "name": cname,
                "status_text": status_text,
                "running": state == "running",
            })
    return containers


# ================================================================
# Git Operations
# ================================================================

def clone_app(app: dict) -> tuple[bool, str]:
    if not app.get("repo"):
        return False, "No repo URL specified"

    target = get_app_path(app)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return False, f"Directory already exists: {target}"

    repo_url = _inject_github_token(app["repo"])
    try:
        r = subprocess.run(
            ["git", "clone", "-b", app.get("branch", "main"), repo_url, str(target)],
            capture_output=True, text=True, timeout=120,
        )
        if r.returncode != 0:
            return False, _redact_token(r.stderr)
        return True, f"Cloned to {target}"
    except subprocess.TimeoutExpired:
        return False, "Clone timed out"
    except Exception as e:
        return False, _redact_token(str(e))


def pull_app(app: dict) -> tuple[bool, str]:
    target = get_app_path(app)
    if not target.exists():
        return False, "App not cloned yet"

    try:
        # Temporarily inject token into remote URL for private repos
        original_url = None
        token = _get_github_token()
        if token and app.get("repo") and "github.com" in app["repo"]:
            get_url = subprocess.run(
                ["git", "remote", "get-url", "origin"],
                cwd=str(target), capture_output=True, text=True,
            )
            if get_url.returncode == 0:
                original_url = get_url.stdout.strip()
                subprocess.run(
                    ["git", "remote", "set-url", "origin", _inject_github_token(app["repo"])],
                    cwd=str(target), capture_output=True,
                )

        r = subprocess.run(
            ["git", "pull"], cwd=str(target),
            capture_output=True, text=True, timeout=60,
        )

        # Restore original URL (strip token)
        if original_url:
            subprocess.run(
                ["git", "remote", "set-url", "origin", original_url],
                cwd=str(target), capture_output=True,
            )

        if r.returncode != 0:
            return False, _redact_token(r.stderr)
        return True, r.stdout.strip() or "Already up to date"
    except Exception as e:
        return False, _redact_token(str(e))


def get_git_status(app_name: str) -> dict:
    app_dir = APPS_DIR / app_name
    if not app_dir.exists():
        return {"error": "App folder not found"}
    if not (app_dir / ".git").exists():
        return {"error": "Not a git repo"}

    result = {"branch": "", "last_commit": "", "dirty": False, "ahead": 0, "behind": 0}

    try:
        subprocess.run(["git", "fetch"], cwd=str(app_dir),
                        capture_output=True, timeout=10)
    except Exception:
        pass

    try:
        r = subprocess.run(["git", "branch", "--show-current"],
                           cwd=str(app_dir), capture_output=True, text=True, timeout=5)
        result["branch"] = r.stdout.strip()

        r = subprocess.run(["git", "log", "-1", "--format=%h %s"],
                           cwd=str(app_dir), capture_output=True, text=True, timeout=5)
        result["last_commit"] = r.stdout.strip()

        r = subprocess.run(["git", "status", "--porcelain"],
                           cwd=str(app_dir), capture_output=True, text=True, timeout=5)
        result["dirty"] = len(r.stdout.strip()) > 0

        r = subprocess.run(["git", "rev-list", "--left-right", "--count", "HEAD...@{u}"],
                           cwd=str(app_dir), capture_output=True, text=True, timeout=5)
        if r.returncode == 0 and r.stdout.strip():
            parts = r.stdout.strip().split()
            if len(parts) >= 2:
                result["ahead"] = int(parts[0])
                result["behind"] = int(parts[1])
    except Exception as e:
        result["error"] = str(e)

    return result


# ================================================================
# Build Operations
# ================================================================

def _generate_compose_override(app: dict) -> Path | None:
    """Generate a docker-compose override file to inject 3c-network and Traefik labels.

    Returns the path to the override file, or None if no override is needed.
    """
    domain = app.get("domain")
    port = app.get("port", 8000)
    safe_name = re.sub(r"[^a-z0-9]", "", app["name"])

    # Build labels for Traefik routing
    labels = {}
    if domain and app["type"] != "worker":
        labels = {
            "traefik.enable": "true",
            f"traefik.http.routers.{safe_name}.rule": f"Host(`{domain}`)",
            f"traefik.http.routers.{safe_name}.entrypoints": "web",
            f"traefik.http.services.{safe_name}.loadbalancer.server.port": str(port),
        }

    # Read the app's compose file to find service names
    app_dir = get_app_path(app)
    compose_file = app_dir / "docker-compose.yml"
    if not compose_file.exists():
        return None

    try:
        # Parse service names from the compose file
        r = subprocess.run(
            ["docker", "compose", "config", "--services"],
            cwd=str(app_dir), capture_output=True, text=True, timeout=10,
        )
        services = r.stdout.strip().split("\n") if r.returncode == 0 else []
    except Exception:
        services = []

    if not services:
        return None

    # Build override YAML
    override = {"services": {}, "networks": {NETWORK: {"external": True}}}
    for i, svc in enumerate(services):
        svc_override: dict = {"networks": [NETWORK]}
        # Apply Traefik labels only to the first service (assumed primary)
        if i == 0 and labels:
            svc_override["labels"] = labels
        override["services"][svc] = svc_override

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    override_path = GENERATED_DIR / f"{app['name']}-override.yml"

    # Write YAML manually (avoid requiring pyyaml)
    lines = ["services:"]
    for svc, cfg in override["services"].items():
        lines.append(f"  {svc}:")
        lines.append("    networks:")
        for net in cfg["networks"]:
            lines.append(f"      - {net}")
        if "labels" in cfg:
            lines.append("    labels:")
            for k, v in cfg["labels"].items():
                lines.append(f'      - "{k}={v}"')
    lines.append("networks:")
    lines.append(f"  {NETWORK}:")
    lines.append("    external: true")
    lines.append("")

    override_path.write_text("\n".join(lines))
    return override_path


def generate_dockerfile(app: dict) -> Path:
    """Generate a Dockerfile for web/worker apps that don't have one."""
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    dockerfile_path = GENERATED_DIR / f"{app['name']}.Dockerfile"

    app_dir = get_app_path(app)
    if (app_dir / "main.py").exists():
        entrypoint = "main:app"
    elif (app_dir / "app.py").exists():
        entrypoint = "app:app"
    elif (app_dir / "src" / "main.py").exists():
        entrypoint = "src.main:app"
    else:
        entrypoint = "main:app"

    port = app.get("port", 8000)

    if app["type"] == "worker":
        content = """FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* ./
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true
COPY . .
CMD ["python", "main.py"]
"""
    else:
        content = f"""FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* ./
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true
COPY . .
CMD ["uvicorn", "{entrypoint}", "--host", "0.0.0.0", "--port", "{port}"]
"""

    dockerfile_path.write_text(content)
    return dockerfile_path


def build_app(app: dict) -> tuple[bool, str]:
    app_dir = get_app_path(app)
    if not app_dir.exists():
        return False, "App not cloned yet"

    if app["type"] == "stack":
        override = _generate_compose_override(app)
        try:
            cmd = ["docker", "compose"]
            if override:
                cmd += ["-f", "docker-compose.yml", "-f", str(override)]
            cmd += ["build"]
            r = subprocess.run(cmd, cwd=str(app_dir),
                               capture_output=True, text=True, timeout=300)
            if r.returncode != 0:
                return False, r.stderr[-500:] if len(r.stderr) > 500 else r.stderr
            return True, "Built with docker compose"
        except subprocess.TimeoutExpired:
            return False, "Build timed out"
        except Exception as e:
            return False, str(e)

    # web/worker — single image
    image_name = f"3c-{app['name']}:latest"
    if (app_dir / "Dockerfile").exists():
        dockerfile = str(app_dir / "Dockerfile")
    else:
        dockerfile = str(generate_dockerfile(app))

    try:
        r = _docker("build", "-t", image_name, "-f", dockerfile, str(app_dir), timeout=300)
        if r.returncode != 0:
            return False, r.stderr[-500:] if len(r.stderr) > 500 else r.stderr
        return True, f"Built image: {image_name}"
    except subprocess.TimeoutExpired:
        return False, "Build timed out"
    except Exception as e:
        return False, str(e)


# ================================================================
# Deploy Operations
# ================================================================

def _traefik_labels(app: dict) -> list[str]:
    """Build Traefik label flags for docker run."""
    domain = app.get("domain")
    if not domain or app["type"] == "worker":
        return []
    safe = re.sub(r"[^a-z0-9]", "", app["name"])
    port = app.get("port", 8000)
    return [
        "--label", "traefik.enable=true",
        "--label", f"traefik.http.routers.{safe}.rule=Host(`{domain}`)",
        "--label", f"traefik.http.routers.{safe}.entrypoints=web",
        "--label", f"traefik.http.services.{safe}.loadbalancer.server.port={port}",
    ]


def deploy_app(app: dict) -> tuple[bool, str]:
    app_dir = get_app_path(app)
    if not app_dir.exists():
        return False, "App not cloned yet"

    if app["type"] == "stack":
        override = _generate_compose_override(app)
        try:
            cmd = ["docker", "compose"]
            if override:
                cmd += ["-f", "docker-compose.yml", "-f", str(override)]
            cmd += ["up", "-d"]
            r = subprocess.run(cmd, cwd=str(app_dir),
                               capture_output=True, text=True, timeout=120)
            if r.returncode != 0:
                return False, r.stderr[-500:] if len(r.stderr) > 500 else r.stderr
            return True, "Deployed with docker compose"
        except Exception as e:
            return False, str(e)

    # web/worker — single container
    image_name = f"3c-{app['name']}:latest"
    container_name = f"3c-{app['name']}"

    # Remove existing container
    _docker("rm", "-f", container_name, timeout=15)

    cmd = [
        "docker", "run", "-d",
        "--name", container_name,
        "--network", NETWORK,
        "--restart", "unless-stopped",
    ]

    # Add Traefik labels
    cmd.extend(_traefik_labels(app))

    # Add env vars
    for k, v in app.get("env_vars", {}).items():
        cmd.extend(["-e", f"{k}={v}"])

    cmd.append(image_name)

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return False, r.stderr
        return True, f"Deployed container: {container_name}"
    except Exception as e:
        return False, str(e)


def stop_app(app: dict) -> tuple[bool, str]:
    app_dir = get_app_path(app)

    if app["type"] == "stack":
        override = _generate_compose_override(app)
        try:
            cmd = ["docker", "compose"]
            if override:
                cmd += ["-f", "docker-compose.yml", "-f", str(override)]
            cmd += ["stop"]
            r = subprocess.run(cmd, cwd=str(app_dir),
                               capture_output=True, text=True, timeout=60)
            if r.returncode != 0:
                return False, r.stderr
            return True, "Stopped"
        except Exception as e:
            return False, str(e)

    container_name = f"3c-{app['name']}"
    r = _docker("stop", container_name, timeout=30)
    if r.returncode != 0:
        return False, r.stderr or "Container not found"
    return True, f"Stopped {container_name}"


def delete_app_containers(app: dict) -> tuple[bool, str]:
    """Stop and remove containers, then delete app files."""
    app_dir = get_app_path(app)

    if app["type"] == "stack" and app_dir.exists():
        override = _generate_compose_override(app)
        cmd = ["docker", "compose"]
        if override:
            cmd += ["-f", "docker-compose.yml", "-f", str(override)]
        cmd += ["down", "--remove-orphans"]
        subprocess.run(cmd, cwd=str(app_dir),
                       capture_output=True, text=True, timeout=60)
    else:
        _docker("rm", "-f", f"3c-{app['name']}", timeout=15)

    # Delete app directory
    if app_dir.exists():
        shutil.rmtree(app_dir, ignore_errors=True)

    return True, "Deleted"


# ================================================================
# Combined Operations
# ================================================================

def full_deploy(app: dict) -> list[tuple[str, bool, str]]:
    """Clone (if needed) → build → deploy."""
    results = []

    app_dir = get_app_path(app)
    if not app_dir.exists():
        if app.get("repo"):
            ok, msg = clone_app(app)
            results.append(("clone", ok, msg))
            if not ok:
                return results
        else:
            results.append(("clone", False, "No repo and app folder doesn't exist"))
            return results
    else:
        results.append(("clone", True, "Already exists"))

    ok, msg = build_app(app)
    results.append(("build", ok, msg))
    if not ok:
        return results

    ok, msg = deploy_app(app)
    results.append(("deploy", ok, msg))
    return results


def pull_and_restart(app: dict) -> list[tuple[str, bool, str]]:
    """Pull → rebuild → redeploy."""
    results = []

    ok, msg = pull_app(app)
    results.append(("pull", ok, msg))
    if not ok:
        return results

    ok, msg = build_app(app)
    results.append(("build", ok, msg))
    if not ok:
        return results

    ok, msg = deploy_app(app)
    results.append(("deploy", ok, msg))
    return results


# ================================================================
# 3C Self-Update
# ================================================================

def pull_3c() -> dict:
    """Pull 3C's own repo and detect what changed."""
    result = {
        "success": False,
        "message": "",
        "changed_files": [],
        "restart_required": False,
    }

    try:
        head_before = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=str(BASE_DIR),
            capture_output=True, text=True, timeout=5,
        )
        old_head = head_before.stdout.strip() if head_before.returncode == 0 else None

        pull = subprocess.run(
            ["git", "pull"], cwd=str(BASE_DIR),
            capture_output=True, text=True, timeout=60,
        )
        if pull.returncode != 0:
            result["message"] = pull.stderr.strip() or "Pull failed"
            return result

        if "Already up to date" in pull.stdout:
            result["success"] = True
            result["message"] = "Already up to date"
            return result

        head_after = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=str(BASE_DIR),
            capture_output=True, text=True, timeout=5,
        )
        new_head = head_after.stdout.strip() if head_after.returncode == 0 else None

        if old_head and new_head and old_head != new_head:
            diff = subprocess.run(
                ["git", "diff", "--name-only", old_head, new_head], cwd=str(BASE_DIR),
                capture_output=True, text=True, timeout=10,
            )
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
            ["docker", "compose", "up", "--build", "-d", "panel"],
            cwd=str(BASE_DIR),
            capture_output=True, text=True, timeout=300,
        )
        if r.returncode != 0:
            return False, r.stderr
        return True, "Restarting..."
    except Exception as e:
        return False, str(e)


def get_3c_git_status() -> dict:
    """Get git status for 3C itself."""
    result = {"branch": "", "last_commit": "", "dirty": False, "ahead": 0, "behind": 0}

    try:
        subprocess.run(["git", "fetch"], cwd=str(BASE_DIR),
                        capture_output=True, timeout=10)
    except Exception:
        pass

    try:
        r = subprocess.run(["git", "branch", "--show-current"],
                           cwd=str(BASE_DIR), capture_output=True, text=True, timeout=5)
        result["branch"] = r.stdout.strip()

        r = subprocess.run(["git", "log", "-1", "--format=%h %s"],
                           cwd=str(BASE_DIR), capture_output=True, text=True, timeout=5)
        result["last_commit"] = r.stdout.strip()

        r = subprocess.run(["git", "status", "--porcelain"],
                           cwd=str(BASE_DIR), capture_output=True, text=True, timeout=5)
        result["dirty"] = len(r.stdout.strip()) > 0

        r = subprocess.run(["git", "rev-list", "--left-right", "--count", "HEAD...@{u}"],
                           cwd=str(BASE_DIR), capture_output=True, text=True, timeout=5)
        if r.returncode == 0 and r.stdout.strip():
            parts = r.stdout.strip().split()
            if len(parts) >= 2:
                result["ahead"] = int(parts[0])
                result["behind"] = int(parts[1])
    except Exception as e:
        result["error"] = str(e)

    return result
