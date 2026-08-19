# PR — Recommendations: Professional Overview Redesign & Activity Chart

Polish pass on the Recommendations workspace (Overview KPI hero + Insights
sidebar), following the same "real data, no invented numbers" contract as the
rest of the page. Every metric shown comes from `GET /recommendations/summary`;
the visualizations only reshape what the API already returns.

Design was proposed and approved via mockups first (see `mockups/out/`),
then implemented in the live components.

## Overview — 5 KPI cards, one unique identity each

| Card | Before | After |
|---|---|---|
| **Revenue opportunity pending** | Tiny 10px label + cramped 118px card | Hero card: gradient accent edge, larger value, pending-count inside the ring, footer strip — "Across N teammates" + agent-tinted share bar + legend (real `byAgent` pending counts) |
| **Approved this month** | Green bars that turned purple on hover — no axis, confusing accent | Single green identity: modeled-impact pill, weekly bars with day letters (M T W T F S S), and a month-progress strip ("AUGUST · DAY 19 — 61% of month elapsed", computed from the merchant's local clock) |
| **Approval rate** | 71.4% glued to the caption/progress bar, marker hard against the zones | Breathing room: value + delta pill ("▲ 4.2% vs all-time" — real last-30d vs all-time math), green fill under the current rate, floating circular marker, 80% target notch, Low/Medium/Good captions |
| **Avg time to decide** | Tiny 96px gauge, no scale, detached "FAST" label | Threshold legend (Fast <1h · OK 1–4h · Slow >4h) under the gauge |
| **Monthly usage** | Old-style card | Aligned to the same icon-chip header anatomy |

Shared anatomy: every card now uses an icon chip + bold label header, a big
mono value, an honest caption, and a card-specific footer visual.

## Insights sidebar — "Your Activity Timeline" → analytics-style area chart

- Replaces the 30 stacked micro-bars with a real area chart: purple gradient
  **Found** + green **Approved** line, dashed gridlines, real date labels
  (Aug 1 … Aug 19), hover titles per day.
- Adds a conversion stat to the metrics strip: `found · approved · X% conversion`.
- Pure inline SVG — SSR-safe (works with `renderToStaticMarkup`), no new
  dependency. Empty state ("see sample activity") unchanged.

## Files changed

- `apps/web/src/recommendations.tsx` — KpiHero redesign, new
  `ActivityAreaChart`, `dayOfWeekCode`, `agentShortName`, `formatRateDelta`.
- `apps/web/src/recommendations.css` — new card anatomy + light-mode overrides.
- `apps/web/src/recommendations-ui.test.tsx` — 5 new tests (hero foot, delta
  pill up/down incl. fractional rates, 80% target notch, area chart + conversion).
- `mockups/` — approved design mockups (PNG), the generator, and a live
  preview HTML (real components + real CSS, mock data).

## Verification

- Full suite: **2694/2694 tests pass** (213 files) — includes a11y suite.
- `tsc -p apps/web/tsconfig.json --noEmit` clean for recommendations files.
- `vite build` succeeds.
- API untouched — endpoints (`summary`, `analyze`, `approve`, `reject`,
  `undo`, `snooze`, `bulk-decide`, `evidence/verify`, `execute`) all verified
  working in the audit preceding this change.
