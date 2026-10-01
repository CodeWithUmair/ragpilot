"""Site discovery: sitemap.xml + a same-origin BFS crawl, respecting robots.txt.

Discovery is network-bound, so each BFS wave fetches CONCURRENCY pages in
parallel — what turned a ~2 minute discovery of a 50-page site into seconds.
"""

import asyncio
import re
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

from app.lib.net import safe_client

MAX_PAGES = 50
CONCURRENCY = 5
MAX_SITEMAP_DEPTH = 2
EXCLUDE_PATTERNS = ("/checkout", "/cart", "/login", "/signup", "/account", "/admin", "/wp-admin", "/search")
USER_AGENT = "RagPilotBot/1.0 (+https://rag.umairamir.com)"


def http_client() -> httpx.AsyncClient:
    return safe_client(headers={"User-Agent": USER_AGENT})


def normalize_url(url: str) -> str:
    url = url.split("#")[0]
    return url[:-1] if url.endswith("/") else url


def is_excluded(url: str) -> bool:
    return any(p in url for p in EXCLUDE_PATTERNS)


def _origin(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def to_canonical(url: str, origin: str) -> str | None:
    """Rewrite www/apex (and http/https) variants of the site onto its canonical
    origin; None for other hosts. Without this, a sitemap listing the apex and
    pages linking to www.* were indexed as two copies of every page."""
    p, o = urlparse(url), urlparse(origin)
    if p.netloc.lower().removeprefix("www.") != o.netloc.lower().removeprefix("www."):
        return None
    return normalize_url(p._replace(scheme=o.scheme, netloc=o.netloc).geturl())


async def fetch_robots(client: httpx.AsyncClient, base_url: str) -> RobotFileParser | None:
    try:
        res = await client.get(f"{base_url.rstrip('/')}/robots.txt")
        if res.status_code >= 400:
            return None
        parser = RobotFileParser()
        parser.parse(res.text.splitlines())
        return parser
    except httpx.HTTPError:
        return None


async def fetch_sitemap_urls(client: httpx.AsyncClient, url: str, depth: int = 0) -> list[str]:
    try:
        xml = (await client.get(url)).text
    except httpx.HTTPError:
        return []
    locs = [normalize_url(m.strip()) for m in re.findall(r"<loc>(.*?)</loc>", xml, re.S)]
    if "<sitemapindex" in xml and depth < MAX_SITEMAP_DEPTH:
        nested = await asyncio.gather(*(fetch_sitemap_urls(client, loc, depth + 1) for loc in locs))
        return [u for group in nested for u in group]
    return locs


async def crawl_site(client: httpx.AsyncClient, base_url: str) -> list[str]:
    robots = await fetch_robots(client, base_url)
    origin = _origin(base_url)
    visited: set[str] = set()
    discovered: list[str] = []
    frontier = [normalize_url(base_url)]

    async def fetch(url: str) -> tuple[str, str] | None:
        try:
            res = await client.get(url)
            return (url, res.text) if "html" in res.headers.get("content-type", "html") else None
        except httpx.HTTPError:
            return None

    while frontier and len(discovered) < MAX_PAGES:
        batch: list[str] = []
        while frontier and len(batch) < CONCURRENCY and len(discovered) + len(batch) < MAX_PAGES:
            url = frontier.pop(0)
            if url in visited:
                continue
            visited.add(url)
            if (robots and not robots.can_fetch("*", url)) or is_excluded(url):
                continue
            batch.append(url)
        if not batch:
            continue

        for result in await asyncio.gather(*(fetch(u) for u in batch)):
            if not result:
                continue
            url, html = result
            discovered.append(url)
            for a in BeautifulSoup(html, "lxml").find_all("a", href=True):
                try:
                    absolute = urljoin(url, str(a["href"]))
                except ValueError:
                    continue
                canonical = absolute.startswith(("http://", "https://")) and to_canonical(absolute, origin)
                if canonical and canonical not in visited:
                    frontier.append(canonical)

    return discovered[:MAX_PAGES]


async def discover(base_url: str) -> tuple[list[str], list[str]]:
    """Returns (sitemap_urls, crawled_urls)."""
    async with http_client() as client:
        try:  # the post-redirect URL is the site's canonical origin (apex vs www)
            base_url = str((await client.get(base_url)).url)
        except httpx.HTTPError:
            pass
        origin = _origin(base_url)
        sitemap, crawled = await asyncio.gather(
            fetch_sitemap_urls(client, f"{origin}/sitemap.xml"),
            crawl_site(client, base_url),
        )
    return [c for u in sitemap if (c := to_canonical(u, origin))], crawled
