# PatternAI — unique charts, human discovery cards, and a real light theme

Scope: **PatternAI only.** No file outside the module was touched — AI Command Center,
Recommendations, Automation, AI Command / Copilot, Store Coach and GrowthIQ are untouched, and no
chart they own is reused here.

Files changed: `apps/web/src/patternai.tsx`, `patternai-model.ts`, `patternai-charts.tsx`,
`patternai-logo.tsx`, `patternai.css`, new `patternai-viz.tsx`, new tests, new dev harness
(`pa-verify.html` / `pa-verify.tsx`), and two docs.

---

## 1. A new Run discovery icon

`PatternAiDiscoverGlyph` — a **compass rose whose needle is a four-point discovery spark**, with two
constellation points being revealed outside the open ring. Discovery is directed exploration, so the
mark reads as orientation plus a find.

- Replaces the generic `Sparkles` (hero) and `Network` (toolbar) icons.
- Pure SVG, per-instance gradient ids, purple → cyan brand ramp through the `--pa-mark-*`
  variables, so it reads on `#0B0D14` and `#F8FAFC` alike.
- Legible at 12/14/16/24/32px, exposes a Lucide-compatible `PatternAiDiscoverIcon` wrapper.
- Used nowhere else in the app; distinct from the PatternAI brand constellation (asserted by test).

## 2. Six KPI tiles, six different micro-visualizations

The header used to be a grid of zeros. Each tile now owns a shape that exists nowhere else in the
product, and each tile is honest when empty:

| Tile | Visualization | Empty state |
| --- | --- | --- |
| Discoveries | bubble cluster (filled bubbles = findings) | dashed ghost bubbles, "waiting to populate" |
| Patterns | node web with live edges | dim web, "discovering…" |
| Personas | silhouette cohort with `+n` overflow | grey silhouettes, "analysing customers…" |
| Investigations | question mark → progress → checkmark | open check, "ask your first question" |
| Trends | arrow cluster (one tick per watched trend) | dim arrows, "monitoring…" |
| Predictions | probability wave inside its envelope | dashed flat wave, "learning…" |

Explicitly **not** used: sparklines (AI Command Center), radial progress (Recommendations/GrowthIQ),
mini bars (Recommendations), gauges / stacked / segmented bars / dot grids (Automation), trajectory
areas (GrowthIQ). A test asserts none of the six emits a `<polyline>` sparkline.

## 3. Discovery pipeline funnel (replaces the flow chart)

`DiscoveryPipelineFunnel` — a **horizontal funnel**: Discovered → Reviewed → Saved → Acted on, each
band widened to its real share, with the count, the share and a **conversion rate** underneath.
Stages are cumulative (a saved discovery has been reviewed), so the funnel narrows honestly instead
of double-counting. **Clicking a stage filters the feed.** With nothing discovered, conversion shows
`—`, never `0%` of nothing.

The old Sankey-lite `InsightsFlowChart` and the `funnelStages` helper were deleted, not left behind.

## 4. Human discovery cards

Before: *"Snowboard: Hydrogen demand jumped 100%…"*, `productId: gid://shopify/Product/42`,
`Recent Units: 3, Prior Units: 0`.

Now, the same real numbers, told like a person would:

- **Friendly headline** — "Rising product spotted" (type + category driven, contains no number, so
  the engine's sentence stays the only source of every figure).
- **Momentum bars** — a unique before/after comparison read straight from the evidence
  (`priorUnits → recentUnits`, `previous.revenue → current.revenue`, `expected → actual`,
  `one-time → repeat`), scaled to the larger side, tinted green up / rose down. Returns `null` — and
  the card simply omits the visual — when there is no measured pair.
- **"What this means for you"** — the engine's explanation, highlighted.
- **Confidence pill, category, money in play**, then Explore / Save / Acted on it / Dismiss.
- **No product ids.** Technical evidence keys (`productId`, `method`, `basedOnRealData`, …) are
  filtered out and the rest get plain-English labels ("Sold in the last 14 days").

## 5. Keep exploring — one unique mini-chart per card

| Card | Mini chart | Source |
| --- | --- | --- |
| Learning library | word cloud | real lesson categories/types |
| Pattern lab | scatter (confidence × recurrence) | real patterns |
| Customer personas | radar / spider | averaged persona traits |
| Why? explorer | root-cause web | latest investigation's ranked causes |
| Trend watcher | diverging bars around a centre line | real signed magnitudes |
| Predictions | probability wave with range | real forecast series |

Each card fetches **only** when `overview.counts` already reports data *and* the plan allows it —
so a locked or empty card costs nothing and never draws a shape without data behind it. Empty cards
show a dashed outline and an honest caption; locked cards say "Opens with a plan upgrade".

## 6. Value panels

- **What PatternAI has found** — treemap of signals per category, plus "most active category",
  "strongest insight" (highest real confidence) and total money in play (omitted entirely when the
  engine attached no impact).
- **Pattern confidence** — a horizontal strength ladder across Order evidence, Product patterns,
  Customer behaviour, Forecasting and Trend detection. Every bar is `have ÷ need` against the
  **engine's own thresholds**, and the raw counts are printed underneath (`5 of 10 orders`), so the
  meter can never promise a pattern the backend would refuse to publish.
- **Discoveries this month** — a ring drawn as dashed segments with a square cap and a two-line
  inner readout (deliberately unlike the smooth radial rings other modules use), the remaining
  allowance in words, and an "Upgrade Plan for more discoveries" link.
- **Run progress** — a three-step panel while a sweep is running, ending with the honest note that a
  quiet sweep is a valid result.

## 7. Sidebar

Colour-coded group headers (Discover / Understand / Remember & look ahead / Workspace), **count
badges straight from `overview.counts`** (nothing before the API answers), clearer lock affordance,
per-row tooltips, and a footnote explaining that locked sections open with a plan upgrade.

## 8. Light theme, properly

- Warm `#F8FAFC` canvas with **white cards** that actually sit above it: `#E2E8F0` borders and a
  real two-layer shadow, hover elevation.
- Text `#0F172A` / `#475569` / `#64748B`; kickers and accents move to the darker `#7C3AED` /
  `#0E7490` so purple-on-white stays readable (WCAG AA).
- Inputs and selects get white fills, `#CBD5E1` borders and a purple focus ring.
- Active nav row gets a purple inset rail; banners get tinted, bordered light surfaces.
- PatternAI accent family (`--pa-teal`, `--pa-indigo`, `--pa-rose`) is defined per theme, giving the
  module a different emphasis from the rest of the app.
- Every new visual paints through CSS variables — a test asserts no inline colour anywhere in the
  new components, so both themes are equally first-class.

## 9. Zero fake data — the rule, enforced

- No new component derives a metric; they render what the API returned.
- Empty means empty: ghost outlines and captions like "Forecast ranges appear here", never a
  plausible-looking placeholder chart.
- Samples keep the loud `SAMPLE` badge and the trial banner.
- Plan copy is always the generic **Upgrade Plan** — asserted absent of `Upgrade to Start/Growth/Commander`.

---

## Testing

- New `apps/web/src/patternai-functional.test.tsx` (21 tests) mounts the real workspace and drives
  every surface: header actions, funnel click-to-filter, both toolbar filters, clear filters,
  discovery sweep, save / act / dismiss, detail view, **all eleven sub-pages**, nav badges, trial
  gating, export lock, and a full re-mount inside `.light-mode`.
- New `apps/web/src/patternai-value.test.tsx` (31 tests) covers the model and every new visual,
  including the "empty must look empty" rule and the new glyph.
- Updated `patternai-model.test.ts` / `patternai-ui.test.tsx` for the funnel replacement.
- **Whole repo: 177 files, 2148 tests, all passing.** Typecheck and `pnpm --filter @profitpilot/web build` clean.
- Bugs found and fixed while testing are listed in `PATTERNAI_VALUE_FUNCTIONAL_TEST_REPORT.md` —
  including a real crash: the discovery detail view threw when a response omitted `dataEvidence`.

## Reviewing it visually

`apps/web/pa-verify.html` is a dev-only harness (same pattern as `cc-verify.html`) that renders the
real page against an in-page mock:

```
corepack pnpm --filter @profitpilot/web dev
/pa-verify.html                 # light theme, trial store (sample discovery)
/pa-verify.html?theme=dark      # dark theme
/pa-verify.html?data=growth     # populated store: full funnel, treemap, all six mini charts
/pa-verify.html?data=fresh      # brand-new store: every empty state
```

Screenshots are not included: no browser binary can be installed in this sandbox (Playwright's CDN
and the Debian mirrors are unreachable), so the harness is provided instead — it shows every state
of the page in both themes in one click.
