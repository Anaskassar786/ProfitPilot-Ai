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
