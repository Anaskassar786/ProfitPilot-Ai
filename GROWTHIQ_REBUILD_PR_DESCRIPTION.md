# PR — GrowthIQ: Complete Rebuild & Ultra-Professional Redesign (formerly "AI Executive")

Rebrands and rebuilds the AI Executive module as **GrowthIQ — "Intelligent
growth for ambitious merchants"**: fixes the production "Internal server
error" that made the page unloadable, adds a new growth-arrow + neural logo,
an intelligence-purple design system with a flawless light theme, honest
first-run states, and plan-based feature display — while keeping the
`/ai-executive/*` API namespace and `0022_ai_executive` tables untouched for
backend compatibility. Scope is GrowthIQ-only; no other module's behavior
changed (one label in the AI Command Center's "upcoming modules" list was
renamed to match the new brand).

---

## 🚨 Critical bugs fixed (reproduced against real Postgres)

### 1. Dashboard 500 — `pg` returns `date` columns as `Date` objects (THE crash)
`AnalyticsSnapshot.day` is typed `string`, but the `pg` driver deserializes
`date` columns into JS `Date` objects. `monthlySeasonality()` called
`row.day.slice(0, 7)` → `TypeError: row.day.slice is not a function` →
500 "Internal server error" on **every** dashboard load in production
(unit tests never caught it because they build snapshots with string days).

- **Root fix** — `packages/db/src/analytics.ts`: new exported `dayLabel()`
  normalizes `Date`/string/ISO inputs to canonical `YYYY-MM-DD` at the
  repository boundary (`PostgresAnalyticsRepository.read`), so the snapshot
  finally matches its declared type for **every** consumer.
- **Defense in depth** — `executive-analytics.ts`: all day-window filters and
  the former crash site now go through a local `dayLabel()`.
- **Silent data corruption fixed** — `store-snapshot.ts`: 30/120-day window
  comparisons (`row.day >= last30`) coerced `Date >= string` to NaN and
  **silently produced zero** for last-30 revenue/orders in production,
  zeroing health inputs and hero stats. Now normalized.
- **Report/decision/roadmap dates restored** — `executive-repository.ts`
  mapped `date` columns through `asString()`, which blanked them to `''` in
  production (empty report periods, blank decision dates). Now `dayLabel()`.
- **Regression tests** — `packages/db/src/analytics.test.ts` reproduces the
  exact pg `Date` behavior and asserts the string contract, plus `dayLabel`
  unit coverage.

### 2. SPA blanked by CORS — same-origin requests rejected with 403
`corsMiddleware` rejected **any** request carrying an `Origin` header not in
the allowlist — including same-origin subresource loads. Browser builds that
send `Origin` on same-origin CSS/JS requests (observed with headless shells)
got 403 JSON instead of assets → the entire SPA (and GrowthIQ) rendered
blank/`"Internal server error"`. Reproduced end-to-end: assets 403, page
all-white.

- **Fix** — `apps/api/src/security.ts`: same-origin requests (Origin ==
  scheme://host of the request, `x-forwarded-proto`-aware) are no longer
  subject to the cross-origin allowlist — standard CORS semantics.
  Cross-origin requests still require the allowlist; verified both ways with
  new tests (`CORS origin handling` in `security.test.ts`).

### 3. Sub-pages unreachable — off-by-one hash router (latent since PR #49)
The original router indexed `routeParts[1]` on routes shaped like
`/ai-growth-command/executive/reports`, which resolves to the module prefix —
so `page` could never equal `'reports'`/`'health'`/etc. Deep links
**and** in-app navigation fell through to the dashboard; none of the 8
sub-pages were reachable.

- **Fix** — `executive.tsx`: route state is now the **sub-route**
  (`/reports`, `/reports/:id`, …), derived directly from the prefix, with
  `page = parts[0]`, `detailId = parts[1]`. Legacy
  `#/ai-growth-command/executive…` deep links normalize to the new
  `#/ai-growth-command/growthiq…` route.

### 4. Commander benchmark cap — `?? 3` swallowed "unlimited"
`ai_executive_benchmark_metrics` is `null` (unlimited) for Commander, but
three call sites used `gates.benchmarks?.limit ?? 3`, silently capping the
top tier to **3 of 7** metrics on the dashboard, benchmarks page, and
benchmarks endpoint.

- **Fix** — `executive-service.ts` + `executive-routes.ts` (both benchmark
  endpoints): `null`/`undefined` limit → all ladders; numeric limits are
  clamped to the ladder count. Verified live: Commander 7/7, Trial 3/7.

### 5. Rendering bug — JSX inside a template literal
The hero "Health score" metric embedded `<small>…</small>` inside a
template string, so the tag rendered as literal text. Now real JSX children
with token-based styling.

---

## 🏷️ Complete GrowthIQ rebrand

- **Name everywhere** — page title, sidebar, breadcrumbs, tab, dashboard
  header, PDF metadata/branding, email copy, API error/log messages, docs.
  Tagline: *"Intelligent growth for ambitious merchants"*.
- **Route** — `/ai-growth-command/growthiq` is canonical;
  `/ai-growth-command/executive` (path) and `#/ai-growth-command/executive…`
  (hash) keep working for bookmarks, shared links, and emailed reports.
- **Logo** — new SVG mark (`growthiq-logo.tsx`): upward growth arrow woven
  through neural-network nodes on the purple signature gradient
  (#8B5CF6 → #6366F1), `useId`-safe gradients, accessible (`role="img"`,
  `aria-label`), renders at 16–48px. Replaces the bank-like 🏛️/Landmark icon
  in the sidebar, tabs, header, and empty states.
- **Design system** — `executive.css` rewritten to the spec palette:
  - Dark: `#0A0B14` bg · `#14161F` cards · `#1D1F2B` elevated · `#2A2D3A`
    borders · `#F8FAFC`/`#94A3B8` text · `#8B5CF6` purple · `#3B82F6` blue
  - Light: `#FAFBFC` bg · `#FFFFFF` cards + `0 1px 3px` shadows · `#F1F5F9`
    elevated · `#E2E8F0` borders · `#0F172A`/`#475569` text · `#7C3AED` purple
  - Inter throughout (serif removed), 12px+ type, 12px card radii,
    purple-gradient primary buttons, theme-adaptive charts/pills/gauges.
- **New dashboard** — GrowthIQ header (logo + tagline + Generate Report),
  executive-summary hero with real 30-day KPIs (revenue, orders, AOV, health
  score with MoM deltas), strategic health gauge + vitals, industry position
  percentiles, opportunities, risk radar, trajectory, scenarios, roadmap,
  decisions, board-report card (View + Download PDF on Commander), plan
  panel, and usage meters.
- **Educational first-run states (zero fake data)** —
  - *Welcome to GrowthIQ* (no synced history yet): capability grid +
    "Explore a sample report" / "Sync store data".
  - *Building your intelligence baseline* (thin history): **real** sync
    counts (e.g. "11 of 30+ synced orders", "6 of 60+ days") with a progress
    bar and zero-history actions (log a decision, view a sample, sync).
- **Plan-based feature display** — "Your plan: X" panel listing exactly what
  the plan unlocks vs. what higher plans add (descriptive tier hints allowed;
  every CTA still reads **"Upgrade Plan"** — never "Upgrade to <plan>").
- **Docs** — `docs/AI_EXECUTIVE.md` → `docs/GROWTHIQ.md` (rebrand + rebuild
  notes + updated troubleshooting); README module section rewritten.

---

## ✅ Verification

- **Full suite: 172 files / 1,876 tests passing** (was 1,865; +11 new:
  2 date-normalization regressions, 3 CORS, 6 GrowthIQ component tests).
- `pnpm -r build` + `pnpm -r typecheck` clean (strict, `exactOptionalPropertyTypes`).
- **Live end-to-end against a real Postgres** (all migrations 0001–0024
  applied, 3 seeded stores):
  - Dashboard 200 with real data (previously 500 `row.day.slice is not a
    function`); report periods / decision dates render (previously blank).
  - All executive endpoints exercised: health diagnose, risk scan,
    opportunities, report generate, scenario, roadmap, decision, PDF
    job → COMPLETED → 17.9 KB PDF download.
  - Plan gating: Growth → 402 on PDF with upgrade context; Commander → PDF
    allowed; benchmarks 7/7 Commander vs 3/7 Trial.
  - SPA: assets 200 with same-origin `Origin` header (previously 403);
    sub-page deep links render their pages (previously dashboard);
    legacy `#/ai-growth-command/executive/reports` deep link works.
- **Screenshots** in `docs/screenshots/` (headless Chromium, real seeded
  data, final build): dashboard dark/light, sidebar, welcome state,
  baseline state, benchmarks (Commander 7/7), reports, health, scenarios.

## 📦 Files

| Area | Files |
|---|---|
| Crash + data fixes | `packages/db/src/analytics{,.test}.ts`, `apps/api/src/{store-snapshot,executive-analytics,executive-repository,executive-service,executive-routes}.ts` |
| CORS fix | `apps/api/src/security{,.test}.ts` |
| Rebrand (frontend) | `apps/web/src/{executive.tsx,executive.css,executive-ui.tsx,executive-api.ts,executive-model.ts,executive-charts.tsx,executive-settings.tsx,growthiq-logo.tsx (new),App.tsx,command-center-model.ts}` |
| Rebrand (API copy) | `apps/api/src/{executive-ai,executive-bootstrap,executive-email,executive-pdf,executive-model,main}.ts` |
| Tests | `apps/web/src/{executive-ui.test.tsx,store-coach-mount.test.tsx,command-center-ui.test.ts}`, `packages/db/src/analytics.test.ts`, `apps/api/src/security.test.ts` |
| Docs | `docs/GROWTHIQ.md` (new), `docs/AI_EXECUTIVE.md` (removed), `README.md` |
| Screenshots | `docs/screenshots/growthiq-*.png` (9) |

## 📌 Note on a pre-existing typecheck failure on `main`

After merging current `main` (PR #63/#65, the PatternAI rebrand),
`@profitpilot/api typecheck` reports 3 TS2367 errors in
`apps/api/src/ai-command-runtime.ts` (action/tool name comparisons with no
overlap). That file is byte-identical to `origin/main` — the inconsistency
was introduced by the PatternAI PR's changes to the `@profitpilot/ai` command
types, not by this PR (which never touches AI Command). Vitest (esbuild, no
typecheck) is unaffected: **all 1,957 tests pass**. Left in place per this
PR's scope (GrowthIQ-only); flagged so it can be fixed in an AI Command PR.

## ⚠️ Intentionally unchanged

- `/ai-executive/*` API paths, `ai_executive_*` table names, migration
  `0022_ai_executive.sql`, entitlement keys, and plan matrix (per spec:
  rebrand is UI-level; backend stays compatible).
- No other module touched (Store Coach, Insights Hub, AI Command Center,
  Recommendations, Automation, AI Command all unmodified behaviorally).
- No fake data anywhere — samples are clearly labeled previews; empty
  states show real sync counts.
