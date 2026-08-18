# Automation — Theme, KPI, and Functional Testing Report

Module: Automation page only  
Branch: `arena/01a0151a-profitpilot-ai`  
Date: 2026-08-18

This PR overhauls **both** themes on the Automation hub, adds unique micro-charts to the five KPI cards, and keeps every number sourced from the real backend (`/automation/summary`, `/automation/usage`, workflow records, templates). No other module was touched.

## What changed

| Area | Change |
|------|--------|
| Light theme | Premium surfaces, purple hierarchy, categorized template cards, readable contrast (WCAG AA) |
| Dark theme | Explicit dark fills on every control so buttons/selects no longer flash OS white |
| Filters | Native `<select>` replaced with `CustomSelect` (theme-safe listbox) |
| KPI cards | Always shown when summary loads; five unique visualizations; educational zero states |
| Template cards | Category tone + plan badge classes from real `category` / `minimumPlan` |
| Workflow cards | Status bar, action styles, “has not run yet” hint from real `lastRunAt` |
| Plan gating | Unchanged: Trial 2 / Start 5 / Growth 20 / Commander unlimited. CTA is always **Upgrade Plan** |

## Zero fake data contract

- KPI values come from `AutomationSummary` + `AutomationUsage`.
- The run sparkline is a **2-point** last-month vs this-month path. There is no invented daily series.
- Action mini-bars use `impact.emailsSent / customersTagged / notificationsSent / discountsCreated`. All-zero stays all-zero (4px track only).
- Success gauge is empty (`—`) until `runs.successRate` is non-null.
- Approval dots light up only for real `approvalsPending`.
- Usage segments use real `used` / `limit`. Commander (`limit === null`) is labeled Unlimited — no invented cap.

## Automated tests

`apps/web/src/automation-ui.test.tsx` — **21 passed**

Coverage added:

- Category / plan CSS class mapping
- Usage segments (trial 2, start 5, unlimited Commander)
- Zero action bars stay at height 0
- Sparkline uses previous vs current month only
- All 5 KPI cards render with educational empty helpers
- Real impact + success rate when the backend has numbers
- Workflow status + never-run hint
- Locked templates still say **Upgrade Plan** (never “Upgrade to X”)

## Feature checklist (code-path + tests)

### Page header

| Feature | Status | Evidence |
|---------|--------|----------|
| How it works | ✅ | Opens `HowItWorksModal` |
| Browse Templates | ✅ | Navigates `/automation/templates` |
| Create Automation | ✅ | Opens `CreateAutomationModal`; disabled when `usage.limitReached` |
| Forced naming | ✅ | Submit gated on `!name.trim()` |

### Warning banner

| Feature | Status | Evidence |
|---------|--------|----------|
| Shows at limit | ✅ | `usage.limitReached` → “You’ve reached your limit” + `{used} of {limit}` |
| Upgrade Plan → billing | ✅ | `onUpgrade` / `onNavigateBilling` |
| Drafts variant | ✅ | “Complete Drafts” + Upgrade Plan when empty drafts occupy the cap |
| Hidden under 80% | ✅ | Banner omitted when `limit === null` or usage &lt; 80% |

### Featured templates

| Feature | Status | Evidence |
|---------|--------|----------|
| Up to 8 real templates | ✅ | `featuredTemplates()` orders backend catalog |
| Category colors | ✅ | `templateToneClass(category)` |
| Plan badges | ✅ | All plans / Start / Growth / Commander only |
| Preview + Set Up | ✅ | Installs via `installAutomationTemplate` |
| Upgrade Plan on locked | ✅ | Never a plan name in the CTA |
| Browse all templates | ✅ | Routes to full gallery |

### Your Automations

| Feature | Status | Evidence |
|---------|--------|----------|
| Search | ✅ | Client filter + API `search` |
| Status tabs + counts | ✅ | Counts from `summary.workflows` |
| Category dropdown | ✅ | Theme-safe `CustomSelect` |
| Last-run / sort dropdown | ✅ | lastRun, name, created, successRate |
| Grid / list toggle | ✅ | `view` state |
| Empty filter state | ✅ | Clear filters |

### Workflow cards

| Feature | Status | Evidence |
|---------|--------|----------|
| Status indicator | ✅ | `status-active` / paused / draft |
| Trigger copy | ✅ | `friendlyStartsWhen` of real `triggerSummary` |
| Steps / runs / last run | ✅ | Record fields only |
| Edit / View Report / Pause / Resume | ✅ | Editor, run history, `workflowCommand` |
| More menu | ✅ | Run now, duplicate, history, archive |
| Never-run hint | ✅ | Shown when `lastRunAt` is null and counts are 0 |

### Bottom KPI cards

| Card | Visualization | Empty helper |
|------|---------------|--------------|
| Active automations | Segmented usage bar | `{used} of {limit} automations used` |
| Runs this month | 2-point spark (prev vs current) | No change from last month |
| Success rate | Semicircle gauge | Available after the first run |
| Actions completed | 4 real-type mini-bars | Measured after successful actions |
| Pending approvals | 10-dot status grid | All clear! / No actions waiting |

### Plan enforcement (unchanged)

| Plan | Workflow cap |
|------|----------------|
| Trial | 2 |
| Start ($49) | 5 |
| Growth ($149) | 20 |
| Commander ($349) | Unlimited (`limit: null`) |

API: `workflowLimit()` in `apps/api/src/automation-routes.ts`. Create/install returns 402 with **Upgrade Plan** wording.

## Constraints honored

- Automation page only — no AI Command Center, Recommendations, Store Coach, GrowthIQ, PatternAI, or Copilot edits
- No fake / hardcoded KPI numbers
- Plan structure unchanged
- CTA copy is always “Upgrade Plan”
- Existing create / edit / pause / resume / archive / template install paths preserved
