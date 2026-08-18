# PR #53 — Recommendations Page UX Improvements

## Summary

Elevates the Recommendations page from functional to premium: every KPI explains itself with a hover tooltip, empty states teach instead of promote, Run Analysis is a full staged experience with a rich health-check result panel, and all four sidebar sections are useful even before the first run. No fake data — samples are clearly labeled, and the new analysis stats come straight from the API.

## Highlights

### KPI clarity (Issue 1)
- "Pending impact" renamed to **Revenue opportunity pending**; honest zero states on every card ("No pending recommendations yet", "Approve recommendations to see the impact here", "Need decisions to calculate", "Decide recommendations to track this").
- New accessible `Tip` primitive: every KPI card shows a hover/focus tooltip explaining what the metric means (`KPI_TOOLTIPS` in the model layer).
- The zero pending-impact value is formatted in a currency the store actually uses, falling back to a currency-neutral `0` — never an invented symbol.

### Professional empty state (Issues 2, 5, 8)
- "Your AI team is ready to work" replaced by compact, action-oriented **"Ready to analyze your store"** + a prominent **Run First Analysis** CTA and a How-it-works link.
- Clickable rule cards with icon, description, and a **"Uses: Products / Customers / Checkouts / Orders"** data badge; each opens a new **rule detail modal** (trigger, impact, data source, accountable agent, healthy state — plan-gated agents keep their lock + Upgrade plan CTA).
- "What to expect after an analysis" grid: specific actions, impact estimates, approve/reject workflow, results tracking.
- Expandable **How rules work** strip with the data-flow diagram (Synced store data → 8 deterministic rules → Priced recommendations → Your decision) and trust indicators (Never invents numbers · Grounded in your synced data · You approve every action · SHA-256 evidence).
- **Clearly-labeled SAMPLE recommendation preview** with disabled actions that explain themselves ("This is a preview — run an analysis to get real recommendations").

### Rich Run Analysis experience (Issue 3)
- **Staged progress modal** replaces the fire-and-forget toast: six real engine phases (products → customers → inventory → orders → rules → composing), animated progress bar that parks below 100% until the API responds, elapsed timer, and a "Keep browsing" escape that never cancels the run.
- Zero-result runs now land a full **Store Health Check Complete** panel: products/customers/checkouts/orders analyzed, **8/8 rules checked**, deterministic store-health grade (Excellent/Good/Fair/Needs attention/Learning), a per-rule all-clear breakdown ("No stockout risks — every selling product has more than a week of cover", …), snapshot freshness, and CTAs to Analytics / Automation / How-it-works / Re-run.
- When signals matched already-open recommendations the panel swaps the breakdown for an honest dedup note instead of claiming "all clear".
- "Last analysis · Xm ago" stamp appears in the header after a run.

### Educational sidebar (Issue 4)
- **Pending by agent**: full roster of all 7 agents always visible — one-line role, real pending counts, distribution bars, click-to-filter. Plan-locked agents keep their lock, required-plan chip, and billing navigation.
- **30-day activity**: populated state gains generated/approved totals; empty state shows an axis-labeled chart with an opt-in "See sample activity" overlay explicitly watermarked SAMPLE.
- **Top rules firing**: all 8 rules listed with 0 triggers when empty (click for the detail modal); populated rows gain share-of-total bars and real trigger counts.
- **Recent decisions**: empty state teaches what lands here plus a SAMPLE preview row; populated state gains approval-rate and avg-decision quick stats.

### Toolbar and polish (Issues 6, 7, 8)
- Status tabs carry hover tooltips explaining each state; search placeholder is now "Search by title, product, customer, or rule…"; the sort select explains how ranking works.
- Transition polish across tabs, chips, rule cards, and sidebar rows; light-mode variants for every new surface.

### API (analysis transparency)
- `POST /recommendations/analyze` now returns `rulesChecked` (derived from the live rule catalog) and `snapshotStats` (products/customers/checkouts/orders/dataFreshAt/currency) so the report panel renders measured facts instead of UI claims. Additive and backward-compatible.

## Honesty & constraints

- No fake data: sample previews are explicitly labeled; the "next automatic scan" style copy was deliberately avoided because analysis is on-demand — the panel says so and shows real snapshot freshness instead.
- Plan gating untouched (locked agents, usage banners, 402/403 flows); CTAs say "Upgrade plan", never "Upgrade to <plan>".
- Existing behaviors preserved: deep links, undo snackbar, bulk decisions, snooze, evidence drawer + SHA-256 verification, reject reasons, pagination.

## Validation

- Full suite green: **148 files / 1,479 tests** (added a permanent jsdom runtime suite for the workspace — mount → first-run state → progress modal → health-check panel, populated render, and limit gating — plus model-map and health-tone unit tests and an API contract test for `snapshotStats`/`rulesChecked`).
- `pnpm -r typecheck` clean; web production build clean.
- Visual verification without a backend: `pnpm dev` in `apps/web`, then open `/recs-verify.html` — real workspace in empty / populated / limit states, both themes, with the report panel and progress modal rendered inline (dev-only page, excluded from the production build).
