# ProfitPilot

ProfitPilot is an autonomous AI employee for Shopify merchants. The repository is a pnpm TypeScript monorepo that follows the blueprint build order **F0 → F9**.

## Current phase: F1 — Shopify Core

F0 and F1 are complete. F1 adds a replay-proof Shopify install flow, AES-256-GCM token vault, webhook HMAC verification plus receipt deduplication, seeded RBAC permissions, rotating sessions, JWT access/refresh tokens, reuse detection, session expiry, and RLS-backed session/role/webhook migrations. Future-phase capabilities are explicit and fail with `PhaseNotImplementedError`; they do not silently pretend to be production features.

### Workspace projects

**Apps**

- `@profitpilot/api` — Express API, readiness checks, Shopify install routes, JWT/session service
- `@profitpilot/worker` — worker bootstrap boundary
- `@profitpilot/web` — web application boundary (F3)

**Packages**

- `@profitpilot/types` — API contracts, identifiers, plans, RBAC roles and permissions
- `@profitpilot/db` — PostgreSQL pool, RLS context, migrations, role assignments, session repositories
- `@profitpilot/sync` — F2 checkpoint/planning boundary
- `@profitpilot/queue` — idempotent queue primitives
- `@profitpilot/cache` — tenant-versioned cache
- `@profitpilot/shopify` — OAuth install, HMAC verification, API client, encrypted token vault, webhook receipt ledger
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
