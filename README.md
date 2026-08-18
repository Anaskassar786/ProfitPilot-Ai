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
### AI Command (PR #51)

The Copilot page is now **AI Command** (`/ai-command`, sidebar label “AI Command”). Merchants ask grounded questions against live module data. Commander users can preview and approve real actions (email via verified Brevo sender, Shopify tags/discounts, recommendation approval, workflow trigger, notifications, reports). Trial/Start/Growth stay info-only with an **Upgrade Plan** CTA. Campaigns is removed from the sidebar; campaign tables remain. See `docs/AI_COMMAND.md`.

### Recommendations (PR #46)

The Recommendations page is a dedicated workspace (`apps/web/src/recommendations.tsx` + `recommendations-model.ts` + `recommendations.css`) backed by the full lifecycle API in `apps/api/src/ai-routes.ts`. Highlights:

- **Working generation** — `POST /recommendations/analyze` runs eight deterministic rules over a real store snapshot (currency from synced orders; product velocity from `analytics_product_sales_daily`; co-purchase pairs from real order line items).
- **Plan metering** — `ai_recommendations_month` (Trial 10 / Start 30 / Growth 150 / Commander unlimited) is enforced server-side via `billing_usage`, with a usage ring, near-limit warning, and hard-block upgrade CTA in the UI. Plan limits live in one place: `packages/types/src/plans.ts` (`PLAN_ENTITLEMENT_LIMITS`).
- **Trust surfaces** — the evidence drawer renders every evidence fact with its source column, server-verifies the pack's SHA-256, and shows the decision trail. A "How it works" modal explains rules, sealing, calibration, and impact modeling.
- **Decision lifecycle** — CAS approve/reject with optional reject reasons, 30-second undo, bulk decide (max 20), server-side snooze, rule-derived expiry (`EXPIRED` status), `decided_at`/`decided_by` audit fields, `audit_log` entries, and RBAC (owner/admin required for non-SAFE approvals; Jarvis decisions are atomic).
- **Feedback loop** — every decision appends to `ai_calibration_samples`; agent confidence caps hydrate from history at boot, so HIGH confidence is earned after 10+ merchant decisions.
- **Execution bridge** — `POST /recommendations/:id/execute` runs the idempotent `ActionExecutor` (drafts only — `SEND_EMAIL` creates a reviewable campaign template), records `ai_executions`, and feeds the time-window attribution matcher that populates `ai_attribution_events` for `/billing/roi`.


### AI Executive (PR #49)

AI Executive — **"Your Boardroom in a Box"** — is the strategic half of the AI
Growth Command page (`#/ai-growth-command/executive`), designed for CEO-level
decisions rather than daily operations. It ships with its own
`docs/AI_EXECUTIVE.md`.

- **Zero fake data** — board reports, the eight-vital-sign health diagnosis,
  the risk radar, opportunities, scenarios, and the dashboard are all computed
  from real synced rows (`apps/api/src/executive-analytics.ts`). Missing
  metrics are reported as "not measurable" instead of estimated.
- **Grounded AI language** — OpenRouter (shared `STORE_COACH_API_KEY`,
  `nvidia/nemotron-3-ultra:free` → `nvidia/nemotron-3-super:free` fallback)
  writes narrative only; the language firewall rejects any invented number,
  and deterministic templates keep every report complete without the provider.
- **Plan-gated everywhere** — 402 `UPGRADE_REQUIRED` with upgrade context from
  the API; aspirational locked overlays in the UI whose CTA is always
  "Upgrade Plan" (never a plan name). Trial sees clearly-labeled sample
  previews. Usage meters warn at 80% and block at 100%.
- **Investor PDF (Commander)** — dependency-free PDF writer with cover page,
  table of contents, vector charts, page numbers, white-label branding, async
  job/poll generation, 30-day retention, plus a Brevo monthly board-report
  email (PDF attached for Commander).
- **Industry benchmarks (hybrid)** — curated public Shopify benchmark ladders
  seeded in migration `0022`; anonymized internal aggregates arrive in Phase 2.
- **Modern chart vocabulary** — area/gradient, radial gauge, sparkline,
  stacked bar, waterfall, horizontal bar, bubble map, bullet, percentile bar,
  and heatmap — all theme-adaptive (dark + light) with hover tooltips and
  print-ready output. No line or donut charts.

## Store Coach (PR #48) — AI Growth Command

Store Coach is the merchant's personal AI business advisor and the first
section of the new **AI Growth Command** module (`/ai-growth-command`). Daily
huddles, plan-capped priorities, tracked goals, 50-badge achievements, a
30-day progress dashboard with modern charts, SSE-streamed grounded chat, and
Sunday Brevo digests. Executive Briefing (PR #49) and Insights Hub (PR #50)
arrive as tabs in the same page; Campaigns now shows a "Coming Soon"
placeholder (existing templates are preserved, not deleted).

- **Zero fake data** — every number is read from synced store rows; AI output
  passes a grounded-number firewall that rejects hallucinated statistics and
  PII before anything reaches the merchant.
- **Plan gating** — Trial (2 priorities, 1 goal, 5 chat msgs), Start, Growth,
  Commander per the matrix in `docs/STORE_COACH.md`; trial expiry blocks the
  module with a 402 until upgrade. Upgrade CTAs always say "Upgrade Plan".
- **Infrastructure** — OpenRouter `nvidia/nemotron-3-ultra:free` (fallback
  `nvidia/nemotron-3-super:free`) via `STORE_COACH_API_KEY`, cost-ledger
  tracking, 24h huddle caching, RLS-isolated tables (migration 0023), and an
  hourly scheduler for huddles, Sunday digests, and badge sweeps.
- **UI** — extracted workspace files (`store-coach.tsx`, `store-coach-panels.tsx`,
  `coach-widget.tsx`, `store-coach-model.ts`, `store-coach.css`) with area
  charts, radial gauges, heatmaps, sparklines, stacked bars, skeleton loaders,
  educational empty states, 5-step onboarding, Start+ floating widget, and
  Growth+ browser voice. Dark and light themes are fully supported.


### Workspace projects

**Apps**

- `@profitpilot/api` — Express API, Shopify install, F2 data-plane, F4 AI, F5 billing/admin, F6 automation/marketing, F7 hardening, F8 Jarvis/Copilot/forecast/report routes, F9 launch controls/ops, F10 Store Coach (PR #48), and production hosting for the built web app
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

## Insights Hub (PR #50)

"Where data becomes wisdom" — the third module of AI Growth Command. It discovers hidden patterns (weekly rhythms, anomalies, product affinities, momentum), compiles lessons grounded in the store's own history, clusters customers into named personas (RFM, ≥50 customers, anonymized aggregates only), answers Why? questions with ranked root causes, watches business trends, runs product/period/segment/category/channel comparisons, compounds a searchable knowledge base, remembers everything on a plan-windowed timeline, and forecasts revenue/orders/stockouts with honest confidence intervals and post-window accuracy grading.

Everything is computed deterministically from real synced analytics — thin data produces educational empty states, never invented numbers; trial explores via clearly labeled samples. The AI narrator (dedicated OpenRouter key, free-tier Nemotron models, $0/day budget) may only rephrase engine output through the language firewall. Locked capabilities return 402 `UPGRADE_REQUIRED` with a generic **Upgrade Plan** CTA. Charts are custom theme-adaptive SVGs (bubble/radar/heatmap/area-gradient/scatter/timeline/word-cloud/network/treemap — no line or donut charts). Commander adds a Bearer-key public API (`/public-api/insights/*`, 100 req/h) documented at `/public-api/insights/openapi.json`. Auto-discovery sweeps run daily 02:00 UTC via the worker. See `docs/INSIGHTS_HUB.md`.
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

The Vite proxy keeps browser calls relative while forwarding F2–F8 requests (`/sync`, `/analytics`, `/catalog`, `/ai`, `/ai-command`, `/recommendations`, `/billing`, `/admin`, `/automation`, `/campaigns`, `/exports`, `/support`, `/settings`, `/security`, `/legal`, `/jarvis`, `/copilot`, `/forecasting`, `/reports`) to the API during local development. Pass `?storeId=<tenant-id>&shop=<shop>.myshopify.com` to the web URL to load a real tenant context. In production, the API process serves `apps/web/dist` at `/` on the same origin and falls back to `index.html` for client-side routes.

No provider credentials are committed. Use `.env.example` as a shape only and inject real values through the deployment secret manager.

<!-- trigger redeploy 3 -->
