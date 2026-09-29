"""Strips em dashes, en dashes, and "--" out of streamed chat answers.

The prompt already instructs the model not to use them (rag/prompts.py), but
that's a request, not a guarantee — this is the safety net so a visitor never
sees the "—" that gives generated text away (flagged 2026-09-29). Applied to
the live SSE token stream in rag/graph.py:generate, so it has to work one
chunk at a time without knowing what comes next.
"""

import re

_DASH_RUN = re.compile(r"-{2,}|[—–]")


def _sub(s: str) -> str:
    def repl(m: re.Match) -> str:
        before = s[m.start() - 1] if m.start() > 0 else ""
        return "-" if before.isdigit() else ", "

    return _DASH_RUN.sub(repl, s)


class DashFilter:
    """Feed it a stream of text chunks; it holds back exactly one trailing
    character per chunk (never more) so a "--" or a dash split across two
    chunks is still caught, then emits the cleaned text. Call flush() once
    the stream ends to release whatever's still held back."""

    def __init__(self) -> None:
        self._pending = ""

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        s = self._pending + chunk
        self._pending = s[-1]
        return _sub(s[:-1])

    def flush(self) -> str:
        out = _sub(self._pending)
        self._pending = ""
        return out
