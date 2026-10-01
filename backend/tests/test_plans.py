"""app.lib.plans — spec: dl-chat-rag/backend/src/lib/plans.ts."""

from types import SimpleNamespace

import pytest

from app.lib.plans import PLANS, feature_allowed, get_plan, normalize_plan_key, plan_for


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
    assert (PLANS["free"]["pageLimit"], PLANS["pro"]["pageLimit"]) == (50, 300)
    assert PLANS["free"]["features"]["leadCapture"] is False
    assert all(PLANS["pro"]["features"].values())
    assert set(PLANS["free"]["features"]) == set(PLANS["pro"]["features"])
    for key, plan in PLANS.items():
        assert plan["key"] == key


class _FakeDB:
    def __init__(self, row):
        self.row = row

    async def get(self, model, key):
        return self.row


async def test_plan_for_applies_admin_limits():
    row = SimpleNamespace(message_limit=5, chatbot_limit=6, page_limit=7)
    plan = await plan_for(_FakeDB(row), "pro")
    assert (plan["messageLimit"], plan["chatbotLimit"], plan["pageLimit"]) == (5, 6, 7)
    assert plan["label"] == "Pro"  # everything else still comes from the defaults
    assert await plan_for(_FakeDB(None), "pro") is PLANS["pro"]


async def test_feature_allowed_follows_the_plan():
    free, pro = _FakeDB(None), _FakeDB(None)
    assert not await feature_allowed(free, "free", "leadCapture")
    assert not await feature_allowed(free, "free", "removeBranding")
    assert await feature_allowed(pro, "pro", "leadCapture")
