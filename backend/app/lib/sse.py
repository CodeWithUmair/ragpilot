"""Server-Sent Events framing shared by chat + training streams."""

import json
from typing import Any

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # nginx: don't buffer the stream
}
SSE_MEDIA_TYPE = "text/event-stream; charset=utf-8"


def sse(event: str, data: Any) -> str:
    """One frame. JSON is single-line, so clients can split frames on blank lines."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"
