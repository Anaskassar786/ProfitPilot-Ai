# ProfitPilot

ProfitPilot is an autonomous AI employee for Shopify merchants. The repository is a pnpm TypeScript monorepo that follows the blueprint build order **F0 → F9**.

## Current phase: F6 — Automation + Marketing

F0 through F6 are complete. F6 adds server-validated immutable DAG workflows, manual/cron/webhook triggers, YES/NO conditions, email/SMS/tag/discount/wait action nodes, idempotent step ledgers with worker-tick wait resumption, closed 11-variable campaign templates, A/B winner selection, suppression compliance, HMAC open/click tracking, 50-message batching with job dedupe, real SMTP/Brevo transport wiring, merchant email verification, custom CSV/XLSX/PDF writers, support ticket/thread ledgers, F6 database/RLS migration, F6 API routes, and F3 automation/campaign/export/support/settings wiring. SMS remains disabled until Twilio is configured. Future-phase capabilities remain explicit and fail with `PhaseNotImplementedError`.

### Workspace projects

**Apps**

- `@profitpilot/api` — Express API, Shopify install, F2 data-plane, F4 AI, F5 billing/admin, F6 automation/marketing routes
- `@profitpilot/worker` — queue worker plus billing tick boundaries
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
- `@profitpilot/ai` — context, health, rules, agents, OpenRouter, calibration, evidence, execution, attribution, costs, repositories
- `@profitpilot/billing` — plans, entitlements, Shopify charges, trials, gift codes, grandfathering, ROI, funnel, admin sessions, reconciliation
- `@profitpilot/automation` — workflows, policies, campaigns, templates, SMTP, suppression, tracking, batching, tickets
- `@profitpilot/forecasting` — deterministic formula foundation
- `@profitpilot/reporting` — closed-period reports and custom CSV/XLSX/PDF writers
- `@profitpilot/monitoring`

## Commands

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm coverage
```

For the web shell:

```bash
corepack pnpm --filter @profitpilot/web dev
```

The Vite proxy keeps browser calls relative while forwarding F2–F6 requests (`/sync`, `/analytics`, `/catalog`, `/ai`, `/recommendations`, `/billing`, `/admin`, `/automation`, `/campaigns`, `/exports`, `/support`, `/settings`) to the API during local development. Pass `?storeId=<tenant-id>&shop=<shop>.myshopify.com` to the web URL to load a real tenant context.

No provider credentials are committed. Use `.env.example` as a shape only and inject real values through the deployment secret manager.
