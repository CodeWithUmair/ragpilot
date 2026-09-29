# History

## Origin

RagPilot started as **RagBot**, a Chatbase-style product the owner built with an
Express.js + Prisma backend and a Next.js frontend (roughly April–June 2026). That
codebase is kept locally at `D:\mine\dl-chat-rag` for reference only.

What the Express version already had (and this repo preserves):
- Website crawler (sitemap + BFS), heading-aware chunking, OpenAI embeddings in pgvector
- Streaming chat with grounding guardrails
- Multi-conversation widget (Home / Messages), visitor ids, conversation history
- Lead capture: intent trigger, widget form, owner email, webhook + Google Sheet forwarding
- Analytics dashboard, plans (Free/Pro), admin panel, onboarding, email verification (Resend/Gmail)

What it did **not** have, despite dependencies suggesting otherwise: LangChain and
LangGraph were installed but unused — `src/graph/chatbot.graph.ts` was an empty
`TODO: Phase 1B` file. The RAG pipeline was one hand-written linear function.

### Problems the Express version solved along the way (encoded in this code)
These fixes are preserved and documented at the constants that implement them:
- **Hallucination from context pollution** — footers/nav/404 text were indexed once per
  page and crowded out real answers → chrome stripping, boilerplate filter,
  content-hash dedupe, retrieval-time dedupe (`lib/text_clean.py`).
- **Off-topic answers** — pgvector always returns N rows → raw-score floor (0.18).
- **Adjacent-topic bleed** — "AI services" answered with blockchain offerings because
  both chunks contain "services" → relative score gate (0.22) + 3-step
  "direct match / don't offer / genuine alternative" prompt rule.
- **Robotic lead capture** — form on the first message; form asking for details just
  typed; "I'm interested in the AI service" parsed as the name "In The" → conservative
  extraction, qualify-first rule, silent capture of volunteered details.
- **Cross-tenant namespace collision** — tokens were hash(url) → random per chatbot.
- **Cross-domain auth** — third-party cookies blocked → bearer tokens + top-level OAuth.

## The port (2026-09-27)

Rebuilt the backend in FastAPI (see `DECISIONS.md` D1–D16). Beyond a faithful port:

| Change | Why |
|---|---|
| Chat flow as a LangGraph state machine with routing + bounded query-rewrite loop | follow-ups retrieved nothing; greetings wasted retrieval; testable decisions |
| Fixed: any signed-in user could list another tenant's conversations (`/api/sessions/:namespace`) | missing ownership check |
| Fixed: any signed-in user could write text/files into another tenant's knowledge base (`/api/scrape/file|text`) — a knowledge-poisoning / prompt-injection vector | missing ownership check |
| Added SSRF guard for crawler and lead webhooks | public server fetching user URLs |
| Restored the HNSW vector index | a Prisma `migrate dev` had dropped it → every search was a sequential scan |
| Batched vector upserts (`executemany`) instead of one INSERT per chunk | fewer round-trips |
| CPU-bound parsing moved off the event loop (`asyncio.to_thread`) | streaming stays responsive while parsing |
| Headings shorter than 20 chars now kept in heading paths ("Pricing") | better chunk context |
| Contact extraction edge cases: "my name is Sara. Email…", "Acme Corp, and I…", "(415) …" | wrong captured values |
| Production errors no longer leak exception text to the public widget | info disclosure |
| Timestamps emitted as timezone-aware UTC | browsers parsed naive ISO strings as local time |
| Rebrand RagBot → RagPilot; fixed the wizard's broken embed snippet (`cdn.ragbot.ai`) | branding; real bug |

## Security incident in the source repository (found 2026-09-27)

While preparing the port, the source repository was found to contain malware of
the "fake project / contagious interview" family:
- `.vscode/tasks.json` ran `node` on `…/public/fonts/fa-solid-900.woff2` (actually
  obfuscated JavaScript) on **folder open**, with `.vscode/settings.json` enabling
  `task.allowAutomaticTasks` and hiding the terminal.
- An obfuscated payload was appended (pushed off-screen with whitespace) to
  `frontend/postcss.config.mjs`, which runs on every `next dev`/`next build`.
- Introduced in two commits authored under the owner's work identity (May 13 and
  June 15, 2026). It was removed from the source repo and pushed (`b40f9bf`).
- This repo was created from the **cleaned** commit via `git archive` (tracked files
  only) and re-scanned; the frontend dependency tree was audited (no install hooks
  beyond sharp/msw/fsevents, all registry packages).

**Rules that follow from it:** never add `.vscode/tasks.json` or `folderOpen` tasks;
never copy files wholesale from the old repo; review diffs to config files
(`postcss.config.*`, `next.config.*`, `package.json` scripts) with the whitespace
visible; rotate any secret that existed on machines/CI that built the old frontend.

### Local clone located and forensically confirmed (2026-09-29)

The pre-port local clone of `github.com/decryptedlabs/dl-chat-rag` is at
**`C:\Users\Ali\Desktop\Umair\chatbase-clone`** on this dev machine — locally
renamed, not findable by searching for "dl-chat-rag" (confirmed via
`git remote -v`; the path was recovered from VS Code's own history database,
`AppData\Roaming\Code\User\globalStorage\state.vscdb`, after a filename
search turned up nothing). `docs/HANDOFF.md`'s old note that it lived at
`D:\mine\dl-chat-rag` was stale/wrong for this machine — corrected there.

Audited that local clone directly:
- **Current checked-out tree (HEAD `c39f86f`, 2026-06-15) is clean** — no
  `.vscode`/`tasks.json` anywhere on disk, `postcss.config.mjs` is the normal
  ~100-byte file, and a repo-wide scan for anomalously long/padded lines
  found nothing else.
- **But the malware IS present in this branch's git history**, not just a
  rumor: commit `6144e0e` ("verfication email changes", authored
  **2026-05-13 08:31:37 -0700** by `umairamir007 <umairamir@decryptedlabs.io>`
  — the owner's own identity, matching "introduced under the owner's work
  identity" above) has `frontend/postcss.config.mjs` at **5460 bytes** versus
  ~70-94 bytes in every neighboring commit. Confirmed `6144e0e` is an
  ancestor of this local clone's `main` (`git merge-base --is-ancestor`).
  Peeked at only the first/last ~150 characters (never executed or fully
  dumped it) — the tail is unmistakably obfuscated JS (mangled names,
  string-reassembly, wrapped in an IIFE).
- This local clone predates the cleanup: `b40f9bf` (the fix commit mentioned
  above) does not exist as an object in it at all — it simply stopped
  syncing before that fix, with later legitimate commits happening to
  overwrite the file back to normal.
- **Implication that generalizes beyond this one clone:** "removing" malware
  by pushing a fix commit does not erase it from git history — the poisoned
  commit stays reachable by SHA (`git show`, `git checkout`, `git blame`,
  GitHub's own commit-history view) unless someone does an actual history
  rewrite (`git filter-repo`/BFG + force-push). Whether `decryptedlabs/dl-chat-rag`
  on GitHub itself still has `6144e0e` reachable hasn't been checked from
  here — worth confirming if the goal is for it to be permanently gone, since
  anyone cloning or forking it would get the malicious commit too.

No changes were made to that local clone or its git state — read-only audit only.
