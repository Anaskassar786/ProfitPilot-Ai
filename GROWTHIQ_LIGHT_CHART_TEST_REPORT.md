# GrowthIQ — Light Theme, Chart Hover & Functional Test Report

Scope is GrowthIQ only. Dark theme tokens were not rewritten. All figures
come from the dashboard payload / least-squares projection — nothing is
invented in the UI.

## Bugs found and fixed

1. **Revenue trajectory chart had no hover layer.** The SVG rendered the
   solid line, dashed projection, and confidence band, but never tracked the
   pointer, so tooltips were impossible. Fixed with a full-plot hit target,
   a following vertical cursor, a highlighted data point, and a themed
   tooltip (date · revenue · Real / Projected). Pointer + mouse + touch.
2. **Light theme was washed out.** Impact cards, figure tiles, action cards,
   and the insights rail used muted `--exec-surface-2` fills and faint
   shadows. Light-only overrides now force `#FFFFFF` cards, `#E2E8F0`
   borders, `#0F172A` / `#475569` ink, `#7C3AED` kickers/links, and a
   visible `#7C3AED` header badge + Generate Report button.
3. **Header “Generate Report” only changed the hash.** It now routes to
   `/reports/generate` and, when the plan gate allows, actually POSTs
   `/ai-executive/reports/generate` with a Generating… state.
4. **Reports empty-state locked Start plans** even though on-demand reports
   unlock at Start. Gate now follows `gates.reports.allowed`.
5. **“Log a business decision” / “Set a goal” landed on empty pages.**
   They now open `/decisions/new` and `/roadmaps/new` with the composer
   already expanded so a merchant can save immediately.

## Automated evidence

| Suite | Result |
|---|---|
| `growthiq-chart.test.tsx` | hover math + Real/Projected tooltip |
| `growthiq-light.test.ts` | dark tokens preserved; light contracts |
| `growthiq-functional.test.tsx` | Settings, Generate Report, Upgrade Plan, log decision (save), sample report, sync, set goal, trajectory link, real AOV/orders/days |
| `growthiq-mount.test.tsx` | thin + rich + light mount, no console errors |
| `growthiq-sections.test.tsx` | sections + hit target present |
| `growthiq-strategic.test.ts` | projection / milestones / digest math |
| `executive-ui.test.tsx` | charts, plan panel, first-run states |
| `@profitpilot/web typecheck` | clean |

## Checklist (from the brief)

**Page load / header**
- [x] Loads without errors (dark + light mounts)
- [x] GrowthIQ logo, AI GROWTH COMMAND badge, title, description
- [x] Settings → Executive Settings
- [x] Generate Report → POST generate + report viewer (paid gate)
- [x] Upgrade Plan → billing, copy is always “Upgrade Plan”

**Baseline**
- [x] Real order / day counts and coverage %
- [x] Log a business decision → form opens and saves
- [x] View a sample report → reports workspace
- [x] Sync more data → `onSync('orders')`

**Trajectory**
- [x] Solid / dashed / band from real series
- [x] Hover tooltip: date, value, Real or Projected
- [x] Vertical cursor + highlighted point
- [x] Run-rate, projected next 30d, confidence, direction from `projectTrajectory`
- [x] Explore trajectory details → reports

**Insights / position / impact / actions / milestones / digest / plan**
- [x] Honest “not measurable yet” when inputs are missing
- [x] AOV / days / orders taken from payload
- [x] Executive actions route (decision form, reports, roadmap composer)
- [x] Plan panel expand/collapse; Upgrade Plan never “Upgrade to …”
- [x] Theme toggle: light overrides are `.app-shell.light-mode` only

Dark theme (`#0A0B14` / `#14161F` / `#8B5CF6`) is unchanged.
