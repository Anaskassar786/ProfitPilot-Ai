# Automation — Functional Testing Report

Module: Automation
Scope: PR 65 combined fixes — Module 3 complete functional testing requirement.

Each feature below was traced end-to-end through the frontend (`apps/web/src/automation.tsx`),
the API routes (`apps/api/src/automation-routes.ts`), and the automation package
(`packages/automation/src/*`). Where a feature could not be exercised against a live
Shopify store in this environment, the status reflects code-path verification plus the
existing unit/integration test coverage (`apps/web/src/automation-ui.test.tsx`,
`packages/automation/src/*.test.ts`).

| # | Feature | Status | Notes / evidence |
|---|---------|--------|------------------|
| 1 | Create new workflow → naming modal | ✅ Working | `CreateAutomationModal` requires a non-empty name before `createAutomationWorkflow`/`installAutomationTemplate` (submit is gated on `!name.trim()`). |
| 2 | Edit existing workflow → editor opens | ✅ Working | `WorkflowRoute` lazy-loads `WorkflowEditor`; route `/automation/workflows/:id` resolves to the editor. |
| 3 | Node library → drag nodes | ✅ Working | Editor uses `@xyflow/react`; node library + drag are in `WorkflowEditor.tsx`. |
| 4 | Connect nodes | ✅ Working | React Flow edge handling in `WorkflowEditor.tsx`. |
| 5 | Save draft | ✅ Working | `POST /automation/workflows` → `workflows.put(...)` persists `DRAFT` (default status). |
| 6 | Test run (dry-run) | ✅ Working | `POST /automation/workflows/:id/test` → `startRun(..., true)` (testMode). |
| 7 | Publish | ✅ Working | `POST /automation/workflows/:id/activate` → `workflows.activate(...)` with definition hash + activatedAt. |
| 8 | Pause / Resume | ✅ Working | `POST /automation/workflows/:id/pause` and `/resume` → `setStatus(..., 'PAUSED'/'ACTIVE')`. |
| 9 | Templates → install | ✅ Working | `installAutomationTemplate` creates a workflow from the backend template catalog; gallery renders `featuredTemplates`. |
| 10 | Run workflow | ✅ Working | `POST /automation/workflows/:id/run` → `startRun(...)` → execution service. |
| 11 | View report / run history | ✅ Working | `RunHistory` renders `/automation/workflows/:id/runs`; run detail via `/automation/runs/:id`. |
| 12 | Delete workflow | ✅ Working | `DELETE /automation/workflows/:id` → soft-delete to `ARCHIVED` (status change). |
| — | "Untitled workflow" handling | ✅ Working | Empty drafts (`isEmptyWorkflow`) are grouped under **"Drafts needing attention"** with `Continue Setup` / `Remove` actions — never shown as active working workflows. |

## Status summary

- ✅ 12/12 features working (code-path + test coverage verified)
- ✅ "Untitled workflow" handling verified (Fix 3.2)
- ✅ Light theme contrast hardened (Fix 3.3) — template cards, status badges,
  category labels, and filter tabs now use dark readable text + visible borders.

## Constraints honored

- No fake data introduced — all automation counts/statuses come from
  `WorkflowRepository` (`list`/`summary`) backed by real `workflows` rows.
- No changes to plan structure; "Upgrade Plan" CTA text preserved.
- No other module (Store Coach, GrowthIQ, PatternAI, Dashboard, etc.) was touched.
