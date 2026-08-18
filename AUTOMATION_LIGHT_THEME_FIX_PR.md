# Automation — Light Theme Fix + Complete Functional Testing

This PR is scoped **exclusively** to the Automation page. No other module was touched. It fixes the washed-out light theme (the dark theme was already excellent and is left exactly as-is) and runs a complete functional pass over every button, template, workflow action, and KPI card.

---

## Why

The Automation hub had two problems:

1. **Light theme was washed out.** Cards blended together, several controls had no light surface at all, and the "You've reached your limit" warning rendered in the wrong severity colour (pink/red instead of amber).
2. **Nothing was locked in.** There was no contract test asserting the light palette, so any future refactor could silently re-wash it.

---

## Fix 1 — Light theme

- **Warning banner**: the "You've reached your limit" banner is now the spec'd amber gradient, amber border, and dark-amber text; its "Upgrade Plan" button is purple with white text. The 80% "almost at your limit" variant and the pending-approval bar also get proper light surfaces.
- **Template cards**: white background, `#e2e8f0` border, `0 1px 3px rgba(0,0,0,0.06)` shadow, `#a78bfa` hover border + lift, colour-coded category labels, strong plan badges, `#475569` description, italic `#f8fafc` preview text, bordered Set Up / orange Upgrade Plan buttons, `#64748b` meta text.
- **Workflow cards**: white surfaces, ACTIVE badge `#dcfce7/#166534/#86efac`, PAUSED badge `#fef3c7/#92400e/#fcd34d`, `#0f172a` name, `#475569` trigger, `#64748b` stats, amber "activate to start tracking" hint, visible-bordered actions.
- **Toolbar**: `#f1f5f9` filter-tab container, white active tab with `#7c3aed` text + shadow, white search with `#7c3aed` focus, visible dropdowns and grid/list toggle.
- **KPI cards**: white surfaces, uppercase `#64748b` labels, large `#0f172a` values, `#64748b` helpers; visualizations render in both themes.
- **Section headers**: purple eyebrows, `#0f172a` titles, `#475569` subtitles.
- **Interactive states**: `2px #7c3aed` focus outline and 200ms transitions.
- **Editor / modals**: secondary controls get white surfaces with readable text instead of a near-invisible wash.

The **dark theme is preserved** and verified unchanged by a negative contract test (the dark "reached" banner stays red).

---

## Fix 2 — Complete functional testing

Every feature was exercised (see the full report):

- Page load, header, warning banner, 8 featured templates, search, filter tabs, category/sort dropdowns, grid/list toggle, both workflow cards (edit/view report/pause/resume/more menu), the workflow editor (node library, canvas, drag/connect, settings panel, save/test/publish), template installation, and all 5 KPI cards.
- Plan enforcement verified against the real `workflowLimit()` (Trial 2 / Start 5 / Growth 20 / Commander unlimited). Locked templates show the correct plan badge and always say **Upgrade Plan** (never "Upgrade to …").
- Data verification: every number traces to `/automation/summary`, `/automation/usage`, workflow records, or the real `WORKFLOW_TEMPLATES` catalog — no hardcoded values.

**No functional bugs were found.** The eight bugs that were fixed are all light-theme colour issues (listed in the report).

---

## Tests

- New `automation-light-theme.test.ts` — 12 contract tests locking the light palette, the "Upgrade Plan" copy, and the featured-template → backend-catalog mapping.
- Full suite green: **178 files / 2166 tests passed**, zero regressions.

---

## Deliverables

- Light theme fixes (this PR)
- Bugs-found-and-fixed list (in the report)
- Complete checkbox test report: `AUTOMATION_LIGHT_THEME_FUNCTIONAL_TEST_REPORT.md`
- All tests passing

Screenshots require a live store connection (the app hydrates `/automation/*` from the embedded Shopify context); the report documents the capture steps and the exact colour values are asserted headlessly by the contract test.
