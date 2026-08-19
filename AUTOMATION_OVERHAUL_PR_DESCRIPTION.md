# Automation page — exhaustive testing, bug fixing & complete overhaul

## Summary

Rigorous, checkbox-by-checkbox pass over the entire Automation page. Every
button, link, icon, badge, card, modal, form, filter, and endpoint was tested;
every bug found was fixed. The page now has one visual contract — one green
"Upgrade Plan" CTA everywhere, one badge palette per plan tier, one category
color map, one icon per category — and zero raw 500 errors.

## Critical bugs fixed

1. **500 on run cancellation.** `POST /automation/runs/:id/cancel` on a missing
   or stale run threw a raw repository error → Express 500. It now returns
   `404 NOT_FOUND` (missing) or `409 CONFLICT` (already finished).
2. **"Cannot GET /automation".** `/automation` is an API path prefix, so the
   SPA fallback refused to serve it — hard refresh / deep link to the
   Automation module (any of its routes) showed an error page or JSON. Browser
   navigations (Accept: `text/html`) now get the app shell before the API
   routers; API clients keep getting JSON. Dev proxy bypass added for Vite.
3. **Inconsistent, half-visible "Upgrade Plan" buttons.** One green contract
   (`.upgrade-plan-btn`) now applies to template cards, the plan banners, and
   the template preview modal — same size, fully visible, both themes. Locked
   cards no longer dim to 0.78 opacity; card footers can no longer clip CTAs.
4. **No rename anywhere.** "Untitled workflow" was permanent. Inline rename
   added on workflow cards and in the editor topbar (Enter saves via PATCH,
   Escape cancels, blur commits) with valid HTML and aria labels.
5. **Unhandled promise rejections** in the templates install flow and Run
   History cancel → user-friendly toasts instead of console errors.
6. **Locked-template installs reported the wrong gate** when the store was
   also at its workflow cap → plan check now runs first
   ("Upgrade Plan to install this template").

## Visual consistency overhaul

- **Upgrade Plan buttons:** all green `#22c55e → #16a34a`, `min-width: 120px`,
  `min-height: 34px`, `visibility/opacity: 1 !important`.
- **Badges:** All plans = green, Start plan = blue, Growth plan = purple
  (Commander-only = amber), never clipped.
- **Card borders:** one identical base border; one consistent category stripe:
  Sales=green, Customer=blue, Inventory=orange, Operations=purple,
  Revenue=red. Equal card heights; footers aligned.
- **Icons:** `categoryIcon()` shared by template + workflow cards —
  Marketing→ShoppingCart, Customer→Users, Inventory→Boxes,
  Operations→BellRing, Revenue→Repeat, AI→WandSparkles. No duplicates.
  "Browse Templates" now uses `LayoutTemplate` instead of a generic sparkle.
- **Never-run hint** is visibly actionable (arrow + hover), opens the editor.
- **More menu** closes after choosing an action.
- **Focus rings** on the dark theme; KPI stats bar single-column ≤480px;
  template tabs wrap; no horizontal scroll.

## API/error handling

- `POST /automation/runs/:id/cancel` — 404/409 instead of 500 (regression
  tests added).
- Template install validates the plan gate before the workflow cap.
- Every UI mutation has try/catch + user-friendly toast; loading and error
  states render instead of raw 500s.

## Testing

- **New: `apps/web/src/automation-functional.test.tsx`** — 46 tests mounting
  the real workspace and clicking through every control (header, banner,
  8 template cards, preview modal, search, tabs, dropdowns, view toggle,
  rename, pause/run/duplicate/archive, hints, KPIs, drafts, approvals, empty/
  loading/error states, navigation, deep links).
- **New: `apps/api/src/web-app-spa.test.ts`** — 5 tests locking the SPA
  deep-link contract vs. the JSON API.
- **`automation-routes.test.ts`** — 3 new regression tests (cancel 404/409,
  locked-template 402 message ordering).
- Full suite: **2532/2533** — the one failure is a pre-existing time-of-day
  flake in `command-center-functional.test.tsx` (verified it fails identically
  on the base commit with this PR stashed; unrelated module).
- Live API matrix: all 25+ automation endpoints exercised against the real
  Express app (see `AUTOMATION_OVERHAUL_FUNCTIONAL_TEST_REPORT.md`).

## Dev tooling

`scripts/automation-dev-harness.mjs` — boots the real API with in-memory
automation repositories and seeds three stores (`demo-store` = the screenshot
scenario at 2/2 usage, `busy-store` = real runs/stats, `fresh-store` = new
merchant) exclusively through the real HTTP endpoints, so every number the UI
shows is genuine backend output.

## Files changed

- `apps/api/src/automation-routes.ts` (+ tests) — cancel 404/409, template
  plan-gate ordering
- `apps/api/src/web-app.ts` + `app.ts` (+ `web-app-spa.test.ts`) — SPA
  deep-link fallback for the Automation module
- `apps/web/src/automation-helpers.ts` — shared `categoryIcon()`
- `apps/web/src/TemplateGallery.tsx` — green CTA contract, unique icons,
  aria-labels, retry-safe install
- `apps/web/src/WorkflowCard.tsx` — inline rename, restructured valid markup,
  actionable hint, menu auto-close
- `apps/web/src/WorkflowEditor.tsx` — topbar rename
- `apps/web/src/automation.tsx` — LayoutTemplate icon, rename handler, green
  banner CTAs, guarded install
- `apps/web/src/RunHistory.tsx` — cancel error handling
- `apps/web/src/automation.css` — overhaul section (CTA/badge/border/card/
  focus/responsive contracts)
- `apps/web/vite.config.ts` — dev proxy bypass for Automation deep links
- `scripts/automation-dev-harness.mjs` — live test harness
- `AUTOMATION_OVERHAUL_FUNCTIONAL_TEST_REPORT.md` — full test evidence
