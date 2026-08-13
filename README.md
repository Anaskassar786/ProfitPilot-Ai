# ProfitPilot

ProfitPilot is an autonomous AI employee for Shopify merchants. The repository is a pnpm TypeScript monorepo that follows the blueprint build order **F0 → F9**.

## Current phase: F4 — AI Loop

F0 through F4 are complete. F4 adds the real deterministic AI loop: PII-minimized context building, deterministic health scoring, all eight opportunity rules, seven versioned language-only agents, OpenRouter’s three-model/three-key fallback client, response-number validation, calibration caps and feedback learning, immutable evidence, CAS recommendation decisions, idempotent action policy, signed attribution matching, per-store micro-dollar cost caps, F4 API routes, and real F3 agent/recommendation wiring. No model is allowed to create a number; every number shown comes from deterministic rules or F2 data. Future-phase capabilities remain explicit and fail with `PhaseNotImplementedError`.

### Workspace projects

**Apps**

- `@profitpilot/api` — Express API, Shopify install, F2 data-plane, F4 AI/recommendation routes, JWT/session service
- `@profitpilot/worker` — worker bootstrap boundary
- `@profitpilot/web` — React/Vite web shell with real F2/F4 API clients

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
- `@profitpilot/billing` — typed billing state machine
- `@profitpilot/automation` — DAG validation; F6 worker execution boundary
- `@profitpilot/forecasting` — deterministic formula foundation
- `@profitpilot/reporting` — closed-period/report-key foundation; F8 PDF boundary
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

The Vite proxy keeps browser calls relative while forwarding F2/F4 requests (`/sync`, `/analytics`, `/catalog`, `/ai`, `/recommendations`) to the API during local development. Pass `?storeId=<tenant-id>&shop=<shop>.myshopify.com` to the web URL to load a real tenant context.

No provider credentials are committed. Use `.env.example` as a shape only and inject real values through the deployment secret manager.
