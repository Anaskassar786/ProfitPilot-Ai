# Automation Page — Exhaustive Testing, Bug Fixing & Complete Overhaul: Functional Test Report

Module: Automation page only
Branch: `arena/01a01892-profitpilot-ai`
Date: 2026-08-19

Every button, link, icon, badge, card, modal, form, filter, and interactive
element on the Automation page was tested three ways:

1. **Live API** — the real Express API booted with in-memory automation
   repositories (`scripts/automation-dev-harness.mjs`), exercised through the
   Vite dev proxy exactly as the browser would call it. Every endpoint
   returned a proper JSON envelope — zero raw 500 pages.
2. **DOM-level UI sweep** — `apps/web/src/automation-functional.test.tsx`
   (46 tests, all passing) mounts the real `AutomationWorkspace` in jsdom and
   clicks through every control.
3. **Unit contracts** — `automation-ui.test.tsx`,
   `automation-light-theme.test.ts`, `automation-routes.test.ts`,
   `web-app-spa.test.ts` (new) lock the copy, color, and behavior contracts.

---

## 1. Bugs found & fixed

| # | Bug | Severity | Fix |
|---|-----|----------|-----|
| 1 | **500 Internal Server Error** on run cancellation — `POST /automation/runs/:id/cancel` on a missing/stale run threw a raw `Error('Run not found')` from the repository layer → Express rendered a 500 | Critical | `automation-routes.ts` now pre-checks the run and returns `404 NOT_FOUND` (missing) or `409 CONFLICT` (already finished). Regression tests added. |
| 2 | **"Cannot GET /automation"** — hard refresh / deep link to `/automation` (and its SPA subroutes) was served by neither the API nor the SPA fallback because `/automation` is an API path prefix | Critical | `mountAutomationSpaFallback()` in `web-app.ts` serves the app shell for browser (Accept: text/html) navigations before the API routers; API clients (never accept HTML) still get JSON. Dev proxy bypass added in `vite.config.ts`. `web-app-spa.test.ts` locks the contract. |
| 3 | **"Upgrade Plan" button inconsistency** — template-card upgrade CTAs were an orange/amber gradient, the plan-banner CTA was purple, and the preview-modal CTA was purple; locked cards were dimmed to `opacity: 0.78`, making buttons look half-visible | High | One shared `.upgrade-plan-btn` contract: solid green (`#22c55e → #16a34a`), white text, `min-width: 120px`, `min-height: 34px`, `flex-shrink: 0`, `visibility/opacity: 1 !important` — identical on template cards, the limit banner, the drafts banner, the 80% banner, and the template preview modal, in both themes. Locked-card dimming removed. |
| 4 | **Card footers could clip CTAs** — `setup-time` and the CTA share one row with `white-space: nowrap` on both; long labels squeezed the button | High | Footer keeps `align-items: center` + `gap: 10px`; `setup-time` truncates with ellipsis; CTAs never shrink. |
| 5 | **Category border/stripe mismatch with the spec** — Operations used a red stripe, Revenue & Retention a purple one; the spec maps Operations→purple, Revenue→red | Medium | Category stripes and icon tints now follow the documented map: Sales=green `#22c55e`, Customer=blue `#3b82f6`, Inventory=orange `#f59e0b`, Operations=purple `#8b5cf6`, Revenue=red `#ef4444`. Base card border stays identical on every card. |
| 6 | **Duplicate category icons** — workflow cards used `Boxes` for both Operations and Inventory; template cards used an unrelated icon set | Medium | New shared `categoryIcon()` in `automation-helpers.ts`: Marketing→`ShoppingCart`, Customer→`Users`, Inventory→`Boxes`, Operations→`BellRing`, Revenue→`Repeat`, Commander/AI→`WandSparkles`. Used by both template cards and workflow cards — one recognizable icon per category, zero duplicates. |
| 7 | **"Browse Templates" icon was generic** (`Sparkles`) | Low | Replaced with `LayoutTemplate` (the template/grid icon) in the header, the getting-started hero, and the How-it-works modal path stays on-brand. |
| 8 | **No way to rename an automation** — "Untitled workflow" could never be renamed anywhere in the UI | Medium | Inline rename added on workflow cards (click the name → input → Enter saves via `PATCH`, Escape cancels, blur commits) and in the editor topbar (same interaction). Valid HTML (no nested buttons), aria-labels, focus rings. |
| 9 | **Never-run warning bar was inert-looking** — "This automation has not run yet. Activate it to start tracking results." gave no affordance | Low | The hint sits inside the clickable card body (click → opens the editor where activation lives), now with a trailing arrow icon, hover highlight in both themes, and `cursor: pointer`. |
| 10 | **Unhandled promise rejections** — the TemplatesRoute install handler and the Run History "Cancel" button had no catch; a 402/404 surfaced as a console error instead of a toast | Medium | Both paths now catch and toast user-friendly messages; the template preview modal stays open on failure so the merchant can retry. |
| 11 | **Locked-template installs reported the wrong gate** — a locked template on a store at its workflow cap said "Workflow limit reached" instead of explaining the plan gate | Low | The plan check now runs first: `402 "Upgrade Plan to install this template"`. |
| 12 | **More-menu did not close after choosing an action** | Low | Menu closes on Run Now / Duplicate / Run history / Archive selection. |
| 13 | **Dark theme had no focus ring** (light theme had one) | Low | `outline: 2px solid #7c3aed` on `:focus-visible` for all Automation buttons in dark mode. |
| 14 | **Stats bar cramped on small phones** — KPI cards stayed 2-up at 375px | Low | New `@media (max-width: 480px)` makes the KPI grid single-column; template tabs wrap; header/banner actions stay full-width and readable. |

## 2. Live API test matrix (real API + Vite proxy)

| Endpoint | Result |
|----------|--------|
| `GET /automation/workflows` (+ `status=` filter) | 200 envelope |
| `GET /automation/workflows/:id` | 200 / 404 `NOT_FOUND` |
| `POST /automation/workflows` (create) | 201; 400 without `storeId`; 402 at cap with upgrade message |
| `PATCH /automation/workflows/:id` (rename/update) | 200 |
| `DELETE /automation/workflows/:id` (archive) | 200 |
| `POST …/activate`, `…/pause`, `…/resume` | 200 |
| `POST …/clone` | 201; 402 at cap |
| `POST …/run`, `…/test` | 202 |
| `POST …/validate`, `GET …/versions`, `POST …/rollback` | 200 / proper 4xx |
| `GET …/runs`, `GET /automation/runs/:id` | 200 |
| `POST /automation/runs/:id/cancel` | 409 when finished, **404 instead of 500** when unknown |
| `POST /automation/runs/:id/retry` | 404 when unknown |
| `GET /automation/templates` | 200 (15 real catalog rows, correct `locked` flags) |
| `POST /automation/templates/:id/install` | 201 unlocked; **402 "Upgrade Plan to install this template"** locked |
| `GET /automation/summary`, `GET /automation/usage` | 200 — real data only |
| `GET /automation/approvals`, `POST …/approve`, `…/reject` | 200 / 404 `NOT_FOUND` |
| Browser GET `/automation`, `/automation/templates`, `/automation/workflows/:id`, `/automation/runs/:id`, `/automation/approvals` (Accept: text/html) | **200 `text/html` app shell** (was "Cannot GET" / JSON) |

## 3. UI checklist — every interactive element

Legend: ✅ exercised by `automation-functional.test.tsx` (46 passing tests) · ⚙️ verified via live API.

### A. Top navigation bar
- ✅ "SHOPIFY AUTOMATIONS" eyebrow, "🤖 Automations" title, subtitle render
- ✅ "How it works" → opens modal, closes via X, zero console errors
- ✅ "How it works" → "Start Building" opens the create modal
- ✅ "Browse Templates" (new `LayoutTemplate` icon) → navigates to `/automation/templates` and back
- ✅ "Create Automation" → opens modal; correctly disabled at the plan cap with explanatory tooltip
- ✅ Hover + focus states styled (focus ring added for dark theme)
- ✅ Escape/Enter keyboard flows covered (rename Escape/Enter, modal close, listbox keyboard contract in `custom-select.test.ts`)

### B. Upgrade banner
- ✅ "You've reached your limit" + accurate `2 of 2` copy
- ✅ Green "Upgrade Plan" button → routes to Billing (no API call, no 500)
- ✅ Drafts variant ("Complete your drafts or upgrade for more space") with Complete Drafts + Upgrade Plan
- ✅ 80% "almost at your limit" variant, hidden under 80%, hidden for unlimited plans
- ✅ Responsive (wraps, buttons full-width on mobile)

### C. Featured templates
- ✅ "PROVEN STARTING POINTS" / "Featured templates" / subtitle render
- ✅ Exactly 8 cards in the curated order, each with full description, impact helper, and `setup · N steps` meta
- ✅ "Browse all templates →" navigates to the gallery; gallery tabs filter (All / Sales & Growth / Customer Experience / Operations / Inventory & Stock / Revenue & Retention / AI-Powered)
- ✅ Per-card: badges (All plans = green, Start plan = blue, Growth plan = purple), category label, unique per-category icon, preview modal (Set Up → installs and opens the editor; locked templates show green Upgrade Plan → Billing)
- ✅ All four locked-card CTAs are byte-identical green buttons; the previously broken Back-in-Stock card is verified consistent
- ✅ All four unlocked cards show identical "Set Up →" buttons

### D. Your Automations
- ✅ Section header, count badge `2`, subtitle `2 active · 0 paused`
- ✅ Search narrows cards; status tabs `All 2 / Active 2 / Paused 0 / Draft 0 / Archived 0` filter correctly with a friendly empty state + "Clear filters"
- ✅ Category dropdown and Last run/Name/Created/Success rate sort dropdown filter/sort correctly
- ✅ Grid ⇄ List view toggle
- ✅ Workflow cards: ACTIVE badge, trigger copy, step/run/last-run stats, orange never-run hint (click → editor)
- ✅ **Inline rename**: click name → input → Enter persists via `PATCH` (toast "Automation renamed."), Escape cancels with no API call; both cards independent
- ✅ Editor topbar rename (same PATCH path)
- ✅ Edit → editor · View Report → run history · Pause → status flips to Paused (Resume appears) · more-menu: Run Now / Duplicate / Run history / Archive all work and close the menu
- ✅ Drafts section: "Drafts needing attention", Continue Setup, Remove

### E. Stats bar (bottom KPI cards)
- ✅ Active automations: segmented bar, `2/2`, `2 of 2 automations used`, `0 available`
- ✅ Runs this month: real value, "No change from last month" / `+N vs last month`
- ✅ Success rate: `—` + "Available after the first run" when empty; `88%` with real data
- ✅ Actions completed: `0` + Email/Tag/Notify/Discount mini-bars + "Measured after successful actions"; real counts when they exist
- ✅ Pending approvals: ✓ "All clear!" / "No actions waiting" when empty; "Needs review" + count when pending; card navigates to the inbox
- ✅ Real-data pass against the seeded `busy-store` (8 runs, 100% success, real activity feed)

### F–G. Interactions, error & loading states
- ✅ Every button/link/dropdown/filter/card on the page clicked in jsdom — zero console errors
- ✅ Loading skeleton while the hub fetches (simulated slow network)
- ✅ API failure → friendly "Automation could not be loaded" + Retry (never a raw 500); Retry recovers
- ✅ Browser back/forward (popstate) returns to the hub
- ✅ Disconnected store → "Connect Shopify to use automations" CTA
- ✅ New merchant → getting-started hero with popular templates + build-from-scratch
- ✅ Create modal: name required (submit disabled), template picker, Cancel, install → editor

### H. Responsive (CSS contracts)
- ✅ 1480px max shell; template strip 4→3→1 columns; gallery 3→2→1; toolbar wraps ≤1100px; KPI grid 5→3→2→1 columns; header actions stack ≤720px and stay full-width ≤480px; tabs wrap; no horizontal scroll paths

### I. Accessibility
- ✅ `role="listbox"`/`option` listboxes, aria-labels on icon-only buttons and CTAs, `aria-expanded` menus
- ✅ Focus-visible rings in both themes; existing repo-wide axe accessibility suite passes
- ✅ Valid HTML: card rename uses sibling buttons (no nested interactive elements)

## 4. Test inventory

| Suite | Result |
|-------|--------|
| `apps/web/src/automation-functional.test.tsx` (new, 46 tests) | ✅ 46/46 |
| `apps/web/src/automation-ui.test.tsx` | ✅ 21/21 |
| `apps/web/src/automation-light-theme.test.ts` | ✅ 12/12 |
| `apps/api/src/automation-routes.test.ts` (+3 regression tests) | ✅ 13/13 |
| `apps/api/src/web-app-spa.test.ts` (new, 5 tests) | ✅ 5/5 |
| Full monorepo suite | ✅ 2532/2533 — the single failure is a **pre-existing, time-of-day flake** in `command-center-functional.test.tsx` ("7 insights today" hardcodes a count that crosses midnight; verified it fails identically on the base commit with this PR's changes stashed). No Automation test fails. |

Typecheck (`tsc --noEmit`) passes across all workspaces; `vite build` succeeds.

## 5. Zero fake data contract (unchanged)

Every number on the page still comes from the real backend (`/automation/summary`,
`/automation/usage`, workflow records, the `WORKFLOW_TEMPLATES` catalog). Empty
stores show honest empty states; stores with runs show real counts. The
dev-harness seeds all three scenarios through the real HTTP endpoints only.
