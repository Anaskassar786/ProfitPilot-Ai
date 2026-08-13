# ProfitPilot

ProfitPilot is an autonomous AI employee for Shopify merchants. The repository is a pnpm TypeScript monorepo that follows the blueprint build order **F0 → F9**.

## Current phase: F8 — Jarvis, Copilot, Forecasting, and Reports

F0 through F8 are complete. F8 adds a real OpenRouter-backed Jarvis with three-key/model fallback, evidence-only answers, English/Hindi detection, merchant addressing, plan-based memory, silence controls, page-aware background sessions, risky-action confirmation, native Web Speech STT/TTS, immersive voice mode, a closed ten-intent Copilot with deterministic number slots and tenant-scoped threads, method-stamped revenue/demand/stockout/RFM forecasts, deterministic closed-period PDF reports, a PostgreSQL/R2 vault, honest SMTP delivery status, idempotent regeneration, and a six-hourly worker tick boundary. SMS remains disabled until Twilio and TCPA consent controls are configured. Future-phase capabilities remain explicit and fail with `PhaseNotImplementedError`. F9 is not started.

F7 legal/security/access-readiness controls remain active under the F8 API shell.

### Workspace projects

**Apps**

- `@profitpilot/api` — Express API, Shopify install, F2 data-plane, F4 AI, F5 billing/admin, F6 automation/marketing, F7 hardening, F8 Jarvis/Copilot/forecast/report routes
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
- `@profitpilot/ai` — context, health, rules, agents, OpenRouter, calibration, evidence, execution, attribution, costs, Jarvis, Copilot, repositories
- `@profitpilot/billing` — plans, entitlements, Shopify charges, trials, gift codes, grandfathering, ROI, funnel, admin sessions, reconciliation
- `@profitpilot/automation` — workflows, policies, campaigns, templates, SMTP, suppression, tracking, batching, tickets
- `@profitpilot/forecasting` — deterministic seasonality, demand, stockout, and RFM formula foundation
- `@profitpilot/reporting` — closed-period reports, custom PDF writers, DB/R2 vault, and delivery status
- `@profitpilot/monitoring` — error monitoring, access-review ledger, p95 load-budget measurements

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

The Vite proxy keeps browser calls relative while forwarding F2–F8 requests (`/sync`, `/analytics`, `/catalog`, `/ai`, `/recommendations`, `/billing`, `/admin`, `/automation`, `/campaigns`, `/exports`, `/support`, `/settings`, `/security`, `/legal`, `/jarvis`, `/copilot`, `/forecasting`, `/reports`) to the API during local development. Pass `?storeId=<tenant-id>&shop=<shop>.myshopify.com` to the web URL to load a real tenant context.

No provider credentials are committed. Use `.env.example` as a shape only and inject real values through the deployment secret manager.
