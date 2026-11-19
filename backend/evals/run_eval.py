"""Answer-quality eval: run the real chat graph over a fixed question set and score it.

    uv run python -m evals.run_eval --ingest      # crawl + index the site first (once)
    uv run python -m evals.run_eval               # re-run against the indexed namespace

Measures, per run (saved to evals/runs/<utc>.json):
  * accuracy     LLM judge vs. hand-written expected answers (correct=1, partial=0.5)
  * hallucination  judge flags facts/prices/promises not in the expected answer
  * retrieval hit  an expected source page made it into the model's context
  * citation hit   an expected source page was returned to the visitor as a source
  * latency        time to first token and total, p50 / p95
  * cost           bot tokens only (the judge is excluded), per 100 questions

The graph, retrieval constants, prompts and models are exactly what /api/chat
uses; only the lead store is off (no visitor, no DB writes besides vectors).
"""

import argparse
import asyncio
import json
import os
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path

from openai import AsyncOpenAI

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.rag import retrieval
from app.rag.graph import ChatDeps, chat_graph
from app.rag.providers import OpenAIChatModel, OpenAIEmbedder
from app.rag.vector_store import PgVectorStore

HERE = Path(__file__).parent
NAMESPACE = "eval-decryptedlabs"
VERDICT_SCORE = {"correct": 1.0, "partial": 0.5, "incorrect": 0.0}
# USD per 1M tokens (OpenAI list prices). ponytail: hardcoded, update if models/prices change.
PRICES = {
    "gpt-4o-mini": (0.15, 0.60),
    "text-embedding-3-small": (0.02, 0.0),
}

JUDGE_SYSTEM = """You grade a website support chatbot. You get the visitor question, the EXPECTED answer
written from the website, and the BOT answer.

verdict:
- "correct": the bot answer gives the expected facts (wording can differ; extra true detail is fine).
  For an expected answer starting "SHOULD DECLINE" / "SHOULD SAY NO": correct means the bot clearly says it
  doesn't have that / doesn't offer it, and does not invent anything.
- "partial": some expected facts are present but important ones are missing, or it hedges when the answer was available.
- "incorrect": wrong facts, says it doesn't know when the expected answer exists, or answers a SHOULD DECLINE item.

hallucinated: true if the bot states any specific fact, number, price, name, timeline or promise that is supported by
NEITHER the expected answer NOR the CONTEXT the bot was given (the website excerpts). True details from the CONTEXT
are not hallucinations. General offers to contact the team do not count.

Reply with JSON only: {"verdict": "...", "hallucinated": true|false, "reason": "one short sentence"}"""


class Meter:
    """Counts tokens on an AsyncOpenAI client by wrapping its two create() calls."""

    def __init__(self, client: AsyncOpenAI):
        self.usage: dict[str, list[int]] = {}
        chat, emb = client.chat.completions.create, client.embeddings.create

        async def metered_chat(**kw):
            if not kw.get("stream"):
                res = await chat(**kw)
                self._add(kw["model"], res.usage)
                return res
            stream = await chat(**kw, stream_options={"include_usage": True})

            async def passthrough():
                async for chunk in stream:
                    if chunk.usage:  # final chunk, empty choices: the graph ignores it
                        self._add(kw["model"], chunk.usage)
                    yield chunk

            return passthrough()

        async def metered_emb(**kw):
            res = await emb(**kw)
            self._add(kw["model"], res.usage)
            return res

        client.chat.completions.create = metered_chat
        client.embeddings.create = metered_emb

    def _add(self, model: str, usage) -> None:
        total = self.usage.setdefault(model, [0, 0])  # [input, output]
        total[0] += usage.prompt_tokens
        total[1] += getattr(usage, "completion_tokens", 0) or 0  # embeddings have none

    def cost(self) -> float:
        return sum(PRICES.get(m, (0, 0))[0] * i / 1e6 + PRICES.get(m, (0, 0))[1] * o / 1e6
                   for m, (i, o) in self.usage.items())


async def ingest(site: str) -> None:
    from app.api.scrape import _index_stream
    from app.ingest import crawler

    sitemap, crawled = await crawler.discover(site, 50)
    urls = list(dict.fromkeys([*sitemap, *crawled]))[:50]
    async with SessionLocal() as db:
        await PgVectorStore(db).delete_namespace(NAMESPACE)
        await db.commit()
    async for event in _index_stream(None, site, NAMESPACE, ["all"], urls, 50):
        if event.startswith(("event: done", "event: error")):
            print(event.strip())


async def ask(deps: ChatDeps, item: dict) -> dict:
    t0 = time.perf_counter()
    first = None
    state: dict = {}
    async for mode, chunk in chat_graph.astream(
        {"question": item["question"], "history": item.get("history", [])},
        {"configurable": {"deps": deps}},
        stream_mode=["custom", "values"],
    ):
        if mode == "custom" and chunk["event"] == "delta" and first is None:
            first = time.perf_counter() - t0
        elif mode == "values":
            state = chunk
    return {
        "answer": state.get("answer", ""),
        "context": retrieval.build_context(state.get("matches", [])),  # for the judge; not saved
        "context_sources": sorted({m.source for m in state.get("matches", []) if m.source}),
        "cited_sources": [s["url"] for s in state.get("sources", [])],
        "rewrites": state.get("rewrites", 0),
        "ttft_s": round(first or 0.0, 3),
        "total_s": round(time.perf_counter() - t0, 3),
    }


async def judge(client: AsyncOpenAI, model: str, item: dict, answer: str, context: str) -> dict:
    res = await client.chat.completions.create(
        model=model, temperature=0, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": JUDGE_SYSTEM},
                  {"role": "user", "content": f"Question: {item['question']}\n\nEXPECTED: {item['expected']}"
                                              f"\n\nCONTEXT:\n{context or '(none)'}\n\nBOT: {answer}"}],
    )
    out = json.loads(res.choices[0].message.content)
    return {"verdict": out.get("verdict", "incorrect"), "hallucinated": bool(out.get("hallucinated")),
            "reason": out.get("reason", "")}


def hit(expected: list[str], urls: list[str]) -> bool | None:
    """None when the item names no source (stated site-wide, or a decline)."""
    return any(e in u for e in expected for u in urls) if expected else None


def pct(values: list[float], p: int) -> float:
    if len(values) < 2:
        return values[0] if values else 0.0
    return round(statistics.quantiles(values, n=100, method="inclusive")[p - 1], 2)


def accuracy(rows: list[dict]) -> float:
    return round(sum(VERDICT_SCORE[r["verdict"]] for r in rows) / len(rows), 3)


def summarize(results: list[dict], cost_usd: float) -> dict:
    def rate(rows, key):
        vals = [r[key] for r in rows if r[key] is not None]
        return round(sum(vals) / len(vals), 3) if vals else None

    by_kind = {}
    for kind in sorted({r["kind"] for r in results}):
        rows = [r for r in results if r["kind"] == kind]
        by_kind[kind] = {"n": len(rows), "accuracy": accuracy(rows)}
    n = len(results)
    return {
        "n": n,
        "accuracy": accuracy(results),
        "fully_correct": sum(r["verdict"] == "correct" for r in results),
        "hallucination_rate": round(sum(r["hallucinated"] for r in results) / n, 3),
        "retrieval_hit_rate": rate(results, "retrieval_hit"),
        "citation_hit_rate": rate(results, "citation_hit"),
        "rewrites_used": sum(r["rewrites"] for r in results),
        "ttft_p50_s": pct([r["ttft_s"] for r in results], 50),
        "ttft_p95_s": pct([r["ttft_s"] for r in results], 95),
        "total_p50_s": pct([r["total_s"] for r in results], 50),
        "total_p95_s": pct([r["total_s"] for r in results], 95),
        "cost_usd": round(cost_usd, 5),
        "cost_per_100_usd": round(cost_usd / n * 100, 4),
        "by_kind": by_kind,
    }


async def run_eval(args: argparse.Namespace, data: dict) -> dict:
    if args.ingest:
        await ingest(data["site"])

    s = get_settings()
    bot_client = AsyncOpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url, timeout=60)
    meter = Meter(bot_client)
    judge_client = AsyncOpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url, timeout=60)

    results = []
    async with SessionLocal() as db:
        store = PgVectorStore(db)
        if not await store.count(NAMESPACE):
            raise SystemExit(f"namespace {NAMESPACE} is empty: run with --ingest first")
        deps = ChatDeps(llm=OpenAIChatModel(bot_client), embedder=OpenAIEmbedder(bot_client), store=store,
                        namespace=NAMESPACE, business_name=data["business_name"])
        for item in data["items"]:  # sequential on purpose: latency numbers stay honest
            out = await ask(deps, item)
            context = out.pop("context")
            grade = await judge(judge_client, args.judge_model, item, out["answer"], context)
            row = {"id": item["id"], "kind": item["kind"], "question": item["question"], **out, **grade,
                   "retrieval_hit": hit(item["sources"], out["context_sources"]),
                   "citation_hit": hit(item["sources"], out["cited_sources"])}
            results.append(row)
            print(f"{row['id']:4} {row['verdict']:9} {'HALLUC ' if row['hallucinated'] else ''}"
                  f"{row['total_s']:5.1f}s  {item['question']}")

    return {
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "config": {"chat_model": s.openai_chat_model, "embed_model": s.openai_embed_model,
                   "judge_model": args.judge_model, "namespace": NAMESPACE, "dataset": Path(args.dataset).name,
                   "retrieval": {k: getattr(retrieval, k) for k in (
                       "RETRIEVAL_POOL", "CONTEXT_CHUNKS", "MIN_RAW_SCORE", "RELATIVE_SCORE_MARGIN",
                       "CONFIDENT_SCORE", "SOURCE_MIN_SCORE")}},
        "tokens": meter.usage,
        "summary": summarize(results, meter.cost()),
        "results": results,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=str(HERE / "decryptedlabs.json"))
    ap.add_argument("--ingest", action="store_true", help="crawl + re-index the site first")
    ap.add_argument("--judge-model", default=os.getenv("EVAL_JUDGE_MODEL", "gpt-4.1"))
    args = ap.parse_args()
    data = json.loads(Path(args.dataset).read_text(encoding="utf-8"))
    run = asyncio.run(run_eval(args, data))
    out_dir = HERE / "runs"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"{run['at'].replace(':', '').replace('+0000', 'Z')}.json"
    path.write_text(json.dumps(run, indent=2), encoding="utf-8")
    print(json.dumps(run["summary"], indent=2))
    print(f"saved {path}")


if __name__ == "__main__":
    main()
