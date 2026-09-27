"""app.lib.plans — spec: dl-chat-rag/backend/src/lib/plans.ts."""

import pytest

from app.lib.plans import PLANS, get_plan, normalize_plan_key


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("free", "free"),
        ("pro", "pro"),
        # legacy 4-tier keys so old user rows still resolve
        ("starter", "free"),
        ("growth", "pro"),
        ("scale", "pro"),
        # anything else falls back to free
        (None, "free"),
        ("", "free"),
        ("enterprise", "free"),
        ("PRO", "free"),
    ],
)
def test_normalize_plan_key(key, expected):
    assert normalize_plan_key(key) == expected


def test_get_plan_resolves_legacy_key():
    assert get_plan("growth") is PLANS["pro"]
    assert get_plan(None)["messageLimit"] == 100


def test_plan_limits_and_features():
    assert (PLANS["free"]["chatbotLimit"], PLANS["free"]["messageLimit"]) == (1, 100)
    assert (PLANS["pro"]["chatbotLimit"], PLANS["pro"]["messageLimit"], PLANS["pro"]["price"]) == (3, 2000, 29)
    assert PLANS["free"]["features"]["leadCapture"] is False
    assert all(PLANS["pro"]["features"].values())
    assert set(PLANS["free"]["features"]) == set(PLANS["pro"]["features"])
    for key, plan in PLANS.items():
        assert plan["key"] == key
