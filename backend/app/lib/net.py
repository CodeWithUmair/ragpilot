"""SSRF guard for server-side fetches of user-supplied URLs (crawler, lead
webhooks). Without it, a signed-up user could "train" a chatbot on
http://169.254.169.254/ (cloud metadata) or http://localhost:5432 and read the
result back through the chat. Checked on EVERY request, redirects included."""

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings


class BlockedURL(httpx.RequestError):
    pass


async def _resolves_public(host: str) -> bool:
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, host, None)
    except socket.gaierror:
        return True  # let the request itself fail with a normal DNS error
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            return False
    return True


async def ssrf_guard(request: httpx.Request) -> None:
    if not get_settings().is_production:
        return  # dev: allow crawling http://localhost test sites
    host = request.url.host
    if request.url.scheme not in ("http", "https") or not host or not await _resolves_public(host):
        raise BlockedURL(f"Refusing to fetch non-public address: {host}", request=request)


def safe_client(timeout: float = 20.0, headers: dict | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(timeout),
        headers=headers,
        event_hooks={"request": [ssrf_guard]},
    )


def is_http_url(value: str) -> bool:
    p = urlparse(value)
    return p.scheme in ("http", "https") and bool(p.netloc)
