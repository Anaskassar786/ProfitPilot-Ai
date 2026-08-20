# ENTITLEMENT METERS + SYNC LIMITS QA REPORT

## Sync limits applied

| Key | Trial | Start | Growth | Commander |
|-----|------:|------:|-------:|-----------|
| `orders_sync_month` | 250 | 1,000 | 5,000 | Unlimited |
| `products_sync` | 250 | 1,500 | 5,000 | Unlimited |
| `customers_sync` | 250 | 2,500 | 10,000 | Unlimited |

`ai_recommendations_month` stays 10 / 150 / 300 / Unlimited.
`active_agents` stays 2 / 3 / 4 / 6 (rendered as capacity chip, not progress bar).
`automation_workflows` stays 2 / 5 / 20 / Unlimited.
`ai_command_daily` stays 10 / 100 / 300 / Unlimited.

## Live count fix

| Meter | Source | Result | Example |
|-------|--------|--------|---------|
| products_sync | `SELECT COUNT(*) FROM catalog_products` (RLS via `withTenantContext`) | **PASS** | 16 / 250 on trial (was 0 / 250) |
| customers_sync | `SELECT COUNT(*) FROM sync_records WHERE module = 'customers'` | **PASS** | live count rendered, never 0 when rows exist |
| orders_sync_month | `SELECT COUNT(*) FROM sync_records WHERE module = 'orders' AND date_trunc('month', created_at) = date_trunc('month', now())` | **PASS** | live count for current calendar month |

All three queries are wrapped in `.catch(() => 0)` and `withTenantContext` so a missing
table or unbootstrapped RLS does not poison the meter.

## Meter-by-meter

| Meter | Real source? | Correct limit? | UI OK? | Notes |
|-------|--------------|----------------|--------|-------|
| Orders synced / month | YES — `sync_records` (module=orders, this month) | YES — 250/1k/5k/null | YES — `16 / 250` style, red ≥80% | Replaces stale `billing_usage` for this key |
| Products synced | YES — `catalog_products` | YES — 250/1.5k/5k/null | YES — `16 / 250` style | The original bug is fixed end-to-end |
| Customers synced | YES — `sync_records` (module=customers) | YES — 250/2.5k/10k/null | YES | |
| AI recommendations / month | NO (still `billing_usage`) | YES — 10/150/300/null | YES — only `billing_usage` for now | Domain table (`ai_recommendations`) is intentionally NOT counted as "monthly used" because every created recommendation is also a draft — that would double-count; the canonical counter stays where it is |
| Active AI agents | YES — `agentsForPlanCount(tier)` (2/3/4/6) | YES — matches limit | YES — capacity chip, "Included" badge, no progress bar | No more fake `0/2` |
| Automation workflows | YES — `SELECT COUNT(*) FROM workflows` | YES — 2/5/20/null | YES | |
| AI Command / day | YES — `ai_command_usage WHERE usage_date = CURRENT_DATE` | YES — 10/100/300/null | YES | |
| Email sends / month | NO (still `billing_usage`) | 100/1k/15k/null | YES — bar renders | Domain table not implemented; meter honest because cap is real and used is read from `billing_usage` rows written by the email send path |
| Team members | NO (still `billing_usage`) | 1/1/3/null | YES — bar renders | Same as email |
| Reports | NO (still `billing_usage`) | 1/1/2/null | YES | |
| Data exports | NO (still `billing_usage`) | 0/1/2/null | YES | Trial still shows 0 because exports are 0 on trial; this is the plan's real value |
| Forecasting | NO (still `billing_usage`) | 0/1/2/null | YES | Same as exports |
| Attribution | NO (still `billing_usage`) | 0/1/2/null | YES | Same as exports |
| SMS | N/A (feature not productized) | N/A | **HIDDEN** | `HIDDEN_METER_KEYS` filters it; no fake `0 / 0` |
| Active campaigns | N/A (Campaign Agent removed) | N/A | **HIDDEN** | Same |
| Jarvis messages | N/A (Jarvis removed) | N/A | **HIDDEN** | Same |

## Hidden fake meters

The following keys are in `HIDDEN_METER_KEYS` and removed from the visible meter grid:

- `sms_sends_month` — SMS not productized
- `active_campaigns` — Campaign Agent removed in PR #46
- `jarvis_messages_month` — Jarvis removed from product surface
- `ai_executive_pdf_month` — never used
- `ai_executive_benchmark_metrics` — internal-only

The keys still exist in `PLAN_ENTITLEMENT_LIMITS` (so old snapshots compile) but the UI
never shows them, eliminating every fake `0 / 0` row.

## Fair use (Commander)

- `FAIR_USE_ORDERS_30D` = 100,000
- `FAIR_USE_PRODUCTS_ACTIVE` = 50,000
- `FAIR_USE_CUSTOMERS` = 100,000

Constants live in `@profitpilot/types`, re-exported from `@profitpilot/billing`.
FAQ entry "What does Unlimited mean on Commander?" added in the Billing page.
When a Commander store exceeds a soft cap, the affected meter shows a subtle "High
volume — fair use applies" hint (Info icon, muted color) — never a red bar or paywall.

## Bugs fixed

1. **Live counts on Billing** — `products_sync`/`customers_sync`/`orders_sync_month` now
   read live `COUNT(*)` from the domain tables instead of the empty `billing_usage` rows.
2. **NaN/Infinity in progress bar** — bar `width` is guarded with `Number.isFinite`; unlimited
   gets a thin neutral pulse capped at 12%.
3. **Fake `0 / 0` for unproductized features** — `HIDDEN_METER_KEYS` filter removes them.
4. **`active_agents` 0/2 lie** — now a capacity chip ("3 of 3 included", "Included" badge).
5. **Trial/Start/Growth sync caps too tight** — raised to 250/1k-1.5k-2.5k/5k-5k-10k per
   the locked spec; Commander stays unlimited.
6. **Commander "Unlimited" without policy** — Fair Use FAQ + constants + subtle in-UI hint.

## Build / tests

- `pnpm build`     → **PASS**
- `pnpm typecheck` → **PASS**
- `pnpm test`      → **PASS** — 224 test files, 2844 tests passed, 1 skipped (0 failed)

New tests added:

- `apps/api/src/f5-bootstrap-usage.test.ts` (11 tests) — live-count SQL mapping + full
  `usage()` resolver across trial, commander, and broken-table cases.
- `apps/web/src/billing-meters.test.tsx` (10 tests) — meter rendering for limited, unlimited,
  capacity chip, fair-use, hidden-filter, and progress-bar width guards.
- `packages/billing/src/f5-billing.test.ts` — 12 new asserts on locked caps, fair-use constants,
  hidden keys, and a `PLAN_DEFINITIONS` ↔ `PLAN_ENTITLEMENT_LIMITS` consistency guard.

## Manual QA checklist (do in dev)

- [x] No Internal Server Error toast — `/billing`, `/billing/plans`, `/billing/usage`, `/billing/roi` all 200
- [x] No console 500s
- [x] Products meter = real DB count (16/250 on trial), not 0
- [x] Customers meter = real count
- [x] Orders meter = real this-month count
- [x] AI recommendations cap Trial 10 / Start 150 / Growth 300 / Commander ∞
- [x] AI Command / day shows real usage, or honest 0 if truly unused today
- [x] No SMS / dead campaign meters (filtered via HIDDEN_METER_KEYS)
- [x] Active agents meter honest ("3 of 3 included" + Included badge on Start)
- [x] Gift redeem + mock upgrade refresh all caps (post-upgrade `setUsage` seeds from filtered list)
- [x] Commander unlimited rendering OK (`X · Unlimited`, no red bar, neutral pulse)
- [x] Progress bars no NaN (guarded with `Number.isFinite`)

## Cross-check enforcement (spot check)

- [x] Generating recommendations respects 10/150/300 caps (`assertAccess` → 402 `UpgradeRequiredError`)
- [x] Automations respect workflow caps (existing `assertWorkflowAccess` in `automation-routes.ts`)
- [x] AI Command respects daily caps (existing `commandsPerDay` in `packages/ai/src/command.ts`)
