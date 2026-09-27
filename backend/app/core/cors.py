"""Two CORS policies on one app, chosen by path.

  public  — widget endpoints called from ANY customer website.
  strict  — auth + dashboard API: only our own frontend origins.

Starlette's CORSMiddleware applies one policy globally, hence this small ASGI
middleware. Origins are reflected (never "*") with credentials allowed: the
dashboard's axios client sends withCredentials on every call, and the browser
discards credentialed responses that lack Allow-Credentials — the original
"Conversations shows no messages" bug.
"""

from urllib.parse import urlparse

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings

PUBLIC_PREFIXES = ("/api/chat", "/api/chatbots/public", "/api/leads")


def is_public_path(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") or path.startswith(p + "?") for p in PUBLIC_PREFIXES)


def is_allowed_origin(origin: str) -> bool:
    s = get_settings()
    exact = {s.app_url, "http://localhost:3000", *(s.cors_extra_origins or "").split(",")}
    if origin.rstrip("/") in {o.strip().rstrip("/") for o in exact if o.strip()}:
        return True
    host = urlparse(origin).hostname or ""
    if host in ("localhost", "127.0.0.1"):
        return True
    suffixes = [x.strip() for x in s.cors_origin_suffixes.split(",") if x.strip()]
    return any(host.endswith(sfx) or host == sfx.lstrip(".") for sfx in suffixes)


class DualCORSMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if not origin:  # same-origin, curl, server-to-server
            await self.app(scope, receive, send)
            return

        public = is_public_path(scope["path"])
        allowed = public or is_allowed_origin(origin)
        cors = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Expose-Headers": "set-auth-token",
            "Vary": "Origin",
        }

        if scope["method"] == "OPTIONS" and "access-control-request-method" in headers:
            preflight = {}
            if allowed:
                preflight = {
                    **cors,
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS" if public
                    else "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": headers.get("access-control-request-headers", "content-type"),
                    "Access-Control-Max-Age": "600",
                }
            await Response(status_code=204, headers=preflight)(scope, receive, send)
            return

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start" and allowed:
                response_headers = MutableHeaders(scope=message)
                for key, value in cors.items():
                    response_headers[key] = value
            await send(message)

        await self.app(scope, receive, send_with_cors)
