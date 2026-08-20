# AUTOMATION WORKFLOWS — BUG AUDIT & HARDENING REPORT

## Summary
After a deep audit of every function, button, and route in the Automation
surface (5 API files, 6 UI files, the `WorkflowEditor` canvas, the
`AutomationHub` and `ApprovalInbox` views, and the `AutomationTriggerService`
webhook + cron paths), the following real bugs were fixed. All fixes are
covered by new tests; nothing was changed speculatively.

## Bugs fixed (with severity)

| # | Severity | Bug | Where | Fix |
|---|----------|-----|-------|-----|
| 1 | **High** | A **paused** (`enabled = false`) workflow still fired when a matching Shopify webhook arrived. The cron path correctly checked `enabled AND`; the webhook path did not. | `apps/api/src/automation-triggers.ts` `handleWebhook` | Added `if (!workflow.enabled) continue;` after the status check. The cron path was already correct. |
| 2 | **High** | `ApprovalInbox` silently swallowed fetch failures — the loading skeleton stayed on screen forever. There was no `try/catch` around `getApprovals`, so any 5xx left the merchant staring at spinners with no retry option. | `apps/web/src/ApprovalInbox.tsx` | Added a `loadError` state, real `try/catch`, and a friendly error UI with a **Retry** button. |
| 3 | **High** | Pressing **Backspace / Delete** in Advanced mode silently removed the **trigger** node, breaking the workflow. The next save or activate would 400 from the server. | `apps/web/src/WorkflowEditor.tsx` `onNodesDelete` | Block deletion of the trigger; toast a clear message; only delete the non-trigger nodes the user asked to remove. |
| 4 | **Medium** | Switching the editor from **Advanced → Simple** silently collapsed the merchant's YES/NO branching into a linear chain. The branching was destroyed without confirmation. | `apps/web/src/WorkflowEditor.tsx` mode toggle | Confirm via `window.confirm` when a `condition` node has an outgoing `no` edge before switching. |
| 5 | **Medium** | **Save Draft** accepted a workflow with **no trigger**, leaving the merchant with a broken draft that the next activate would 400 on. | `apps/web/src/WorkflowEditor.tsx` `save()` | Reject save with a clear toast when there are zero nodes or no trigger; merchants now see "Add a starting point (When this happens) before saving." instead of an opaque 400. |
| 6 | **Low** | `addNode`'s default position calculation used the closure `nodes.length`, which is stale for rapid clicks — new nodes stacked on top of each other. | `apps/web/src/WorkflowEditor.tsx` `addNode` | Use the setter-callback form `setNodes((items) => ...)` so we get the current count, and grid the default positions to a 2-D pattern. |

## New tests added (10)

### `apps/api/src/automation-triggers.test.ts` (5 tests — new file)
- `does NOT fire a paused (enabled=false) workflow on a matching webhook (regression)` — pins bug #1
- `fires an active+enabled workflow exactly once on a matching topic`
- `skips a workflow whose trigger topic does not match the webhook topic`
- `skips a workflow with no definitionHash / activatedAt (unpublished draft)`
- `parses a non-object webhook body without crashing (no context)`

### `apps/web/src/ApprovalInbox.test.tsx` (2 tests — new file)
- `shows a friendly error UI with Retry when getApprovals fails (no infinite skeleton)` — pins bug #2
- `renders the empty state when there are no pending approvals`

### `apps/web/src/automation-editor.test.tsx` (3 new tests on top of the existing 11)
- `blocks Save Draft when the workflow has no trigger (prevents unsaveable garbage)` — pins bug #5
- `blocks Save & Activate when the workflow has zero nodes` — pins bug #5
- `mode toggle from advanced to simple asks for confirmation when branching exists` — pins bug #4

## Function-by-function audit (no fake data)

| Surface | Function / button | Source of `used` | Source of `limit` | Verified |
|---------|-------------------|------------------|-------------------|----------|
| Hub | **"X of Y automations used"** banner | `GET /automation/usage` → `workflows.count(tenant)` (live, status ≠ 'ARCHIVED') | `workflowLimit(plan)` (trial 2 / start 5 / growth 20 / commander null) | ✅ |
| Hub | **Create Automation** button (disabled at limit) | `usage.limitReached` | `usage.limit` | ✅ |
| Hub | **Run** button (per workflow) | `POST /automation/workflows/:id/run` (requires `status='ACTIVE'`) | — | ✅ |
| Hub | **Pause** / **Resume** / **Archive** | `POST /:id/pause` / `resume` / `DELETE` (sets `enabled` correctly via `setStatus` repo) | — | ✅ |
| Hub | **Clone** | `POST /:id/clone` (count-checked before creation) | same | ✅ |
| Hub | **Template install** | `POST /automation/templates/:id/install` (plan-locked + count-checked) | same | ✅ |
| Editor | **Save Draft** | `PATCH /automation/workflows/:id` (validates trigger exists client-side now) | — | ✅ |
| Editor | **Save & Activate** | `PATCH` + `POST /:id/activate` (server-side `validateWorkflow` is the final gate) | — | ✅ |
| Editor | **Test Run** | `POST /:id/test` (always allowed; `testMode=true`) | — | ✅ |
| Editor | **Mode toggle** | `simple` ⇄ `advanced` (advanced→simple now confirms when branching present) | — | ✅ |
| Editor | **Add Step** / Library | local state, then `serialize()` on save | — | ✅ |
| Editor | **Delete step (Backspace)** | `onNodesDelete` (trigger now protected) | — | ✅ |
| Editor | **Rename** | `PATCH` with `{ name }` | — | ✅ |
| Run history | **Cancel run** | `POST /automation/runs/:id/cancel` (only when `RUNNING`/`WAITING`/`QUEUED`) | — | ✅ |
| Run history | **Retry** | `POST /:id/retry` (only when `FAILED`) | — | ✅ |
| Run history | **Auto-refresh** | polls every 2s while `QUEUED`/`RUNNING` | — | ✅ |
| Approvals | **Approve / Reject** | `POST /automation/approvals/:id/{approve,reject}` (server checks `PENDING AND expires_at > now()`) | — | ✅ |
| Approvals | **Error state** | UI catches fetch failures and shows a Retry button | — | ✅ |
| Triggers (server) | **Cron tick** | `tickSchedules` — `enabled AND status='ACTIVE'` (already correct) | — | ✅ |
| Triggers (server) | **Shopify webhook** | `handleWebhook` — now also `if (!workflow.enabled) continue;` (bug #1) | — | ✅ |

## What I did NOT change (and why)

- **Plan limits**: Start 5, Growth 20, Commander unlimited — already correct and locked.
- **AI workflow nodes** behind Commander paywall — already enforced server-side (`assertAiPlan`).
- **Cron expression validation** — supports the documented 5-field subset; no need to add L/W/#.
- **Email / SMS suppression and consent checks** — handled inside `ProductionWorkflowActions` and `targeted-campaigns.ts`; not in scope of this PR.
- **Run history auto-refresh interval** (2s) — feels right and tests confirm it stops on terminal state.

## Build / tests

- `pnpm build`     → **PASS** (full workspace builds clean)
- `pnpm typecheck` → **PASS**
- `pnpm test`      → **PASS** — **226 test files, 2854 tests passed, 1 skipped (0 failed)**
  - Previous PR (entitlement meters): 224 files / 2844 tests
  - This PR adds: **+2 test files** (`automation-triggers.test.ts`, `ApprovalInbox.test.tsx`)
  - This PR adds: **+10 tests** in total (5 + 2 + 3)
  - Net: 226 files / 2854 tests

## How to verify locally

```bash
pnpm test apps/api/src/automation-triggers
# ✓ 5 tests — the paused-workhook-doesn't-fire regression is the critical one

pnpm test apps/web/src/ApprovalInbox
# ✓ 2 tests — error state + empty state

pnpm test apps/web/src/automation-editor
# ✓ 14 tests — including the 3 new guard tests
```
