"""app.ingest.crawler.to_canonical: www/apex variants collapse onto one origin."""

import pytest

from app.ingest.crawler import to_canonical

ORIGIN = "https://umairamir.com"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.umairamir.com/about", "https://umairamir.com/about"),
        ("https://umairamir.com/about/", "https://umairamir.com/about"),
        ("http://www.umairamir.com", "https://umairamir.com"),
        ("https://umairamir.com/blog#top", "https://umairamir.com/blog"),
        ("https://other.com/about", None),
        ("https://blog.umairamir.com/about", None),
    ],
)
def test_to_canonical(url, expected):
    assert to_canonical(url, ORIGIN) == expected


def test_canonical_www_origin():
    assert to_canonical("https://umairamir.com/about", "https://www.umairamir.com") == "https://www.umairamir.com/about"
