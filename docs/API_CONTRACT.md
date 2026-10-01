# API contract

The frontend (`frontend/src/hooks/useApi.ts`, `useChatStream.ts`,
`useScrapeStream.ts`, `components/chat/ChatWidget.tsx`, `lib/auth-client.ts`)
depends on everything below. Treat it as a public API: additive changes only,
unless you change the frontend in the same commit.

Conventions: JSON is camelCase; timestamps are ISO-8601 UTC; errors are
`{"error": str, "message": str, "code": str|null}` with a meaningful HTTP status
(validation errors are **400**, not 422, except `USER_ALREADY_EXISTS…` which is 422).
Auth: `Authorization: Bearer <signed session token>`. Interactive docs: `/docs`.

## Auth (Better Auth wire protocol)

| Method & path | Body / query | Response |
|---|---|---|
| POST `/api/auth/sign-up/email` | `{email, password, name, callbackURL?}` | `{token, user}` + header `set-auth-token` (token `null` when verification is required). 400 `INVALID_EMAIL`/`PASSWORD_TOO_SHORT`, 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` |
| POST `/api/auth/sign-in/email` | `{email, password, callbackURL?}` | `{redirect:false, token, url:null, user}` + `set-auth-token`. 401 `INVALID_EMAIL_OR_PASSWORD`, 403 `EMAIL_NOT_VERIFIED` (a fresh link is emailed) |
| GET `/api/auth/get-session` | — | `{session, user}` or JSON `null` |
| POST `/api/auth/sign-out` | — | `{success:true}` |
| POST `/api/auth/send-verification-email` | `{email, callbackURL?}` | `{status:true}` (same answer whether or not the account exists) |
| GET `/api/auth/verify-email` | `?token&callbackURL` | 302 to callbackURL (or `?error=invalid_token`) |
| GET `/api/login/google` | — | 302 to Google |
| GET `/api/auth/callback/google` | `?code&state` | 302 to `APP_URL/auth/callback#token=…` or `#error=…` |

`user` = `{id, name, email, emailVerified, image, createdAt, updatedAt, plan, messageUsage, messageLimit}`.

## Public (widget) — any origin

### `POST /api/chat` (also `GET` with query params) → `text/event-stream`
Body: `{question, token, url?, sessionId?, visitorId?, hostPageUrl?, history?: [{question, answer}]}`
(400 if question empty or neither token nor url.)

Events, in order:

| event | data | when |
|---|---|---|
| `sources` | `{sources: [{url, title, type, score}]}` | first |
| `delta` | `{content: "…"}` | many; the widget appends `content` |
| `lead` | `{heading, fields, required, successMessage}` | optional, after the answer — widget shows the lead form |
| `done` | `{sessionId, namespace, sources, limitExceeded?}` | last on success |
| `error` | `{error}` | last on failure |

Frames are `event: X\ndata: <single-line JSON>\n\n`.

| Method & path | Response |
|---|---|
| GET `/api/chat/history/{sessionId}?limit=50` | `{messages: [{id, sessionId, namespace, question, answer, createdAt}]}` |
| GET `/api/chat/conversations?token&visitorId&limit=20` | `{conversations: [{sessionId, title, preview, messageCount, startedAt, lastActivityAt}]}` — only that visitor's threads |
| GET `/api/chatbots/public/{embedToken}` | `{chatbot: {id, name, welcomeMessage, themeColor, primaryColor, isTrained, status, embedToken, widgetTheme, widgetWidth, widgetHeight, logoUrl, headerColor, botAvatar, inputPlaceholder, showPoweredBy, leadConfig: {enabled, fields, required, heading, successMessage}}}` |
| POST `/api/leads` | body `{token, sessionId?, visitorId?, name?, email?, phone?, company?, message?, hostPageUrl?, fields?}` → 201 `{success, leadId}` or 200 `{success, leadId, deduped:true}`; 400 without email/phone |

## Protected (dashboard) — strict CORS, bearer auth

| Method & path | Response |
|---|---|
| GET `/api/users/me` | `{user: {id, email, name, plan, messageUsage, messageLimit, chatbotCount, isAdmin, onboardingCompleted, planDetails}}` |
| PATCH `/api/users/me` `{name}` | `{user}` |
| POST `/api/users/complete-onboarding` | `{success}` |
| POST `/api/users/me/plan` `{plan}` | dev only (403 in production) |
| GET `/api/plans` | `{plans: {free, pro}}` (shape in `lib/plans.py`) |
| GET `/api/chatbots` | `{chatbots: [Chatbot]}` |
| POST `/api/chatbots` `{url, name?, …widget fields}` | 201 `{chatbot, embedToken}`; 402 over plan limit; re-posting an existing URL returns it |
| GET `/api/chatbots/{id}` | `{chatbot, vectorCount}` |
| PATCH `/api/chatbots/{id}` | `{chatbot}` (empty `name`/`status` ignored; unknown keys ignored) |
| DELETE `/api/chatbots/{id}` | `{success}` (also deletes its vectors) |
| POST `/api/chatbots/{id}/categories` `{categories: [{name, pages, enabled, indexed}], isTrained?, lastTrainedAt?}` | `{chatbot}` |
| POST `/api/chatbots/{id}/reset-knowledge` | `{success}` |
| GET `/api/chatbots/{id}/leads?page&limit&status&priority` | `{leads, total, newCount, page, limit}` |
| PATCH `/api/chatbots/{id}/leads/{leadId}` `{status}` | `{lead}` |
| GET `/api/chatbots/{id}/leads/export` | CSV download |
| POST `/api/chatbots/{id}/leads/test-forward` `{destination: email\|webhook\|sheet\|slack\|discord\|telegram, url?}` | 200 `{ok:true}` / 502 `{ok:false, error}` — telegram ignores `url` and uses the saved bot token/chat ID |
| GET `/api/sessions/{namespace}?page&limit` | `{sessions: [{id, sessionId, visitorId, firstQuestion, messageCount, status, startedAt, lastActivityAt, hostPageUrl}], total, page, limit}` |
| GET `/api/analytics?chatbotId=all|<id>&from=YYYY-MM-DD&to=YYYY-MM-DD` | `{range, totals{conversations, messages, leads, visitors, conversionRate}, previous, series[{date, conversations, messages, leads}], hourly[{hour, messages}], leadStatus, topQuestions, topPages, bots}` |
| GET `/api/admin/users?search&page&limit` | admin only: `{users: [{…, createdAt, chatbotCount}], total, page, limit}` |
| PATCH `/api/admin/users/{id}/plan` `{plan}` | admin |
| POST `/api/admin/users/{id}/reset-usage` | admin |
| GET `/api/admin/plans` | admin: `{plans: {free, pro}}` with admin-edited limits applied (`messageLimit`, `chatbotLimit`, `pageLimit`) |
| PUT `/api/admin/plans/{plan}/limits` `{messageLimit, chatbotLimit, pageLimit}` | admin: all three required ints ≥ 1; applies to every user on the plan at once. Stored in `"PlanLimit"` (no row = defaults in `lib/plans.py`) |

`Chatbot` = `{id, name, url, embedToken, status, isTrained, lastTrainedAt, systemPrompt, personalityType, welcomeMessage, themeColor, userId, widgetTheme, widgetWidth, widgetHeight, logoUrl, primaryColor, headerColor, botAvatar, inputPlaceholder, showPoweredBy, leadConfig, createdAt, updatedAt, categories: [{id, chatbotId, name, pages, enabled, indexed}]}`

### Training
- `GET /api/scrape?url=<chatbot url>` → discovery JSON:
  `{message, namespace, totals{sitemap, crawled, unique}, categories: [{name, pages, urls, enabled}]}`; 404 if no chatbot for that URL.
- `GET /api/scrape?url&categories=a,b&urls=u1,u2` → SSE:
  `phase {phase, message}` → `crawl-done {totalPages, totalDiscovered}` → per page
  `page-start {current, total, url, category}` then `page-done {current, total, url, chunks, ms, recordsStored, skipped?}` or `page-error {current, total, url, error}` → `done {success, namespace, pagesIndexed, recordsStored}` | `error {error}`.
  The frontend's watchdog gives up after 45 s without any event.
- `POST /api/scrape/file` multipart `namespace`, `file` → `{success, recordsStored}` (413/415/422 on bad files).
- `POST /api/scrape/text` `{namespace, text, source?}` → `{success, recordsStored}`.

## System & dev
- `GET /health` → `{status:"ok", env, sha}`; `GET /version` → `{sha, shortSha, startedAt, env}`.
- Dev only (404 in production): `POST/DELETE /api/__test/seed-user`, `POST /api/__test/seed-conversation`,
  `POST /api/__test/seed-analytics`, `GET /api/__test/emails?to=` — used by Playwright.
