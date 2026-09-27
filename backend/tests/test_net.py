"""app.lib.net.is_http_url."""

import pytest

from app.lib.net import is_http_url


@pytest.mark.parametrize(
    ("value", "ok"),
    [
        ("http://example.com", True),
        ("https://example.com/path?q=1#frag", True),
        ("https://sub.example.co.uk:8443", True),
        ("http://localhost:3000", True),  # syntax only; SSRF is ssrf_guard's job
        ("ftp://example.com", False),
        ("javascript:alert(1)", False),
        ("mailto:sara@example.com", False),
        ("example.com", False),
        ("//example.com", False),
        ("http://", False),
        ("https:///path", False),
        ("", False),
    ],
)
def test_is_http_url(value, ok):
    assert is_http_url(value) is ok
