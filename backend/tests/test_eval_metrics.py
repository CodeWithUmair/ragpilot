from evals.run_eval import hit, pct, summarize


def _row(kind, verdict, halluc=False, rhit=None, chit=None, t=1.0):
    return {"kind": kind, "verdict": verdict, "hallucinated": halluc, "retrieval_hit": rhit,
            "citation_hit": chit, "rewrites": 0, "ttft_s": t / 2, "total_s": t}


def test_hit_matches_path_substring_and_skips_unscored():
    assert hit(["/case-studies/nfstay"], ["https://x.io/case-studies/nfstay-tokenizing"]) is True
    assert hit(["/about-us"], ["https://x.io/contact-us"]) is False
    assert hit([], ["https://x.io/anything"]) is None


def test_summarize_scores_partial_as_half_and_ignores_unscored_sources():
    rows = [
        _row("answerable", "correct", rhit=True, chit=True, t=1.0),
        _row("answerable", "partial", rhit=False, chit=False, t=2.0),
        _row("decline", "incorrect", halluc=True, t=3.0),
        _row("decline", "correct", t=4.0),
    ]
    s = summarize(rows, cost_usd=0.02)
    assert s["accuracy"] == 0.625  # (1 + 0.5 + 0 + 1) / 4
    assert s["fully_correct"] == 2
    assert s["hallucination_rate"] == 0.25
    assert s["retrieval_hit_rate"] == 0.5  # decline rows (None) excluded
    assert s["by_kind"]["answerable"]["accuracy"] == 0.75
    assert s["cost_per_100_usd"] == 0.5
    assert s["total_p50_s"] == 2.5


def test_pct_handles_tiny_samples():
    assert pct([], 95) == 0.0
    assert pct([1.5], 95) == 1.5
