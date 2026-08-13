# ProfitPilot

ProfitPilot is an autonomous AI employee for Shopify merchants. The repository is a pnpm TypeScript monorepo that follows the blueprint build order **F0 → F9**.

## Current phase: F7 — Store Readiness / Pre-Launch Hardening

F0 through F7 are complete. F7 adds env-driven GDPR/CCPA legal pages (`/legal/privacy`, `/legal/terms`, `/legal/security`, `/legal/cookies`, `/legal/dpa`) with the mandatory AI liability disclaimer, strict CSP/CORS, endpoint rate limits, CSRF and secure-cookie contracts, JWT/session/tenant hardening, bounded payloads, redacted request logging, an automated security suite, 30-tenant/webhook-flood/queue-backpressure load checks with p95 budgets, an axe-core WCAG 2.2 AA gate, live SOC-2-Lite RBAC access reviews with CAS-safe history and export, and Shopify App Store asset templates/generator. SMS remains disabled until Twilio and TCPA consent controls are configured. Future-phase capabilities remain explicit and fail with `PhaseNotImplementedError`.

### Workspace projects

**Apps**

- `@profitpilot/api` — Express API, Shopify install, F2 data-plane, F4 AI, F5 billing/admin, F6 automation/marketing, F7 legal/security/access-review routes
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

The Vite proxy keeps browser calls relative while forwarding F2–F7 requests (`/sync`, `/analytics`, `/catalog`, `/ai`, `/recommendations`, `/billing`, `/admin`, `/automation`, `/campaigns`, `/exports`, `/support`, `/settings`, `/security`, `/legal`) to the API during local development. Pass `?storeId=<tenant-id>&shop=<shop>.myshopify.com` to the web URL to load a real tenant context.

No provider credentials are committed. Use `.env.example` as a shape only and inject real values through the deployment secret manager.
