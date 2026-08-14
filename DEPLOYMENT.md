# ProfitPilot Railway deployment

## Services

Create three Railway services from this repository:

1. **API** — `Dockerfile`, start command `node apps/api/dist/main.js` (default CMD), port `PORT` (default 3000). Set `dockerfilePath = "Dockerfile"`.
2. **Worker** — `Dockerfile.worker`, start command built into CMD (`node apps/worker/dist/main.js`), port `WORKER_PORT` (default 3100). Set `dockerfilePath = "Dockerfile.worker"` in Railway service settings to avoid relying on UI command overrides.
3. **Web** — `Dockerfile` (or create `Dockerfile.web` if isolating), start command `pnpm --filter @profitpilot/web preview --host 0.0.0.0`, port 4173.

The API and worker bind to `0.0.0.0`. Browser requests use relative URLs; Vite proxies locally only.

## Deployment order

1. Create Railway PostgreSQL and Redis/Upstash resources.
2. Configure the environment variables from `.env.example` in Railway Secret Variables. Never commit `.env` or provider credentials.
3. Configure `R2_*` **or** `CLOUDFLARE_R2_*` variables. F9 normalizes both names.
4. Set `NODE_ENV=production`, `SECURITY_REQUIRE_AUTH=true`, `RUN_MIGRATIONS=true`, and `SHOPIFY_BILLING_TEST_MODE=false`.
5. Deploy the API. Startup validation fails fast on missing production variables; migration `0011` runs after the F8/F9 bootstrap when `RUN_MIGRATIONS=true`.
6. Confirm `/health`, `/live`, and `/ready`. `/ready` reports PostgreSQL, Redis, OpenRouter, and Shopify independently; a degraded dependency returns HTTP 503 honestly.
7. Deploy the worker using `Dockerfile.worker` (set `dockerfilePath = "Dockerfile.worker"` in Railway service settings) and confirm `http://worker:3100/health` and `/ready`.
8. Deploy web and configure `APP_URL`/`SHOPIFY_APP_URL` with the final HTTPS URLs.
9. Run the security, load, accessibility, and full coverage suites against the release commit.
10. Update the Shopify Partner App URL, redirect URL, webhook URL, and allowed scopes; then install in a development store.

## Rollback

Use Railway's previous deployment for API and worker together. Do not roll back only one process when a migration has already run. Review `schema_migrations` and take a database backup before destructive changes.

## Secrets and rotation

Rotate Shopify secret, JWT, encryption, CSRF, SMTP, OpenRouter, R2, Redis, Sentry, and admin keys through Railway Secret Variables. Revoke old Shopify sessions and refresh-token families after rotation. Redeploy API and worker, then verify `/ready` and the audit trail.
