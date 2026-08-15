# ProfitPilot Railway deployment

## Services

Create two Railway services from this repository:

1. **API + Web** — `Dockerfile`, start command `node apps/api/dist/main.js` (default CMD), port `PORT` (default 3000). Set `dockerfilePath = "Dockerfile"`. The build compiles `apps/web` and the API serves `apps/web/dist` at `/`, including static assets and SPA route fallback.
2. **Worker** — `Dockerfile.worker`, start command built into CMD (`node apps/worker/dist/main.js`), port `WORKER_PORT` (default 3100). Set `dockerfilePath = "Dockerfile.worker"` in Railway service settings to avoid relying on UI command overrides.

The API/web and worker bind to `0.0.0.0`. Browser requests use relative URLs on the shared API/web origin; Vite proxies locally only.

## Deployment order

1. Create Railway PostgreSQL and Redis/Upstash resources.
2. Configure the environment variables from `.env.example` in Railway Secret Variables. Never commit `.env` or provider credentials.
3. Configure `R2_*` **or** `CLOUDFLARE_R2_*` variables. F9 normalizes both names.
4. Set `NODE_ENV=production`, `SECURITY_REQUIRE_AUTH=true`, and `RUN_MIGRATIONS=true`. Leave `SHOPIFY_BILLING_TEST_MODE` unset (or `auto`) unless you must force a mode — see "Billing charges" below. Set `SHOPIFY_API_VERSION` to a supported Admin API version (default `2025-10`).
5. Configure `APP_URL` and `SHOPIFY_APP_URL` to the final API/web HTTPS URL, then deploy the API + Web service. Startup validation fails fast on missing production variables; migrations through `0013` run after the F8/F9 bootstrap when `RUN_MIGRATIONS=true`.

### Shopify OAuth and managed-install token exchange

- `/shopify/install` redirects to Shopify; `/shopify/callback` supports the legacy authorization-code path at Shopify's **singular** `POST https://{shop}/admin/oauth/access_token` endpoint.
- For Shopify managed installation, the signed embedded app load is the install handoff. The embedded-entry middleware registers the store, checks `shopify_tokens`, and exchanges the verified `id_token` for a **non-expiring offline access token** using RFC 8693 token exchange (`requested_token_type=urn:shopify:params:oauth:token-type:offline-access-token`, `expiring=0`). The token is encrypted through `TokenVault` before it reaches `shopify_tokens`.
- A sync that receives Shopify `401` performs one forced token exchange and one retry. The browser passes the current app-load `id_token` in `X-Shopify-Session-Token`; it is never included in the sync JSON body or application logs. Missing, expired, or repeatedly rejected credentials return an exposed hard-refresh/install diagnostic instead of a generic 500.
- Expected success logs are `Shopify offline access token exchange succeeded` on first provisioning and `Shopify offline access token refreshed for sync retry` for 401 recovery. No plaintext access or session token is logged.
- OAuth state tokens persist in `shopify_oauth_states` (migration `0012`), so the callback survives restarts/replicas and a replayed state returns `401` with `details.step = "state-verification"`.
- Token-exchange failures now name their cause. The log line `Shopify offline access token exchange failed` carries `upstreamStatus` (Shopify's HTTP status) and `upstreamCode`, which is either Shopify's OAuth error (`invalid_subject_token`, `invalid_client`, ...) or the local session-token rejection reason (`signature-mismatch` = wrong `SHOPIFY_API_SECRET`, `audience-mismatch` = wrong `SHOPIFY_API_KEY`, `expired` = stale `id_token`). No token or secret is logged.
- Callback failures are labeled end-to-end: the JSON body and the logs both carry `details.step` (`validation`, `hmac-verification`, `state-verification`, `token-exchange`, `token-storage`), and the server log includes the underlying message, stack, and cause chain — the HTTP body itself stays sanitized for 5xx.
6. Confirm `/`, a client route such as `/dashboard`, and a built `/assets/*` URL return the web app. Confirm `/health`, `/live`, and `/ready` still return API responses. `/ready` reports PostgreSQL, Redis, OpenRouter, and Shopify independently; a degraded dependency returns HTTP 503 honestly.
7. Deploy the worker using `Dockerfile.worker` (set `dockerfilePath = "Dockerfile.worker"` in Railway service settings) and confirm `http://worker:3100/health` and `/ready`.
8. Run the security, load, accessibility, and full coverage suites against the release commit.
9. Update the Shopify Partner App URL to the shared API/web origin, plus its redirect URL, webhook URL, and allowed scopes; then install in a development store.

### Sync circuit breaker

Each store has an independent Shopify circuit breaker. It opens after
`SYNC_CIRCUIT_FAILURE_THRESHOLD` consecutive **upstream** failures (default 3)
and closes automatically after `SYNC_CIRCUIT_COOLDOWN_MS` (default 60000 ms).

- Only Shopify 5xx, 429, and transport errors count against it. A missing
  offline token, a Shopify 401, and validation/conflict errors never trip it —
  those are repaired by the token exchange rather than by waiting.
- A successful token exchange during `/sync` closes the store's circuit
  immediately, so a merchant who hard-refreshes the embedded app is not held
  out for the remainder of the cooldown.
- `GET /sync/status?storeId=...` reports whether the store is registered,
  whether an offline access token exists, and the live circuit state (including
  `retryAfterMs`). It never returns the token itself.
- `POST /sync/circuit/reset` with `{"storeId":"..."}` closes a circuit on
  demand. The dashboard calls it automatically and retries once when a sync is
  refused with an open circuit.

### Billing charges

`POST /billing/charge` creates a Shopify recurring application charge.

- `SHOPIFY_BILLING_TEST_MODE` accepts `true`, `false`, or `auto` (default).
  Under `auto` the client reads the shop's `plan_name` and forces `test: true`
  for development, partner-test, staff, and plus-partner-sandbox stores.
  Requesting a live charge on those stores is what Shopify answers with
  `422 Unprocessable Entity`.
- The charge payload sends `name`, `price` (two-decimal string), `return_url`,
  and `test`; `trial_days` is included only when greater than zero.
- A Shopify 422 is returned to the merchant as a `422 VALIDATION_ERROR` naming
  the rejected fields, and the full upstream body is recorded on the error
  cause in the API error log. Shopify 5xx/401/403 map to `502 DEPENDENCY_ERROR`.

## Rollback

Use Railway's previous deployment for API and worker together. Do not roll back only one process when a migration has already run. Review `schema_migrations` and take a database backup before destructive changes.

## Secrets and rotation

Rotate Shopify secret, JWT, encryption, CSRF, SMTP, OpenRouter, R2, Redis, Sentry, and admin keys through Railway Secret Variables. Revoke old Shopify sessions and refresh-token families after rotation. Redeploy API and worker, then verify `/ready` and the audit trail.
