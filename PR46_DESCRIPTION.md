# PR #46 — Recommendations Page Complete Redesign & Overhaul

Transforms the Recommendations module from a broken ~25-line inline component
into a professional, plan-aware, monetization-ready workspace. Everything
renders real backend data; nothing is hard-coded or faked.

## Critical fixes

| Bug (from the PR #45-era investigation) | Fix |
|---|---|
| `POST /recommendations/analyze` permanently 503 (snapshot dep never injected) | `f4-bootstrap.ts` now injects `buildStoreSnapshot`; analyze works end-to-end |
| "Generate recommendations" button didn't exist | Prominent **Run Analysis** button with progress state, last-run tooltip, and limit-aware disable |
| Evidence drawer always showed recommendation #1 | Per-card drawer keyed to the clicked recommendation; global drawer fallback removed |
| Plan limits defined but never enforced | `ai_recommendations_month` metered in `billing_usage`, enforced at analyze (403 UPGRADE_REQUIRED at cap, quota-trimmed generation near cap) |
| HIGH confidence mathematically unreachable | Decisions append to `ai_calibration_samples`; ledger hydrates at boot; caps track real acceptance after 10 samples |
| ROI permanently $0 | Execution bridge writes `ai_executions`; time-window attribution matcher populates `ai_attribution_events` (what `/billing/roi` sums) |
| Currency hardcoded USD; label-blind impact sums | Snapshot reads real order currency; impact sums grouped per currency, never mixed |
| STOCKOUT/PRICING/CROSS_SELL never fired (missing snapshot fields) | Velocity derived from `analytics_product_sales_daily`, unit cost from variant/inventory_item, pairs from real line-item co-occurrence |
| Enum leakage (`INVENTORY_AGENT`, `AI_UNAVAILABLE`) | Humanization layer (`packages/ai/src/labels.ts` + web mirror) with title-case fallback — no raw enums render |
| Errors swallowed into empty state | Dedicated loading skeletons / error state with retry / contextual empty states |
| Jarvis approve raced (SELECT-then-UPDATE) | Atomic `decidePending` single-statement CAS |

## Backend

- **Migration `0018_recommendation_lifecycle.sql`**: `decided_at`, `decided_by`,
  `reject_reason`, `entity_key`, `expires_at`, `snoozed_until` + expiry/list indexes.
- **New endpoints**: filtered/sorted/paginated `GET /recommendations` (page
  envelope, limit ≤ 50), `GET /recommendations/:id`, `GET /recommendations/summary`,
  `POST /recommendations/bulk-decide`, `POST /recommendations/:id/undo` (30s window),
  `POST /recommendations/:id/snooze`, `GET /recommendations/:id/evidence/verify`
  (server sha256 re-check), `POST /recommendations/:id/execute`.
- **Reject reasons** (`WRONG_DATA|NOT_RELEVANT|BAD_TIMING|ALREADY_HANDLED|OTHER`)
  feed calibration.
- **Time sensitivity**: rule-derived `expiresAt` (cart 48h window, stockout
  days-of-cover, welcome 7d, churn/repeat 14d); stale PENDING rows auto-expire.
- **RBAC**: `recommendations:approve` required to decide; owner/admin required
  for non-SAFE approvals/executions; roles read from `member_roles` (default owner).
- **Audit**: every analyze/approve/reject/undo/execute writes `audit_log`.
- **Plan limits unified**: `PLAN_ENTITLEMENT_LIMITS` in `packages/types` is the
  single source; `packages/billing` derives from it (duplicate tables removed).
- **Executor**: async ledger interface + `PostgresExecutionLedger`
  (`ai_executions`); `SEND_EMAIL` executions create reviewable draft campaign
  templates — nothing contacts customers directly.

## Frontend

- Extracted to `recommendations.tsx` (workspace + card + drawer + sheets +
  sidebar), `recommendations-model.ts` (contract, humanization, formatting,
  plan gating, routing), `recommendations.css` — following the
  orders/customers/inventory pattern.
- **KPI hero**: pending impact (per currency), approved this month, approval
  rate with trend, avg time-to-decision, monthly usage ring — all from
  `/recommendations/summary`.
- **Toolbar**: status tabs with real counts, plan-aware agent chips (locked
  agents show upgrade CTAs), sort, list/agent/rule grouping, search, date
  range, refresh with last-refreshed tooltip.
- **Cards**: humanized labels, agent icon/color, confidence meter (0–100 bar),
  impact bar scaled to page max, entity chip (masked keys, no PII), rule
  provenance, AI explanation quote + graceful AI-status badges, relative
  timestamps, expiry badges, checkbox select, ⋮ menu (snooze 1h/1d, copy link).
- **Decision UX**: Review & Approve confirmation sheet for high-risk actions
  with concrete previews; reject reason picker; optimistic single-card updates
  (no full reload); 30s undo snackbar; bulk approve/reject bar with per-item
  results.
- **Evidence drawer**: facts + source columns with copy buttons, server-side
  "Evidence verified ✓", sha256 copy, action safety previews, AI explanation
  provenance, decision trail. Deep-linkable.
- **Deep links**: hash routes `#/recommendations/:id?evidence=true` survive
  refresh and back/forward; storeId/shop stay in query params.
- **States**: skeleton loaders (KPIs, cards, sidebar), real error state with
  retry, first-run educational state (8 rules explained + Run Analysis),
  all-clear state, contextual filter-empty states, "How it works" modal with FAQ.
- **Sidebar**: pending-by-agent donut (click-to-filter), 30-day
  generated/approved trend, top rules, recent decisions feed.
- **Notification bell**: real pending-recommendation counts with per-store
  read tracking; rows deep-link to the page.

## Tests (83 new)

- `packages/ai/src/pr46-lifecycle.test.ts` (27): expiry derivation, calibration
  caps/hydration, humanization coverage, repository lifecycle
  (decide/undo/expire/snooze/filter/sort/paginate), currency-grouped summary,
  engine lifecycle fields, quota trimming.
- `apps/api/src/pr46-recommendations-api.test.ts` (27): analyze no longer 503,
  trial cap 403 + quota trim, filters/pagination/validation, deep-link fetch,
  summary usage, reject reasons + calibration + audit, undo window, bulk mixed
  results, evidence verify, snooze, RBAC matrix, execution bridge.
- `apps/api/src/store-snapshot.test.ts` (6): velocity aggregation, real
  currency, co-purchase pairs, full snapshot build.
- `apps/web/src/recommendations-model.test.ts` (19) +
  `recommendations-ui.test.tsx` (18): humanization regression (no enum
  leakage), multi-currency formatting, plan gating per tier, optimistic
  reducer, routing round-trip, card/KPI/empty/sheet/sidebar/modal rendering.

Full suite: **140 files, 1347 tests, all passing.** Full workspace build clean.

## Not in scope (honest)

- `TAG_CUSTOMER`/`CREATE_DISCOUNT` executions record reviewed drafts; applying
  them in Shopify remains manual this release.
- SSE push is not added; the existing 60s visibility-aware polling is retained.
- Store currency falls back to USD only when a store has zero synced orders.
