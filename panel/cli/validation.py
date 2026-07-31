"""Strict, dependency-free validation and safe error rendering for 3cli."""
import re

_DOMAIN = re.compile(r"(?=.{1,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\Z")
_NAMESERVER = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\Z")


def domain(value: str) -> str:
    result = value.strip().lower().rstrip(".")
    if not _DOMAIN.fullmatch(result) or ".." in result:
        raise ValueError("domain must be a normalized registrable-looking hostname")
    return result


def nameservers(values: list[str]) -> list[str]:
    if len(values) != 2:
        raise ValueError("exactly two nameservers are required")
    result = [value.strip().lower().rstrip(".") for value in values]
    if len(set(result)) != 2 or any(not _NAMESERVER.fullmatch(value) for value in result):
        raise ValueError("nameservers must be two distinct valid hostnames")
    return result


def safe_error(error: Exception) -> str:
    message = str(error)
    if any(marker in message.lower() for marker in ("token", "apikey", "authorization", "secret", "password")):
        return "provider operation failed"
    return message[:300] or "operation failed"
