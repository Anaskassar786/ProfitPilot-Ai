# ProfitPilot

ProfitPilot is an autonomous AI employee for Shopify merchants. The repository is a pnpm TypeScript monorepo that follows the blueprint build order **F0 → F9**.

## Current phase: F9 — Launch Hardening / Production Operations

F0 through F9 are complete. F9 adds persisted maintenance mode with critical endpoint exemptions, per-merchant AI/automation/suspension flags, audited admin controls, live queue/dead-letter inspection and retry, four-dependency readiness probes, optional Sentry grouping/release/performance monitoring, startup environment validation with Cloudflare R2 alias normalization, migration-on-start support, worker health on port 3100, production logging/shutdown behavior, Docker/Railway deployment files, and launch/security/runbook documentation. F9 is the final blueprint phase; deployment and Shopify App Store submission are operational follow-up steps, not a new product phase.

### Recommendations (PR #46)

The Recommendations page is a dedicated workspace (`apps/web/src/recommendations.tsx` + `recommendations-model.ts` + `recommendations.css`) backed by the full lifecycle API in `apps/api/src/ai-routes.ts`. Highlights:

- **Working generation** — `POST /recommendations/analyze` runs eight deterministic rules over a real store snapshot (currency from synced orders; product velocity from `analytics_product_sales_daily`; co-purchase pairs from real order line items).
- **Plan metering** — `ai_recommendations_month` (Trial 10 / Start 30 / Growth 150 / Commander unlimited) is enforced server-side via `billing_usage`, with a usage ring, near-limit warning, and hard-block upgrade CTA in the UI. Plan limits live in one place: `packages/types/src/plans.ts` (`PLAN_ENTITLEMENT_LIMITS`).
- **Trust surfaces** — the evidence drawer renders every evidence fact with its source column, server-verifies the pack's SHA-256, and shows the decision trail. A "How it works" modal explains rules, sealing, calibration, and impact modeling.
- **Decision lifecycle** — CAS approve/reject with optional reject reasons, 30-second undo, bulk decide (max 20), server-side snooze, rule-derived expiry (`EXPIRED` status), `decided_at`/`decided_by` audit fields, `audit_log` entries, and RBAC (owner/admin required for non-SAFE approvals; Jarvis decisions are atomic).
- **Feedback loop** — every decision appends to `ai_calibration_samples`; agent confidence caps hydrate from history at boot, so HIGH confidence is earned after 10+ merchant decisions.
- **Execution bridge** — `POST /recommendations/:id/execute` runs the idempotent `ActionExecutor` (drafts only — `SEND_EMAIL` creates a reviewable campaign template), records `ai_executions`, and feeds the time-window attribution matcher that populates `ai_attribution_events` for `/billing/roi`.

### Workspace projects

**Apps**

- `@profitpilot/api` — Express API, Shopify install, F2 data-plane, F4 AI, F5 billing/admin, F6 automation/marketing, F7 hardening, F8 Jarvis/Copilot/forecast/report routes, F9 launch controls/ops, and production hosting for the built web app
- `@profitpilot/worker` — queue worker, report tick boundary, graceful runtime, and port-3100 health
- `@profitpilot/web` — React/Vite shell with real F2–F6 API clients

**Packages**

- `@profitpilot/types` — API contracts, identifiers, plans, RBAC roles and permissions
- `@profitpilot/db` — PostgreSQL pool, RLS context, migrations, role assignments, sessions, analytics repositories
- `@profitpilot/sync` — eight-module sync engine, checkpoints, REST source, Postgres sink, analytics aggregation, rate/circuit policy, priority scheduler
- `@profitpilot/queue` — idempotent queue primitives
- `@profitpilot/cache` — tenant-versioned cache with Upstash adapter
- `@profitpilot/shopify` — OAuth install, HMAC verification, REST client, GraphQL bulk client, encrypted token vault, webhook retry ledger
- `@profitpilot/crypto` — AES-256-GCM, HMAC, hashing, timing-safe comparisons
- `@profitpilot/logger` — structured redacted logger
- `@profitpilot/notifications`
- `@profitpilot/ui` — F0 design token boundary
- `@profitpilot/ai` — context, health, rules, agents, OpenRouter, calibration, evidence, execution, attribution, costs, Jarvis, Copilot, repositories
- `@profitpilot/billing` — plans, entitlements, Shopify charges, trials, gift codes, grandfathering, ROI, funnel, admin sessions, reconciliation
- `@profitpilot/automation` — workflows, policies, campaigns, templates, SMTP, suppression, tracking, batching, tickets
- `@profitpilot/forecasting` — deterministic seasonality, demand, stockout, and RFM formula foundation
- `@profitpilot/reporting` — closed-period reports, custom PDF writers, DB/R2 vault, and delivery status
- `@profitpilot/monitoring` — error/Sentry monitoring, access review, launch controls, queue ops, and p95 load-budget measurements

## Commands

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm coverage
corepack pnpm test:security
corepack pnpm test:load
corepack pnpm test:a11y
corepack pnpm generate:shopify
```

For the web shell:

```bash
corepack pnpm --filter @profitpilot/web dev
```

The Vite proxy keeps browser calls relative while forwarding F2–F8 requests (`/sync`, `/analytics`, `/catalog`, `/ai`, `/recommendations`, `/billing`, `/admin`, `/automation`, `/campaigns`, `/exports`, `/support`, `/settings`, `/security`, `/legal`, `/jarvis`, `/copilot`, `/forecasting`, `/reports`) to the API during local development. Pass `?storeId=<tenant-id>&shop=<shop>.myshopify.com` to the web URL to load a real tenant context. In production, the API process serves `apps/web/dist` at `/` on the same origin and falls back to `index.html` for client-side routes.

No provider credentials are committed. Use `.env.example` as a shape only and inject real values through the deployment secret manager.

<!-- trigger redeploy 3 -->
