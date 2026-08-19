# PR — Professional upgrade: Store Coach Week in Review, GrowthIQ Trajectory, PatternAI hero tiles

Three independent, professional upgrades requested by the merchant — each one
is data-honest (real synced figures only, nothing invented).

---

## 1. Store Coach — "Your Week in Review" right column (was empty)

The Weekly Review card previously read as a single tall column that felt empty
on the right. It is now a **two-column card**.

- **Left column:** Week highlights + Metrics vs last week (unchanged value).
- **Right column (new — never empty):**
  - **"Your week in numbers"** — a real, deterministic snapshot attached by the
    server on every review generation: 7-day revenue (+% vs prior 7),
    7-day orders (+%), 30-day AOV, best single day, yesterday's new customers,
    and the current huddle streak. Sourced from the store's own synced
    evidence (`store-coach-service.ts`), *not* from the AI narrative, and
    labelled "Real figures from your synced store — never estimated."
  - Key learnings + Next week's focus (moved alongside the snapshot).
- Suggested goal and the email/PDF actions stay full-width below the two
  columns.
- Responsive: the two columns collapse to a single stack on narrow screens.
- Backwards compatible: older saved reviews without a snapshot still render
  fine (defensive parser `reviewSnapshot` returns null → panel is skipped,
  the right column keeps learnings/focus).

**Server:** `apps/api/src/store-coach-service.ts` — attaches a real `snapshot`
block to every generated weekly review.
**Web:** `store-coach-model.ts` (type + parser), `store-coach.tsx`
(two-column card + `ReviewSnapshotPanel`), `store-coach.css`.

## 2. GrowthIQ — "Your business trajectory" chart → Slope / projection-cone

The old daily area + dashed projection chart is replaced with a new, novel
**slope / projection-cone chart** (`ExecutiveSlopeChart`) that reads
professionally at a glance:

- Two real anchors: the **current 30-day run-rate** and the **projected
  next-30 revenue**, joined by a slope whose angle and colour (green
  growing / red declining / neutral stable) show direction instantly.
- A **confidence whisker** on the projected point drawn from the projection's
  own real band (low–high) — uncertainty is visible, never hidden.
- Compact money y-axis, reference guides for "LAST 30 DAYS" / "NEXT 30 DAYS",
  an arrowhead along the slope, and a growth % badge.
- A legend separating Current run-rate / Projected next 30 / Likely range.
- No invented numbers: everything flows from the existing
  `TrajectoryProjection` computed from synced days.

**Web:** `executive-charts.tsx` (new `ExecutiveSlopeChart` + `SlopeChartDatum`),
`growthiq-sections.tsx` (wired into the trajectory section, note updated),
`executive.css`.

## 3. PatternAI — hero tiles get real trend visuals

The six hero tiles (Discoveries / Patterns / Personas / Investigations /
Trends / Predictions) previously rendered static decorative shapes and looked
empty ("just a zero") on fresh stores.

- The **server now computes a real 8-week activity trend** for each hero
  metric from stored entity timestamps (`discoveredAt`, `firstDetected`,
  `generatedAt`, `createdAt`, `detectedAt`, `createdAt`) and returns it in the
  overview as `countsTrends`.
- Each tile now draws a **real weekly activity strip** (`StatTrendStrip`) with
  a rising / falling / steady direction badge — "bataaye ye badh rahi hai ya
  ghat rahi hai" — built purely from those real counts.
- When there is no activity yet it draws a level baseline and honestly says
  "no activity yet" instead of a fake up/down.
- The six unique PatternAI micro-visualizations remain as a graceful fallback
  for older payloads (no trend field).

**API:** `insights-hub.ts` (`InsightCountTrend`, `buildInsightTrend`, overview
`countsTrends`).
**Web:** `patternai-model.ts` (`InsightCountTrend`, `trendDirection`, trend in
`PatternAiStat`/`patternAiStats`), `patternai-viz.tsx` (`StatTrendStrip`),
`patternai.tsx`, `patternai.css`.

---

## Honesty guarantee
Every number shown across all three changes is a real value computed from the
store's own synced data (evidence snapshot, trajectory projection, or stored
entity timestamps). No fake/placeholder metrics are introduced anywhere.

## Tests
- Added: `ExecutiveSlopeChart` tests (`growthiq-chart.test.tsx`), slope render
  assertions (`growthiq-sections.test.tsx`), `StatTrendStrip` + `trendDirection`
  tests (`patternai-value.test.tsx`), `buildInsightTrend` tests
  (`insights-hub-routes.test.ts`).
- Updated: `growthiq-mount.test.tsx` / `growthiq-sections.test.tsx` trajectory
  assertions to the new slope chart.
- Relevant suites green: `insights-hub-routes` (52), `store-coach-*`
  routes/sweep (27), full `apps/web` suite (1179 passing).

> Note: `apps/web/src/analytics-ui.test.ts` (one assertion about `label="Sort"`
> in analytics source) fails on this branch too — it is unrelated to this PR
> (analytics files were not touched).
