"""app.rag.dash_filter — strips em/en dashes and "--" from a streamed chat
answer (2026-09-29: Umair flagged the em dash as the #1 tell of AI-generated
text and wants it gone everywhere, including mid-stream)."""

from app.rag.dash_filter import DashFilter


def run(chunks: list[str]) -> str:
    f = DashFilter()
    out = "".join(f.feed(c) for c in chunks)
    return out + f.flush()


def test_em_dash_is_removed():
    out = run(["hello — world"])
    assert "—" not in out
    assert "hello" in out and "world" in out


def test_em_dash_between_words_reads_naturally():
    out = run(["We don't offer that — try our other plan"])
    assert "—" not in out
    assert "We don't offer that" in out and "try our other plan" in out


def test_double_hyphen_split_across_two_chunks_is_still_caught():
    # The exact case a naive per-chunk regex would miss: chunk boundary falls
    # between the two hyphens.
    out = run(["word-", "- next"])
    assert "--" not in out
    assert "—" not in out


def test_literal_double_hyphen_in_one_chunk():
    out = run(["price is $10--$20 range"])
    assert "--" not in out
    assert "$10-$20" in out or "$10, $20" in out


def test_digit_before_dash_uses_a_plain_hyphen_not_a_comma():
    out = run(["2020–2024"])
    assert out == "2020-2024"


def test_single_hyphen_words_pass_through_unchanged():
    # Must not treat every "-" as a pending double-hyphen and mangle normal words.
    out = run(["a well-known, re-embed friendly answer"])
    assert out == "a well-known, re-embed friendly answer"


def test_flush_releases_a_trailing_single_hyphen():
    f = DashFilter()
    assert f.feed("well-known") == "well-know"  # last char always held back
    assert f.flush() == "n"


def test_empty_chunks_are_safe():
    assert run(["", "hello", ""]) == "hello"
