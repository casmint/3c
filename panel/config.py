import os
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


CONFIG_PATH = Path(os.environ.get("CONFIG_PATH", Path.home() / ".config" / "3c" / "config.toml"))


@dataclass
class CloudflareConfig:
    api_token: str
    account_id: str


@dataclass
class PorkbunConfig:
    api_key: str
    secret_api_key: str


@dataclass
class AppConfig:
    cloudflare: CloudflareConfig
    porkbun: Optional[PorkbunConfig] = None


def load_config() -> AppConfig:
    """Load config from ~/.config/3c/config.toml (or CONFIG_PATH env override).

    If the file does not exist, prints setup instructions and exits.
    """
    if not CONFIG_PATH.exists():
        print(
            f"""
3C Panel — configuration required

Create {CONFIG_PATH} with the following structure:

    [cloudflare]
    api_token = "your-cf-api-token"
    account_id = "your-account-id"

    [porkbun]
    api_key = "your-porkbun-api-key"
    secret_api_key = "your-porkbun-secret-key"
    # Porkbun section is optional — remove if not using

Then set permissions:

    chmod 600 {CONFIG_PATH}

See README.md for required Cloudflare API token scopes.
""",
            file=sys.stderr,
        )
        sys.exit(1)

    # Warn if permissions are too open
    mode = CONFIG_PATH.stat().st_mode & 0o777
    if mode != 0o600:
        print(
            f"Warning: {CONFIG_PATH} has permissions {oct(mode)}. "
            "Recommended: chmod 600",
            file=sys.stderr,
        )

    with open(CONFIG_PATH, "rb") as f:
        raw = tomllib.load(f)

    # Validate cloudflare section
    cf_raw = raw.get("cloudflare")
    if not cf_raw or not cf_raw.get("api_token") or not cf_raw.get("account_id"):
        print(
            "Error: config.toml must contain [cloudflare] section with "
            "api_token and account_id.",
            file=sys.stderr,
        )
        sys.exit(1)

    cf = CloudflareConfig(
        api_token=cf_raw["api_token"],
        account_id=cf_raw["account_id"],
    )

    # Optional porkbun section
    pb = None
    pb_raw = raw.get("porkbun")
    if pb_raw and pb_raw.get("api_key") and pb_raw.get("secret_api_key"):
        pb = PorkbunConfig(
            api_key=pb_raw["api_key"],
            secret_api_key=pb_raw["secret_api_key"],
        )

    return AppConfig(cloudflare=cf, porkbun=pb)
