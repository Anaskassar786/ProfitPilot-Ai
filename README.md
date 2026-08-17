# ProfitPilot

ProfitPilot is an autonomous AI employee for Shopify merchants. The repository is a pnpm TypeScript monorepo that follows the blueprint build order **F0 → F9**.

## Current phase: F9 — Launch Hardening / Production Operations

F0 through F9 are complete. F9 adds persisted maintenance mode with critical endpoint exemptions, per-merchant AI/automation/suspension flags, audited admin controls, live queue/dead-letter inspection and retry, four-dependency readiness probes, optional Sentry grouping/release/performance monitoring, startup environment validation with Cloudflare R2 alias normalization, migration-on-start support, worker health on port 3100, production logging/shutdown behavior, Docker/Railway deployment files, and launch/security/runbook documentation. F9 is the final blueprint phase; deployment and Shopify App Store submission are operational follow-up steps, not a new product phase.

## AI Command Center (PR45 overhaul)

The AI Command Center is a plan-aware AI workforce dashboard backed entirely by
deterministic evidence — agents explain numbers, they never invent them.

**The seven agents and the plans that unlock them**

| Agent | Rules routed to it | Unlocked from |
|---|---|---|
| Revenue Agent | `REVENUE_SPIKE`, `REVENUE_DROP` | Trial |
| Inventory Agent | `STOCKOUT_RISK`, `DEAD_STOCK` | Trial |
| Customer Agent | `CHURN_RISK`, `REPEAT_PURCHASE` | Start ($49/mo) |
| Pricing Agent | `PRICING_UPLIFT` | Growth ($149/mo) |
| Campaign Agent | `CART_ABANDONMENT`, `NEW_CUSTOMER_WELCOME` | Growth ($149/mo) |
| Product Agent | `CROSS_SELL` | Commander ($349/mo) |
| Executive Agent | `WEEKLY_HEALTH_DIGEST` | Commander ($349/mo) |

Trial unlocks 2 agents, Start 3, Growth 5, Commander all 7 — enforced
server-side (`agentsForPlan` / `assertAgentAccess` in `@profitpilot/billing`)
and rendered as aspirational locked cards with upgrade CTAs in the UI. An
expired trial must upgrade to a paid plan to keep using agents.

**Engine guarantees**

- All 11 deterministic rules are fed real data: velocity and dead-stock
  windows derive from `analytics_product_sales`, unit cost from variant cost
  fields, and cross-sell pairs from synced order line co-occurrence.
- Re-running analysis refreshes still-pending `(rule, entity)` recommendations
  instead of duplicating them.
- AI spend is metered durably in `ai_cost_ledger` (per agent and model) with a
  shared daily cap; approve/reject decisions persist to
  `ai_calibration_samples` and calibrate per-agent confidence.
- Identical evidence hits a 24h tenant-versioned explanation cache instead of
  a second AI call; `run-all` executes with bounded concurrency and streams
  SSE progress.

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
- `@profitpilot/automation` — named/versioned workflows, durable runs and approvals, safety policies, installable templates, SMTP, suppression, tracking, batching, campaigns, and tickets

## Automation

The Automation hub is a tenant-scoped Shopify workflow system with a React Flow editor, immutable published versions, manual/scheduled/webhook triggers, dry runs, persistent run and step history, approval pauses, and real action adapters. Supported production actions are consent-aware email, customer tags, bounded discounts, internal notifications, wait/delay, and bounded inventory updates. SMS is intentionally unavailable.

Workflow limits are enforced by the API: Trial 2, Start 5, Growth 20, and Commander unlimited. AI workflow nodes and AI templates are Commander-only. Sensitive actions are payload-bound to expiring approval records, run logs redact PII, and all PostgreSQL workflow operations use tenant context.
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
