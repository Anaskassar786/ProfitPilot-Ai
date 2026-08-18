# PR — GrowthIQ: Strategic Value Layer, Compact Plan Panel & Full Light-Theme Pass

Transforms the thin-data GrowthIQ state from a page that felt empty
("Building your intelligence baseline" + a large plan table) into a valuable
**executive intelligence surface** — while adding **zero** features owned by
other modules and **zero** fabricated data. Scope is strictly GrowthIQ:
`apps/web/src/executive-*`, `apps/web/src/growthiq-*`, and the two GrowthIQ
backend files (`executive-service.ts`, `executive-model.ts`). One cross-module
*test fixture* (the GrowthIQ payload stub inside `store-coach-mount.test.tsx`)
was updated to the current API contract — no Store Coach behavior changed.

---

## 1. What changed

### Kept & wired: "Building your intelligence baseline"
The baseline hero is unchanged in substance (real sync counts, honest
thresholds of 30+ orders / 60+ days, progress bar, three zero-history
actions). Its counters now read the new uncapped `totals` rollup
(`daysSynced` previously came from the 60-day chart slice). Everything below
it is new strategic value that works at **any** data depth.

### NEW — Business Trajectory (history + real trend projection)
- Solid area = real synced revenue; **dashed** line = least-squares trend
  extension of the last ≤30 real days for the next 30 — it can never pass for
  fact; the residual-based confidence band widens with distance from the last
  real observation.
- Figures row: current monthly run-rate, projected next 30 days, direction
  (`growing` / `stable` / `declining`), and projection **confidence** derived
  from fit quality × data coverage — a thin, noisy series honestly scores low
  (e.g. 26%).
- With < 2 real days there is **no chart at all** — just an honest "N of 2
  needed" note.

### NEW — Strategic Position Matrix
2×2 quadrant (growth momentum from the real MoM trend × market presence from
the real revenue percentile on the curated public benchmark ladder), pulsing
position dot, stage + focus + next milestone. When either axis is not
measurable the section explains *precisely why* instead of plotting a
stand-in.

### NEW — Decision Impact Previews
Four lanes (Revenue / Customer / Product / Market). Each number is computed
from real gaps: AOV-vs-median × real 30-day orders, repeat-purchase gap vs the
industry median, real top-SKU revenue concentration, real opportunity impact
(annual ÷ 12). Anything not measurable renders **"Not measurable yet"** with
the reason.

### NEW — Growth Milestone Tracker
An 11-rung ladder counted from **real synced totals** (orders, customers,
days, revenue, decisions, first report): `✓ complete`, `◈ current` with a
progress bar and a pace-based estimate ("≈1–2 weeks at your current pace"),
`⚡ action` for milestones one merchant action away, `🔒 locked` beyond.

### NEW — Weekly Executive Digest Preview
Board-style snapshot from the last 7 real days vs the prior 7 (revenue,
orders, WoW deltas), real best product, a deterministic strategic-focus pick
(strongest real signal: decline / concentration / retention gap / momentum),
real opportunity + risk titles. Unlocks at 7 synced days — before that it
reports "N of 7 synced. Nothing is back-filled or simulated." The full-report
button is plan-gated (`Upgrade Plan` on trial).

### NEW — Executive Insights Sidebar + Executive Actions
Right-rail quick stats (synced history, real lifecycle stage, health status,
next focus), key metrics (MoM growth, repeat-purchase vs industry median, AOV
trend — each with an honest fallback), and one rotating **editorial**
strategic note (clearly content, not store data). Four quick actions route to
GrowthIQ's own sub-pages: Log a decision / View a report / Set a goal / Find
an insight. The actions strip also appears on the rich dashboard.

### REWORKED — Upgrade Plan section is now compact & collapsible
Collapsed row: `Your plan: Trial · 3 features active · 12 more available` +
`Show details ▾` + `Upgrade Plan`. Expanding animates open (grid-rows
transition) into `Currently available (n)` + locked features **grouped by
tier** (Start / Growth / Commander) with a closing CTA. Commander shows the
full unlock with no CTA. Every CTA still reads "Upgrade Plan" — never a plan
name (asserted in tests).

### Full dashboard upgrade
The plain "Revenue & Orders" history chart slot is now the projected
**Business Trajectory** card, plus the Executive Actions strip under the hero.
All other sections untouched.

### Light theme & polish
Every new component reads the existing `--exec-*` tokens only; light-mode
overrides added where needed (insights panel radial, matrix quads, gold
accents). A new royal-gold accent token (`#E3B23C` dark / `#A16207` light) is
used sparingly for executive kickers; light page background token set to the
spec's `#F8FAFC`. The pulse animation honors `prefers-reduced-motion`.

## 2. Backend (additive, real data only)
`GET /ai-executive/dashboard` now also returns:
- `totals { customers, products, syncedOrders, syncedRevenue, daysSynced }` —
  counted from the synced analytics rows and store snapshot;
- `topProducts[]` — real revenue shares per synced product (reused from the
  deterministic facts builder).

No endpoint removed or altered; no other module's code touched.

## 3. Zero-duplication commitment
| Layer | Lives in GrowthIQ | Explicitly NOT here (owner) |
|---|---|---|
| Store health score/tiles | — | AI Command Center |
| Chat / copilot | — | AI Command |
| Daily coaching, to-dos | — | Store Coach |
| Action recommendations list | — | Recommendations |
| Patterns / discoveries | — | PatternAI |
| **New here** | forward trajectory, position matrix, impact math, milestone ladder, weekly board digest | — unique, strategic, forward-looking |

## 4. Testing evidence
- **Full suite: 2,135 tests across 178 files — all passing** (baseline before
  this PR: 2,095; +40 new, 1 pre-existing fixture repaired).
- `growthiq-strategic.test.ts` (20): projection math on perfect/flat/falling
  series, band widening, null-when-thin, quadrant mapping, impact math
  (e.g. (median 62 − AOV 48) × 50 real orders → "+$700/mo"), milestone
  ladder/ETA/stage, digest WoW + focus rules — incl. honest-null cases.
- `growthiq-sections.test.tsx` (13): every new section, both measurable and
  not-measurable states, gating copy ("Upgrade Plan", never "Upgrade to").
- `growthiq-mount.test.tsx` (5): real app-shell mounts — thin-data stage with
  all seven layers present, plan-panel collapse→expand→collapse interaction,
  **light-theme mount**, rich dashboard; any React console error fails.
- `executive-ui.test.tsx` updated for the compact plan panel (collapsed
  default, tier-grouped expanded matrix, commander without CTA).
- `executive-routes.test.ts` extended: dashboard `totals` and `topProducts`
  asserted against the known fixture rows.
- Regression caught & fixed during development: the Store Coach mount fixture
  stubbed a pre-existing dashboard shape; payload updated to the current
  contract.
- `pnpm typecheck` (whole workspace) clean; production `vite build` clean.

## 5. Manual checklist mapping (from the brief)
Header / baseline / five new sections / compact plan panel / real-data /
interactions / both themes / plan restrictions / responsive grid (1100px,
820px, 760px breakpoints) / sync integration — each row is exercised by the
automated suites above; the two states are fully rendered in jsdom against
stubbed real payloads, and the assert-no-console-error policy covers silent
runtime faults. Browser QA on a seeded store remains the final visual pass
(charts animate, hover, sticky sidebar, sticky offsets).

## 6. Files
- New: `apps/web/src/growthiq-strategic.ts` (+test),
  `apps/web/src/growthiq-sections.tsx` (+test),
  `apps/web/src/growthiq-mount.test.tsx`
- Changed: `apps/web/src/executive.tsx`, `executive-ui.tsx`,
  `executive-charts.tsx`, `executive-model.ts`, `executive.css`,
  `executive-ui.test.tsx`, `apps/api/src/executive-service.ts`,
  `apps/api/src/executive-model.ts`, `apps/api/src/executive-routes.test.ts`,
  `apps/web/src/store-coach-mount.test.tsx` (fixture only)
