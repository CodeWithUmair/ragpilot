"""The deployed commit, so a deploy can be verified via GET /version."""

from datetime import UTC, datetime
from pathlib import Path

from app.core.config import get_settings


def _read_sha() -> str:
    if sha := (get_settings().git_sha or "").strip():
        return sha
    for path in (Path.cwd() / "VERSION", Path(__file__).resolve().parents[2] / "VERSION"):
        try:
            if sha := path.read_text().strip():
                return sha
        except OSError:
            continue
    return "unknown"


GIT_SHA = _read_sha()
SHORT_SHA = GIT_SHA[:7]
STARTED_AT = datetime.now(UTC).isoformat()
