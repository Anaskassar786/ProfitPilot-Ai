# ProfitPilot launch checklist

## Release gates

- [ ] F9 branch commit is the release commit; no uncommitted changes.
- [ ] `corepack pnpm install --frozen-lockfile`
- [ ] `corepack pnpm build`
- [ ] `corepack pnpm typecheck`
- [ ] `corepack pnpm test` and `corepack pnpm coverage` pass with 90%+ line/function coverage.
- [ ] `corepack pnpm test:security` passes.
- [ ] `corepack pnpm test:load` passes all p95 budgets.
- [ ] `corepack pnpm test:a11y` reports zero Axe violations.

## Railway and data

- [ ] Production `NODE_ENV`, `SECURITY_REQUIRE_AUTH`, `RUN_MIGRATIONS` set correctly.
- [ ] PostgreSQL backup and restore drill recorded.
- [ ] Redis/Upstash queue and dead-letter namespace verified.
- [ ] R2 bucket can PUT and GET a generated PDF.
- [ ] SMTP test message delivered only from a verified merchant sender.
- [ ] Sentry event and performance span received with release and store context.
- [ ] Worker `/health` and `/ready` are reachable.
- [ ] API `/ready` shows all four dependency checks and any degraded state is understood.

## Shopify

- [ ] HTTPS app URL and OAuth redirect URL match Partner Dashboard.
- [ ] Full install→callback round trip verified in a development store: callback returns 302 into `admin.shopify.com/store/{store}/apps/{client_id}`, an encrypted row appears in `shopify_tokens`, and a burned state row is gone from `shopify_oauth_states`.
- [ ] HMAC webhook receipt/replay behavior verified in a development store.
- [ ] `app/uninstalled`, GDPR data request, and redaction handlers have an owner/runbook.
- [ ] Requested scopes are the minimum required scopes.
- [ ] Development-store install, sync, recommendations, Jarvis, Copilot, reports, billing, and uninstall tested.
- [ ] App Store listing screenshots contain real authorized data only and no customer PII.

## Safety and compliance

- [ ] Legal pages render configured entity values over HTTPS.
- [ ] Terms liability disclaimer remains present.
- [ ] Admin step-up key is held only by authorized operators.
- [ ] Maintenance mode and merchant suspend controls tested before launch.
- [ ] AI never receives direct customer PII; email/SMS suppression and consent checks are active.
- [ ] Incident contact, backup owner, and rollback owner are named.
