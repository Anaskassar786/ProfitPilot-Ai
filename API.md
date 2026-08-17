# ProfitPilot API reference

All successful responses use `{ ok: true, data, meta }`; failures use a typed error envelope. Browser clients use relative URLs.

## Health and readiness

- `GET /live` — liveness; always exempt from maintenance mode.
- `GET /health` — API health response.
- `GET /ready` — PostgreSQL, Redis, OpenRouter, and Shopify dependency checks.
- `GET /security/csrf` — issue the CSRF double-submit token.

## Data plane

- `POST /sync` — run one sync module for a store. Send the current embedded
  `id_token` in `X-Shopify-Session-Token` so a missing/rejected offline token
  can be repaired with one token exchange and one retry.
- `GET /sync/status?storeId=` — connection diagnostics: `registered`,
  `hasAccessToken`, `canSync`, and the store's circuit state
  (`open`, `failures`, `retryAfterMs`, `cooldownMs`). Never returns the token.
- `POST /sync/circuit/reset` — close an open Shopify circuit for `{ storeId }`.
- `GET /analytics?storeId=` and `GET /catalog?storeId=`.

A `503 DEPENDENCY_ERROR` from `/sync` carries `details.reason`:
`SHOPIFY_CIRCUIT_OPEN` (retry after `retryAfterMs`, or reset) or
`SHOPIFY_TOKEN_MISSING` (hard refresh the embedded app).

## Inventory

- `GET /inventory?storeId=&q=&status=&category=&vendor=&locationId=&sort=&direction=&page=&limit=&lowStockThreshold=`
  — real Shopify stock rows, KPIs, health, distribution, and locked-feature
  metadata for the store's plan. `sort=days_of_cover` and the per-row
  `daysOfCover` field are Growth+; lower plans receive
  `{ status: 'locked', required_plan: 'growth' }` and never a computed value.
- `GET /inventory/locations?storeId=` — per-location totals and sync coverage.
- `GET /inventory/:variantId?storeId=` — one variant's stock detail.
- `GET /inventory/insights?storeId=&feature=` — plan-gated intelligence:
  `{ plan, available[], locked[], usage, salesHistory, coverage, cached }`.
  Growth unlocks dead stock, reorder recommendations, stock turnover, overstock
  alerts, the AI suggestion, days of cover, and stock history; Commander adds
  predictive restocking, seasonal trends, auto-reorder review, and custom
  queries. Results cache for five minutes and every locked access is written to
  `billing_audit`.
- `POST /inventory/insights/query` — `{ storeId, question }`, Commander only,
  20 questions per day. Product names, SKUs, ids, and emails are redacted before
  the model is called; only aggregate facts are sent.
- `GET /inventory/history?storeId=&days=7|30|90|365` — Growth+ daily snapshots
  from `inventory_snapshots_daily`, written by the inventory sync's completion
  hook. Returns an empty series with an explanatory message before the first
  sync rather than a synthesised curve.
- `POST /inventory/reorder-decision` — `{ storeId, productId, decision }`,
  Commander only. Records an `approved`/`dismissed` review in `billing_audit`.
  ProfitPilot never places a purchase order.

Every velocity-derived insight requires at least 30 days of sales history in
`analytics_product_sales_daily`. Below that the endpoints return
`{ status: 'insufficient_data', message }` explaining how many days are still
missing instead of an estimate.

## AI recommendations (PR #46)

All recommendation numbers are computed by deterministic rules over real synced
data; the optional AI layer only writes language and is validated against the
evidence. Generation is metered monthly per plan
(`ai_recommendations_month`: Trial 10, Start 30, Growth 150, Commander
unlimited — single source of truth in `packages/types/src/plans.ts`).

- `GET /ai/agents` — seven agent status contracts.
- `GET /ai/cost?storeId=` — daily AI spend against the per-store cap.
- `GET /recommendations?storeId=&status=&agent=&ruleId=&minImpact=&maxImpact=&dateFrom=&dateTo=&sort=impact|confidence|created|decided&direction=&cursor=&limit=`
  — paginated page envelope `{ items, total, cursor, limit, hasMore }`.
  `limit` is capped at 50. Stale PENDING rows past `expiresAt` are marked
  `EXPIRED` before listing.
- `GET /recommendations/summary?storeId=` — server-computed stats: per-status
  counts, pending impact grouped by currency (currencies are never summed
  together), approved-this-month, per-agent and per-rule breakdowns, approval
  rate (30d and all-time), average time-to-decision, recent decisions, a 30-day
  generated/approved trend, and `{ plan, usage: { used, limit, remaining } }`.
- `GET /recommendations/:id?storeId=` — single recommendation (deep links).
- `POST /recommendations/analyze` — `{ storeId }`. Runs the rule engine on a
  fresh store snapshot. Enforces the monthly plan limit: at the cap it returns
  `403 FORBIDDEN` with `details.reason = 'UPGRADE_REQUIRED'`; near the cap it
  trims generation to the remaining quota (highest-impact signals first) and
  increments `billing_usage`.
- `POST /recommendations/:id/approve` — `{ expectedVersion }` (CAS). Records
  `decidedAt`/`decidedBy`, appends a calibration sample, writes an audit entry.
  Approving a non-SAFE action requires an owner/admin role.
- `POST /recommendations/:id/reject` — `{ expectedVersion, reason? }` with
  `reason ∈ WRONG_DATA|NOT_RELEVANT|BAD_TIMING|ALREADY_HANDLED|OTHER`. The
  reason feeds the calibration ledger.
- `POST /recommendations/bulk-decide` — `{ decisions: [{ id, expectedVersion,
  decision: 'approve'|'reject', reason? }] }` (max 20). Returns per-item
  results; individual CAS conflicts surface as `{ ok: false, error }` rows.
- `POST /recommendations/:id/undo` — reverts a decision to PENDING within a
  30-second grace window and appends a compensating calibration sample.
- `POST /recommendations/:id/snooze` — `{ hours }` (max 7 days), server-side
  so snoozes follow the merchant across devices.
- `GET /recommendations/:id/evidence/verify?storeId=` — server re-computes the
  evidence pack SHA-256; returns `{ verified, sha256, ruleVersion, generatedAt }`.
- `POST /recommendations/:id/execute` — bridges an APPROVED recommendation to
  the idempotent `ActionExecutor` (owner/admin for non-SAFE actions). Actions
  produce reviewable drafts (e.g. `SEND_EMAIL` creates a draft campaign
  template) — nothing contacts a customer directly. Marks `EXECUTED`/`FAILED`
  and records the execution in `ai_executions`; executed customer-facing
  actions are later matched to synced orders (7-day window) into
  `ai_attribution_events`, which `/billing/roi` sums.

Confidence calibration persists in `ai_calibration_samples`: each agent is
capped at .75 confidence until 10 merchant decisions exist, then the cap tracks
the agent's real acceptance rate — HIGH confidence (≥ .9) is earned.

## Jarvis

- `GET /jarvis/preferences?storeId=`
- `PUT /jarvis/preferences`
- `GET /jarvis/briefing?storeId=&page=&plan=`
- `POST /jarvis/sessions`
- `GET /jarvis/sessions/:id`
- `GET /jarvis/sessions/:id/messages`
- `POST /jarvis/sessions/:id/message`
- `POST /jarvis/sessions/:id/action`
- `POST /jarvis/sessions/:id/pause|resume|end`

Jarvis responses contain mode, language, evidence, confidence, and action-confirmation state. Risky voice actions require a repeat confirmation.

`POST /jarvis/sessions/:id/message` accepts `{ storeId, text, page, voice?, stream? }`. With `"stream": true` (and `Accept: text/event-stream`) the endpoint streams the answer: `event: text` frames carry the full accumulated answer text, then a final `event: done` frame carries the validated response object. A missing `stream` flag returns the plain JSON envelope.

## Copilot and forecasting

- `GET /copilot/threads?storeId=`
- `POST /copilot/threads`
- `GET /copilot/threads/:id/messages`
- `GET /copilot/threads/:id/export`
- `POST /copilot/query`
- `GET /forecasting?storeId=`

Copilot accepts only the closed ten-intent grammar and renders numeric slots from deterministic evidence.

## Reports

- `GET /reports?storeId=`
- `POST /reports/generate`
- `GET /reports/:id/download?storeId=`
- `GET/POST /reports/schedules`

Reports require closed periods. R2 is required for production generation; missing SMTP returns `EMAIL_UNAVAILABLE` rather than pretending delivery.

## F9 admin operations

All admin operations require `POST /admin/step-up` followed by `x-admin-step-up`.

- `GET/PUT /admin/maintenance`
- `GET/PUT /admin/merchant-flags`
- `GET /admin/launch-audit`
- `GET /admin/ops/queue`
- `GET /admin/ops/metrics`
- `GET /admin/ops/activity`
- `POST /admin/ops/jobs/:id/retry`

Health, readiness, Shopify webhooks, and admin paths are exempt from maintenance mode.
