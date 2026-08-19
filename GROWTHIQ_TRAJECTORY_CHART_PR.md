# GrowthIQ — professional trajectory chart (Revenue: last 30 days vs the next 30)

## What changed

The GrowthIQ trajectory chart now reads like a real analytics chart instead of a
sketch, with **zero changes to data or math** — `growthiq-strategic.ts` (the
least-squares trend, residual band, and honesty contract) is untouched.

### Chart upgrades (`ExecutiveTrajectoryChart`)

- **Labeled Y axis** — compact currency ticks ($2.5K · ₹1.2L) on a nice-value
  scale (1/2/2.5/5×10^k steps), dashed gridlines, zero baseline. Revenue axes
  start at 0 so the projection can never visually exaggerate growth.
- **Labeled X axis** — weekly date ticks spanning real history into the
  projection (Jul 21 → Sep 18).
- **"Today" marker** — labeled divider pill + subtly shaded future zone, so
  "last 30 days vs the next 30" reads instantly.
- **Legend chips** — `Real revenue` · `Trend projection` (dashed swatch) ·
  `Likely range` (band swatch). Solid = fact, dashed = trend stays unmistakable.
- **Crisp rendering** — the SVG renders at its measured pixel width
  (ResizeObserver) instead of a stretched 760px viewBox, so dots stay round and
  strokes stay 2px at every card width.
- **Richer tooltip** — clamped to the chart edges, shows `Real`/`Projected`,
  value/day, full date, and the honest likely range for projected days
  (`range $6,283 – $8,554`).
- **Polish** — refined gradients (band fades toward the horizon), soft plot
  entrance animation disabled under `prefers-reduced-motion`, tabular-num axis
  text, full dark + light theme support via existing `--exec-*` tokens.

### Files

- `apps/web/src/executive-charts.tsx` — axis system (nice scale, compact money,
  short day formatters exported and tested), generalized
  `buildTrajectoryHoverPoints` (new optional `padEnd`/`yMax`; defaults
  unchanged), rewritten chart renderer.
- `apps/web/src/executive.css` — axis/legend/today-pill/tooltip-range styles +
  light-mode overrides (all `.app-shell.light-mode`-scoped).
- `apps/web/src/growthiq-sections.tsx` — passes `currency` so axis ticks format
  in the store's currency.
- `apps/web/src/growthiq-chart.test.tsx` — new axis/legend/Today markup tests,
  axis formatter unit tests, likely-range tooltip assertion.

## What did NOT change

- No fake data, no new estimates: every number still comes from the real synced
  payload through the same derivations. Not-measurable states still render the
  honest education fallback.
- The section's title, note, and figures (run-rate, projected 30-day total,
  confidence) are unchanged.
- All 1,145 web tests pass; typecheck clean.
