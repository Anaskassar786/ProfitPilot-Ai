# ProfitPilot

ProfitPilot is an autonomous AI employee for Shopify merchants. The repository is a pnpm TypeScript monorepo that follows the blueprint build order **F0 → F9**.

## Current phase: F0 — Foundation

F0 establishes all 19 workspace projects, strict TypeScript project references, typed API contracts, real AES-256-GCM crypto, tenant-versioned cache, idempotent queue primitives, PostgreSQL/RLS access, Shopify HMAC/OAuth primitives, redacted structured logging, and the API/worker health boundaries. Future-phase packages are explicit and fail with `PhaseNotImplementedError`; they do not silently pretend to be production features.

### Workspace projects

**Apps**

- `@profitpilot/api` — Express API + readiness checks
- `@profitpilot/worker` — worker bootstrap boundary
- `@profitpilot/web` — web application boundary (F3)

**Packages**

- `@profitpilot/types`
- `@profitpilot/db`
- `@profitpilot/sync`
- `@profitpilot/queue`
- `@profitpilot/cache`
- `@profitpilot/shopify`
- `@profitpilot/crypto`
- `@profitpilot/logger`
- `@profitpilot/notifications`
- `@profitpilot/ui`
- `@profitpilot/ai`
- `@profitpilot/billing`
- `@profitpilot/automation`
- `@profitpilot/forecasting`
- `@profitpilot/reporting`
- `@profitpilot/monitoring`

## Commands

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm coverage
```

No provider credentials are committed. Use `.env.example` as a shape only and inject real values through the deployment secret manager.
