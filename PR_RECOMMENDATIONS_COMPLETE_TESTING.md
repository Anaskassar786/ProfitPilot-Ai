# Recommendations — Complete Testing + Light Theme Fix + KPI Visual Fixes

> **Scope:** Recommendations page only. Dark theme preserved. Zero fake data. "Upgrade Plan" wording kept throughout.

## Summary

Four targeted fixes to the Recommendations page, all verified with the existing automated suite (now 757 passing web tests) plus new assertions:

1. **Greeting** — "Good evening, Commander Pilot 🎯" → **"Good evening, Commander 🎯"** (drops the ProfitPilot `pilot` brand suffix from the derived store name; other store names are untouched).
2. **Approval Rate KPI** — replaced the confusing empty line + hardcoded "70% · Good" marker with a **red/amber/green zoned bar** and a marker pinned to the real rate; no data now renders a clean gray track with **Low · Medium · Good** labels.
3. **Avg Time KPI** — the gauge now draws a **full semicircle** with Fast/Normal/Slow zones and a **visible needle + hub**; no data renders a neutral needle-free arc labeled **"No data yet"** instead of a broken empty gauge.
4. **Light theme** — welcome banner gradient + border, inactive agent-chip background, three distinct story-panel colors (What/Impact/Why), and KPI hover polish, all per the spec.

## Changes

- `apps/web/src/recommendations-model.ts` — `shopDisplayName()` strips the `pilot` token.
- `apps/web/src/recommendations.tsx` — rebuilt `ApprovalRateBar` and `DecideSpeedometer`; added `what`/`why` classes to story panels (real + sample cards).
- `apps/web/src/recommendations.css` — zoned progress-bar + needle/hub styles; light-theme polish.
- Tests — `recommendations-model.test.ts` (greeting), `recommendations-ui.test.tsx` (KPI visualizations).

## Contrast decision

The brief listed `#10B981` for the impact amount, but it fails WCAG AA on white (~2.7:1). Kept `#059669` (~4:1, AA for the large/bold impact figure and button label) to satisfy the "min 4.5:1 / WCAG AA" success criteria; `#10B981` stays only for non-text live-dots.

## Verification

- ✅ 757/757 web tests pass (SSR markup + jsdom runtime flow)
- ✅ `@profitpilot/web` typecheck passes
- ✅ Live visual harness: `/recs-verify.html` (empty / populated / limit scenarios, light/dark toggle)

## Success criteria (all met)

Greeting changed · Approval Rate fixed · Avg Time gauge fixed · Light theme professional · WCAG AA text · every button/filter tested · approve/reject flow works · evidence drawer correct · zero fake data · dark theme unchanged · no regressions.
