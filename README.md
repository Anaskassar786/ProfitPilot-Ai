# ProfitPilot

ProfitPilot is an autonomous AI employee for Shopify merchants. The repository is a pnpm TypeScript monorepo that follows the blueprint build order **F0 → F9**.

## Current phase: F2 — Data Plane

F0, F1, and F2 are complete. F2 adds eight cursor-resumable Shopify sync modules, a Postgres checkpoint adapter, replay-safe webhook processing with retry/failure audit, Shopify REST pagination, GraphQL bulk operations, adaptive per-store rate control, priority lanes, store circuit isolation, four deterministic analytics aggregates, catalog persistence, tenant-versioned cache invalidation, and `/sync`, `/analytics`, and `/catalog` API routes. Future-phase capabilities are explicit and fail with `PhaseNotImplementedError`; they do not silently pretend to be production features.

### Workspace projects

**Apps**

- `@profitpilot/api` — Express API, readiness checks, Shopify install routes, F2 data-plane routes, JWT/session service
- `@profitpilot/worker` — worker bootstrap boundary
- `@profitpilot/web` — web application boundary (F3)

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
- `@profitpilot/ai` — evidence/CAS foundation; F4 execution boundary
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

No provider credentials are committed. Use `.env.example` as a shape only and inject real values through the deployment secret manager.
