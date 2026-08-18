# Merchant-Friendly Automation Page Redesign

## Summary

The Automation module was developer-tooling dressed as a merchant product: "Untitled workflow" cards, node graphs, and technical jargon (`Trigger`, `Condition`, `If / Else`, `Wait / Delay`). This PR transforms it into a beginner-friendly, template-driven, guided experience — think Shopify Flow meets Klaviyo — that any non-technical Shopify merchant can use.

**Scope is strictly the Automation module.** No changes to AI Command Center, Recommendations, Store Coach, AI Executive, Insights Hub, campaigns, billing plans, or any other module. Backend workflow logic is untouched; this is a UX/UI + copy redesign on top of the existing APIs.

## What changed

### 1. Main Automation page redesigned
- Header: **🤖 Automations** · "Save time and grow your business with automated workflows" · `[+ Create Automation]` `[Browse Templates]` `[How it works]`
- **Getting Started hero** for new merchants (0 automations, or only empty drafts): welcome copy, `[Browse Templates]`, `[How it works]`, "Or build from scratch", and the 3 most popular real templates with their real impact copy.
- **Featured Templates** are now a prominent gallery on the hub (8 real backend templates), never hidden behind a collapsed `<details>`.
- **Your Automations** section shows only real automations with real numbers; search/status/category/sort/view toolbar retained.
- **KPI metrics render only when there are active automations or real runs** — no useless zero-tiles for new merchants. Metrics are 100% real backend values (active automations, runs this month + trend, success rate, actions completed, pending approvals).
- **Recent Activity renders only when real run history exists.**
- Empty states are educational and action-oriented (no "no data" dead ends).

### 2. "Untitled workflow" empty cards eliminated
- Empty/never-used automations (0 steps, or only a starting point with no actions, never run) are auto-detected and moved into a collapsed **"Drafts needing attention"** section at the bottom, each with `[Continue Setup]` and `[Remove]`.
- The main grid only shows automations that do real work.

### 3. Setup modal forces naming
`[+ Create Automation]` now opens a **Create New Automation** modal that forces a name ("What do you want to automate?"), a category, and a starting point — **From Template (Recommended)** vs **From Scratch (Advanced)** — with `[Cancel]` / `[Continue →]`. Plan usage ("2 of 5 automations used") is shown.

### 4. Editor: Simple mode by default, Advanced toggle
- **Simple (guided) mode is the default**: a linear recipe — *When this happens → Check something (optional) → Wait for time (optional) → Then do this* — with step cards, `[+ Add Step]`, per-step `[Change]` / `[Configure]` / remove, `[Save Draft]`, `[Test Run]`, `[Save & Activate]`, and friendly validation messages.
- **Advanced mode** keeps the full ReactFlow canvas for power users via the "Switch to Advanced" toggle.
- Right panel shows a **Getting Started** guide when nothing is selected, and clear step settings with friendly labels when a step is selected.

### 5. Merchant-friendly terminology everywhere
| Before | After |
|---|---|
| Node | Step |
| Trigger | When this happens / starting point |
| Condition / If / Else | Check something |
| Action | Do something |
| Workflow | Automation |
| Manual Trigger | Run on demand |
| Scheduled | On a schedule |
| Order Created | New order received |
| Customer Created | New customer signed up |
| Inventory Changed | Stock level changed |
| Wait / Delay | Wait for time |
| Send Email / Tag Customer / Create Discount | Send email / Add customer tag / Create discount code |
| Internal Notification / Update Inventory | Notify you / Update stock levels |

### 6. Beautiful template gallery
- Real backend templates grouped into friendly tabs: Sales & Growth, Customer Experience, Operations, Inventory & Stock, Revenue & Retention, **AI-Powered (Commander only)**.
- Cards show icon, name, description, **real impact copy**, complexity/setup, **plan-requirement badge**, and `[Set Up →]` / `[Upgrade Plan]`.
- Preview modal before install: description, real impact, "🎯 When this happens → ❓ Check something → ⚡ Then do this", plan requirement, and one-click **Set Up**.

### 7. Warning banner logic fixed
- Empty drafts + limit reached → **"Complete your drafts or upgrade for more space"** with `[Complete Drafts]` (scrolls to & opens the drafts section) and `[Upgrade Plan]`.
- Real automations + limit reached → **"You've reached your limit"** with `[Upgrade Plan]`.
- ≥80% usage → "You're almost at your limit" with `[Upgrade Plan]`.

### 8. Workflow cards show real value
Cards now show status pill, description, "Starts when …" (friendly), step count, **real successful-run / failure / success-rate counts**, last-run time, and actions `[Edit]` `[View Report]` `[Pause/Resume]` `[⋮ Run Now · Duplicate · Run history · Archive]`.

### 9. Educational content
"**How automations work**" modal (hub + editor): the 4-step recipe in plain English — choose a starting point, add checks, choose what happens, test & activate — with `[Start Building]` and `[Browse Templates]` CTAs.

### 10. Simplified step library + better right panel
- Library groups: 🎯 When this happens · ❓ Check something · ⚡ Do something · ⏳ Wait · 🤖 AI-Powered (Commander only).
- AI steps are locked with "Upgrade Plan" guidance for non-Commander plans.
- Editor right panel: numbered getting-started guide with `[View Tutorial]` / `[Browse Templates]` when nothing is selected.

## Rules compliance
- ✅ **Zero fake data** — every number rendered comes from real API responses (`/automation/summary`, `/automation/usage`, `/automation/workflows`, `/automation/templates`, `/automation/approvals`, run history). No hardcoded metrics, no invented impact numbers.
- ✅ **Plan gating preserved** — Trial 2 / Start 5 / Growth 20 / Commander unlimited + AI nodes enforced by the backend; UI only reflects `usage`/`limitReached` and template `minimumPlan`/`locked` from the API.
- ✅ **Upgrade wording** — always "Upgrade Plan" (never "Upgrade to Growth/Commander").
- ✅ **Both themes** — full dark + light theme styling with the specified palettes.
- ✅ **12px+ typography** everywhere.
- ✅ Backend automation logic, endpoints, and all existing capabilities untouched; advanced mode preserves full node editing.

## Testing
- `pnpm vitest run` — **1877 tests pass** (172 files), including 12 new/updated tests:
  - `automation-ui.test.tsx` rewritten: merchant-copy helpers (`isEmptyWorkflow`, `friendlyTriggerSummary`, `friendlyNodeLabel/Summary`, `friendlyCron`, `planBadgeLabel`), WorkflowCard (friendly trigger, real usage numbers, no UUID leak, no SMS), TemplateGallery (real impact copy, locked → "Upgrade Plan", never plan names), Create Automation modal (forces name/category/starting point), How-it-works modal.
- `pnpm --filter @profitpilot/web typecheck` — clean.
- `pnpm --filter @profitpilot/web build` — production build succeeds.
- API-level tests (`automation-routes.test.ts`) unaffected and passing.

## Visual verification
The live preview (Arena) shows the redesigned hub against the **real API**: `scripts/pr58-automation-preview.mjs` boots the real Express app with in-memory repositories and seeds it exclusively through the real HTTP endpoints (template installs, activation, runs), so every number on screen is genuine backend output. Try:
- `/?storeId=demo-store` → Automation: hub with 2 active automations, real runs, KPIs, "limit reached" banner, featured templates (with locked/Upgrade Plan states for the trial plan).
- `/?storeId=demo-new` → empty-state Getting Started hero + featured templates.
- Open any automation → Simple (guided) editor; toggle "Switch to Advanced" for the canvas.

## Files changed
- `apps/web/src/automation.tsx` — hub redesign (hero, featured templates, drafts, KPIs, activity, banner, create modal, routing)
- `apps/web/src/automation.css` — full rewrite, both themes, new components
- `apps/web/src/WorkflowEditor.tsx` — Simple/Advanced editor, friendly library + panels
- `apps/web/src/WorkflowCard.tsx` — real-value cards
- `apps/web/src/TemplateGallery.tsx` — merchant gallery + preview modal
- `apps/web/src/automation-helpers.ts` — new: merchant-copy helpers (pure, unit-tested)
- `apps/web/src/automation-tutorial.tsx` — new: How-it-works modal
- `apps/web/src/RunHistory.tsx`, `apps/web/src/ApprovalInbox.tsx` — copy updated to "Automations"
- `apps/web/src/App.tsx` — Automation module description copy
- `apps/web/src/automation-ui.test.tsx` — rewritten/expanded tests
- `scripts/pr58-automation-preview.mjs` — local preview harness (dev-only, not shipped)
