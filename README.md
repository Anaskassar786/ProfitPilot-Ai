# ProfitPilot

ProfitPilot is an autonomous AI employee for Shopify merchants. The repository is a pnpm TypeScript monorepo that follows the blueprint build order **F0 → F9**.

## Current phase: F3 — Web Shell

F0, F1, F2, and F3 are complete. F3 adds the responsive React/Vite shell with the exact ProfitPilot dark design tokens, light-mode toggle, collapsible sidebar, breadcrumbs, command palette, notification drawer, toast system, loading skeletons, empty states, offline banner, keyboard shortcuts, onboarding install flow, accessibility focus states, and all 16 blueprint sections. The dashboard, analytics, catalog, inventory, sync actions, and data trust indicators use the real F2 `/sync`, `/analytics`, and `/catalog` APIs through relative URLs. No preview metrics or demo records are shipped. Future-phase UI actions are explicit and call `PhaseNotImplementedError`; they do not silently pretend to execute.

### Workspace projects

**Apps**

- `@profitpilot/api` — Express API, readiness checks, Shopify install routes, F2 data-plane routes, JWT/session service
- `@profitpilot/worker` — worker bootstrap boundary
- `@profitpilot/web` — React/Vite web shell with real F2 API client

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

For the web shell:

```bash
corepack pnpm --filter @profitpilot/web dev
```

The Vite proxy keeps browser calls relative while forwarding F2 requests to the API during local development. Pass `?storeId=<tenant-id>&shop=<shop>.myshopify.com` to the web URL to load a real tenant context.

No provider credentials are committed. Use `.env.example` as a shape only and inject real values through the deployment secret manager.
