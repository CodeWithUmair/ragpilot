# Agent vision — design spec (proposed, not yet decided)

Status: **draft for review**. Nothing in this document is implemented or
decided. It exists so the trade-offs are visible before any code changes —
once pieces of it are approved, they become entries in `DECISIONS.md` and
line items in `ROADMAP.md`, and this file can be trimmed to a pointer.

## The goal

Today RagPilot answers questions when asked (crawl → embed → retrieve →
answer). The direction: make it behave more like a salesperson —
qualify visitor intent, tier leads by how likely they are to convert, and
(eventually) let the agent take actions rather than only produce text.
Rationale: a grounded Q&A bot is table stakes next to competitors; an agent
that qualifies and acts is the differentiator.

This is deliberately split into three phases of very different cost and risk.
**Do not build phase 2 before phase 1 ships, or phase 3 before phase 2** —
each phase's recommendation below depends on the previous one being live and
observed for a while first.

## Current state (what already exists, so the phases below are diffs, not rewrites)

| Piece | File | Relevant to |
|---|---|---|
| `capture_lead` graph node — silent capture of volunteered contact info, form only on detected intent after ≥1 turn | `rag/graph.py:170` | Phase 1 |
| `detect_lead_intent` — regex intent detector (pricing/buy/book/etc.) | `lib/lead_config.py:56` | Phase 1 |
| `Lead.status` enum: `NEW / CONTACTED / ARCHIVED` — a **workflow** state, not a priority signal | `db/models.py:63,225` | Phase 1 (don't overload this) |
| Lead forwarding: email / webhook / Google Sheet, SSRF-guarded | `services/leads.py`, `lib/net.py` | Phase 1, Phase 3 |
| `Chatbot.welcomeMessage` — a **static string**, rendered client-side, never touches the graph or an LLM call | `ChatWidget.tsx:512,632` | Phase 2 |
| `ChatDeps` / `ChatState` — the graph's per-request context and state shape | `rag/graph.py:52-86` | all phases |
| D8: heuristics preferred over an LLM classifier per-message (cost/latency); "upgrade path: LLM classifier node if precision ever demands it" | `DECISIONS.md` D8 | Phase 1 |
| D12/D13: SSE streaming, training runs in-request | `DECISIONS.md` D12-13 | Phase 3 (precedent for keeping v1 simple) |

## Phase 1 — Lead tiering (recommended first)

**What:** classify each lead into a priority tier (proposed: `COLD / WARM / HOT`
— "gold" mentioned once, folding into `HOT` unless you want a 4th tier;
confirm naming before building) and surface it everywhere leads already show up:
dashboard table, CSV export, forwarded payload (email/webhook/sheet).

**Why first:** reuses `capture_lead` and `services/leads.py` as-is, needs no
new external integration, and — per D8 — can start as a pure heuristic with
zero added LLM cost or latency per message.

**Design:**
- New column, not an overload of `Lead.status` (that's workflow: has the
  owner followed up — orthogonal to how promising the lead is). Add
  `Lead.priority` enum `COLD/WARM/HOT`, default `COLD`, idempotent Alembic
  migration per D6.
- Scoring heuristic (v1, no LLM call): weight already-known signals —
  `detect_lead_intent` hit, urgency words ("asap", "today", "budget",
  "this week"), a volunteered contact handle same-turn, message count before
  intent fired (faster qualification = hotter). Compute in `capture_lead`
  alongside the existing intent check, store on `Lead.priority`.
- **Rejected for v1:** an LLM classifier node scoring every message —
  doubles the per-message LLM cost for a signal the regex heuristic likely
  gets right most of the time. Revisit only if the heuristic's precision
  proves insufficient in practice (same upgrade path D8 already names).
- API contract: `priority` is an **additive** field on the `Lead` shape
  (Hard Rule #1 — update `API_CONTRACT.md` and the frontend leads table in
  the same change).

## Phase 2 — Proactive engagement (decided 2026-09-28)

**What:** the agent opens with a qualifying question instead of a static
greeting. Confirmed as wanted — Umair described this as the agent acting
like an intelligent human, not just answering when asked.

Three options were on the table, in increasing cost/adaptiveness: (1) the
owner writes their own qualifying opener — `welcomeMessage` already exists,
this is a dashboard copy/placeholder change only, zero new backend logic;
(2) auto-generate a persona-aware default from `systemPrompt`/business name,
computed once (still zero per-visitor cost, but real logic to write); (3) an
LLM-generated opener per session (adaptive, but a real cost/latency line
item on every widget open, including bounces).

**Decided: (1).** Ships as a dashboard-only change — better placeholder/
guidance text on the `welcomeMessage` field nudging owners toward a
qualifying question, no backend or graph change. Revisit (2) only if owners'
openers are consistently weak in practice; (3) is not worth it unless (2)
also proves insufficient.

**Explicitly NOT this phase:** anything that calls an LLM or performs an
action when the widget opens — that's Phase 3 territory. Proactive
engagement and tool-calling are two different phases; conflating them is
what caused the mid-scoping confusion on 2026-09-28 — worth keeping distinct
going forward.

## Phase 3 — Tool-calling / actions (defer until 1 and 2 are live)

Expanded 2026-09-28 with Umair's fuller description. He's right that the full
version — per-vertical training (e-commerce/legal/healthcare/etc.), real
transactional actions (add-to-cart, calendar booking, updating an owner's
spreadsheet mid-conversation) — is hard and should not be built in one shot
("focus on the single stuff first, that can be easy"). It splits into three
sub-pieces of very different cost, not one:

### 3a. Multi-channel lead notifications — NOT tool-calling, an extension of Phase 1

He wants a query/lead to reach the site owner on Slack, WhatsApp, Discord,
Telegram, or a spreadsheet — owner picks which. This is not agentic at all:
`services/leads.py` already forwards a captured lead to email/webhook/Google
Sheet (`forward_lead`). Slack (incoming webhooks), Discord (webhooks), and
Telegram (`sendMessage` via bot token) are the **same webhook-shaped
pattern** — new destination types in `lead_config.py` alongside
`webhookUrl`/`sheetUrl`, reusing `lib/net.safe_client`. This can be built as
a Phase 1 follow-up, independent of anything else in this document. **WhatsApp
is the one genuinely different one** — no plain webhook exists; it needs the
WhatsApp Business API or a provider like Twilio, with its own auth/session
model. Treat it separately from the other three.

### 3b. "Here's the link" — NOT full tool-calling either

His own example: visitor says "I need to order this," agent replies with the
checkout/product link. This needs **no tool execution, no external API call,
no confirm-before-claiming-success guardrail** — `retrieve` already surfaces
matched page URLs as `sources`. The change is in `generate`'s prompt: when
order/purchase intent is detected and a matched source looks like a
product/checkout page, tell the visitor to use that link instead of just
answering descriptively. Much closer to a Phase 2 follow-up than real Phase 3
— worth building before real tool-calling, as the "single stuff" v1.

### 3c. Real tool-calling — add-to-cart, calendar booking, spreadsheet write-back

Add-to-cart, calendar booking (e.g. Google Calendar/Meet), writing back to an
owner's spreadsheet mid-conversation. This is the actually-hard,
actually-deferred piece — everything below already applies to this
sub-piece specifically.

**Why last:** this is the one phase where a mistake — the model saying
"you're booked!" when nothing actually happened — damages the client's
actual business, not just the chat quality. It also meaningfully changes the
cost and risk profile of every conversation it touches. Per-vertical training
(e-commerce vs. legal vs. healthcare) mostly falls out of this: it's about
what tools are configured and allow-listed per chatbot, not a different
retrieval/graph pipeline per industry.

**Design constraints, not yet a build plan:**
- New graph node(s) using function/tool calling; the **tool executes
  server-side** and its real result is fed back to the model before it tells
  the visitor anything succeeded — never let the model narrate an outcome it
  didn't get confirmation for.
- Tools are **owner-configured, allow-listed, not arbitrary** — same shape as
  the existing `webhookUrl`/`sheetUrl` pattern in `lead_config.py`: the owner
  pastes an endpoint (e.g. a Calendly/booking webhook, a Google Calendar
  integration, an Excel/Sheets write-back endpoint), the agent can only call
  what's configured. No open-ended code execution, no calling arbitrary URLs
  the visitor supplies.
- Reuse `lib/net.safe_client` (SSRF guard) for any tool that hits an
  owner-supplied URL — do not build a second fetch path.
- **Prerequisite, not optional:** the LLM call-log table already on
  `ROADMAP.md` ("Then" section) should exist *before* this ships. Debugging
  a wrongly-fired action with no record of what the model was told, what
  tool it called, and what came back is materially harder than debugging a
  bad chat answer — and this is the phase where that debugging will matter.
- Plan-gating (e.g. Pro-only): Umair said don't worry about subscription
  tiers yet, build the full feature pack — noted, but the *cost/abuse*
  containment reason for gating still stands independent of monetization.
  Revisit whether it's a plan gate or a feature flag once 3a/3b are live.

## Scaling & cost, explicitly (the question you flagged yourself)

| Phase | Extra LLM calls per message | New tenant-isolation risk | New external risk |
|---|---|---|---|
| 1 — tiering | none (heuristic) | none — same `Lead` row, already namespace-scoped | none |
| 2 — proactive (templated) | none | none | none |
| 2b — proactive (LLM opener) | +1 per session (not per message) | none | none |
| 3 — tool-calling | +1-2 per action-taking turn | none new if scoped to existing lead/webhook tables | **yes** — owner-configured endpoints need the SSRF guard reused, and a hallucinated action is a new failure class entirely (not just a bad answer) |

Existing `messageUsage`/`messageLimit` plan-gating already exists per-owner
(`docs/ARCHITECTURE.md#5`) — phase 3 is the first place where a single
"message" might cost meaningfully more than one completion, worth revisiting
the limit math when you get there rather than assuming 1 turn = 1 unit still holds.

## Explicit non-goals for v1

- No multi-agent framework — one graph, more nodes, same pattern already in
  `rag/graph.py` (consistent with D7's "only where it earns its place").
- No autonomous actions without an owner-configured allow-list.
- No LLM-per-message intent/tier classifier until the heuristic is proven
  insufficient.
- No arbitrary code execution or arbitrary-URL tool calls from the model.

## Open decisions before any implementation starts

1. Exact tier taxonomy and thresholds — `COLD/WARM/HOT` (3-tier) or does
   "gold" need its own tier above hot?
2. Which plan(s) get proactive engagement and tool-calling — all tenants or
   Pro-only?
3. What's the first real action to build in Phase 3, and what's its actual
   backend (a Calendly webhook? Google Calendar API? something else)? This
   determines a lot of the tool-calling design and shouldn't be abstract.
4. Does the LLM call-log table (already on the roadmap) get pulled forward
   ahead of Phase 3, given it's called out above as a prerequisite?

Once these are answered, promote the relevant phase's design into a numbered
`DECISIONS.md` entry (matching the existing D1-D16 style) and move the phase
out of "proposed" into `ROADMAP.md`'s active section.
