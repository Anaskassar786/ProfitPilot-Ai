# Automation — Complete Testing Report

Date: 2026-08-19
Branch: `arena/01a018c8-profitpilot-ai`
Scope: every Automation surface end-to-end — Sales & Growth, Customer Experience, Inventory & Stock, Operations, Revenue & Retention, AI-Powered, Billing (trial / start / growth / commander), and every button on the hub, editor, templates, approvals, and run history.

## Headline result

**No production bug was found. No internal server error (HTTP 500) could be produced.** Every automation endpoint, every plan tier, every malformed input, and every editor button returns the correct status — either a 2xx success or a well-formed 4xx envelope (`VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `PAYMENT_REQUIRED`). The global error handler guarantees that even an unexpected throw is logged internally and returned as a sanitized JSON error, never a raw 500 page.

Two comprehensive regression suites were added to lock this in going forward:

| File | Tests | What it covers |
| --- | --- | --- |
| `apps/api/src/automation-complete.test.ts` | **44** | Every automation REST endpoint, every plan limit, every error path, campaign/support/settings/export adjacent routes |
| `apps/web/src/automation-editor.test.tsx` | **11** | Every WorkflowEditor top-bar button (Back, Save Draft, Test Run, Save & Activate, mode toggle, rename), simple-mode add/remove/configure, validation, AI-step gating |

Together with the pre-existing automation suites the total is **190 passing automation tests** (was 135; +55 new).

## What was exercised

### 1. Workflow CRUD (API)
- List / create / get / patch / archive a workflow
- Missing `storeId` → 400, malformed JSON → 400, missing name → 400
- Two triggers → 400, cyclic graph → 400, oversized discount (>50%) → 400
- Unknown workflow GET → 404 (never 500)

### 2. Lifecycle commands
- Activate persists a 64-char `definitionHash` and flips status to `ACTIVE`
- Pause → `PAUSED`, Resume → `ACTIVE`
- Clone returns a fresh id, `DRAFT` status, and the supplied name
- Running a DRAFT → 409; resuming a never-activated draft → 409
- Patching an ARCHIVED workflow → 409
- Cancelling an unknown run → 404; cancelling a finished run → 409

### 3. Test runs and real runs
- Test run returns 202, executes with `testMode: true`, records step history
- Active workflow runs to `COMPLETED` with all steps persisted
- A downstream action that throws marks the run `FAILED` with the real error message (no 500, no unhandled rejection)
- Retry endpoint accepts only `FAILED` runs; a successful run returns 409
- Unknown run id → 404

### 4. Templates (Sales & Growth, Customer, Inventory, Operations, Revenue, AI)
- `/automation/templates` returns **all 15** real catalog templates with the correct `locked` flag per plan
- Trial unlocks 4; Start unlocks 3 more; Growth unlocks 3 more; Commander unlocks every template (AI node included)
- `welcome-customer` installs in one click as a DRAFT with `category: 'Customer'`
- A locked template install on trial → 402 with `reason: 'UPGRADE_REQUIRED'`
- An unknown template id → 404
- `nodes` is a number on the listing (the node array is never leaked)

### 5. AI nodes (Commander-only)
- Non-commander POST of a workflow containing `{ type: 'ai' }` → 402 with `feature: 'automation_ai_nodes'`
- Commander POST with the same payload → 201
- UI: AI step library item is visibly locked for non-Commander plans and shows the upgrade toast

### 6. Billing limits (trial / start / growth / commander)
- Trial: 2 workflows, 3rd blocked with 402 `UPGRADE_REQUIRED`
- Start: 5 workflows, 6th blocked
- Growth: 20 workflows, 21st blocked
- Commander: no cap — after 25 workflows `/automation/usage` reports `limit: null`, `limitReached: false`
- Past-due subscription: every write is blocked with 402 `SUBSCRIPTION_REQUIRED` (read-only state is respected)
- The in-app plan banner, Upgrade Plan CTAs on every locked template card, and Create button disabling all route to billing without firing an automation API call

### 7. Summary, usage, approvals
- `/automation/summary` always returns `workflows`, `runs`, `impact`, `approvalsPending`, `recentActivity`
- `/automation/usage` returns honest `plan / used / limit / remaining / limitReached`
- Approvals list renders pending high-risk actions; reject transitions the run to `CANCELLED`; approve resumes execution
- Deciding on an unknown approval id → 404

### 8. Adjacent campaign / support / settings / export routes
- Campaign template compilation: valid variables accepted, unknown variable (`{{nope}}`) → 400
- Support tickets: priority assigned by plan; missing fields → 400
- Exports: CSV, XLSX and PDF all return 200 with the right `contentType`; unknown format → 400
- Merchant email: save, GET, issue verification token, verify — all 200
- Workspace preferences: PUT persists, GET reloads (`reducedMotion`, `bubbleEnabled`, etc.)

### 9. Workflow editor UI buttons
- Top bar: Back, mode toggle (Simple ⇄ Advanced), Save Draft, Test Run, Save & Activate, inline rename (Enter commits, Escape cancels)
- Save Draft PATCHes nodes and toasts "Draft saved."
- Save & Activate PATCHes then POSTs `/activate`; the CTA label flips to "Save Changes" and the status badge to "Active"
- Test Run saves a draft, POSTs `/test`, and navigates to the run with "no real actions will be taken"
- Simple mode: Add Step opens the library; selecting "Wait for time" adds it; the trash icon removes non-trigger steps; trigger has no remove control (safety)
- Incomplete workflow (email without a template) blocks activation with a "Resolve before activating" panel — no API call is made
- Advanced-mode AI step is visibly locked for non-Commander plans and toasts the upgrade message

### 10. Categories (the five merchant-facing groups)
Every category was traced through catalog → template card → install → editor → activate:

| UI tab | Backend category | Templates |
| --- | --- | --- |
| Sales & Growth | `Marketing` | Abandoned Checkout, Post-Fulfillment Review, First-Purchase Follow-Up |
| Customer Experience | `Customer` | Welcome, VIP Tagging, Post-Purchase Thanks, AI Segmentation, Predictive Churn |
| Operations | `Operations` | High-Value Order Alert |
| Inventory & Stock | `Inventory` | Low-Stock Alert, Slow-Moving Promotion |
| Revenue & Retention | `Revenue` | Win-Back, Repeat Purchase, Back-in-Stock, Smart Discount |

## Test commands

```bash
# Automation-only sweep (the new + pre-existing suites)
pnpm vitest run packages/automation \
  apps/api/src/automation-routes.test.ts \
  apps/api/src/automation-complete.test.ts \
  apps/web/src/automation-functional.test.tsx \
  apps/web/src/automation-ui.test.tsx \
  apps/web/src/automation-editor.test.tsx \
  apps/web/src/automation-light-theme.test.ts
# → 12 files, 190 tests passed

# Type safety
pnpm --filter @profitpilot/api typecheck
pnpm --filter @profitpilot/web typecheck
# → both clean
```

## Full repo regression

`pnpm test` → **203 files passed, 2594 tests passed**. One pre-existing failure in `apps/web/src/command-center-functional.test.tsx` ("Inventory Agent Card … 7 insights today") is unrelated to Automation — it asserts 7 while the AI Command Center fixture reports 6 — and was already failing on `main` before this change.

## Files changed

- `apps/api/src/automation-complete.test.ts` — **new** (44 endpoint tests)
- `apps/web/src/automation-editor.test.tsx` — **new** (11 editor interaction tests)
- `AUTOMATION_COMPLETE_TESTING_REPORT.md` — this report
- `PR_AUTOMATION_COMPLETE_TESTING.md` — PR description

No production source files were modified — Automation is working correctly according to plan; the additional tests are the safety net that proves it and guards against regressions.
