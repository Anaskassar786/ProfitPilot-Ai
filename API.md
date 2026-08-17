# ProfitPilot API

> Professional Automation endpoint and safety documentation: [`docs/AUTOMATION.md`](docs/AUTOMATION.md). reference

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

## AI Command Center (PR45)

Every endpoint is tenant-scoped by `storeId` and plan-gated: agents a store's
plan does not unlock return `403` with `details.reason = UPGRADE_REQUIRED` and
`details.requiredPlan` set to the cheapest tier that unlocks them.

- `GET /ai/agents` — legacy global status contract (all seven agents).
- `GET /ai/agents?storeId=` — plan-aware overview: `{ plan, unlockedCount,
  totalCount, agents[] }` where each agent carries `locked`, `requiredPlan`,
  `paused`, `execution`, `tagline`, and `sampleInsight`.
- `PATCH /ai/agents/:agentId?storeId=` — body `{ paused: boolean }`; persists
  pause/resume to `ai_agent_settings` (unlocked agents only).
- `POST /ai/agents/:agentId/run?storeId=` — run one agent on demand. `409` when
  the agent is paused, `403` when locked.
- `GET /ai/agents/:agentId/activity?storeId=` — the agent's last 20
  recommendations (runs, outcomes, impact).
- `POST /ai/run-all?storeId=` — runs every unlocked, unpaused agent with
  bounded concurrency and streams `text/event-stream` frames: `start`
  (`runnable`, `skipped` with `LOCKED`/`PAUSED` reasons), `progress`
  (`agent`, `completed`, `total`), `done` (`recommendations`, `deduplicated`,
  `cacheHits`, `health`), `error`.
- `GET /ai/rules` — the deterministic rule catalog (name, owning agent,
  purpose, live thresholds, inputs, impact semantics).
- `GET /ai/health?storeId=` — the deterministic store health score and its
  weighted components.
- `GET /ai/cost?storeId=` — today's AI spend vs. the daily cap, read from the
  durable `ai_cost_ledger` (survives restarts, shared across instances).
- `GET /ai/cost/breakdown?storeId=` — today's spend grouped per agent and
  model with token counts.
- `POST /recommendations/analyze?storeId=` — full analysis across the plan's
  unlocked agents. Re-runs refresh still-`PENDING` recommendations for the
  same `(rule, entity)` instead of duplicating them; the response reports
  `deduplicated` and `cacheHits`.
- `POST /recommendations/:id/approve|reject` — CAS decision by
  `expectedVersion`; outcomes now feed the per-agent calibration ledger
  (`ai_calibration_samples`), so confidence caps learn from merchant feedback.

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
