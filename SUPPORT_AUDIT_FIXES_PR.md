# PR: Help & Support — Full Audit, 5 Real Fixes + Durable Ticket Storage

**Date:** 2026-08-19 · **Scope:** Help & Support page end-to-end (UI → API → persistence)

A complete inspection of the Help & Support surface — every button clicked, every
state exercised, every backend route traced to its data store. The audit found
**five user-visible defects** and **one production-critical data-loss bug**.
All are fixed here, each locked in by new executable tests.

---

## 🔍 What the audit found (and what was fixed)

### FIX 1 — Production-critical: tickets were stored in process memory, not Postgres

`f6-bootstrap.ts` wired `tickets: new ThreadLedger()` — an **in-memory Map**.
Every API restart or redeploy wiped every merchant's tickets: the Help & Support
page would silently return to "All Clear!" and the monthly quota would reset.
This despite migrations `0008` + `0014` having created `support_tickets` and
`support_thread_messages` tables **with row-level tenant isolation policies**
long ago — the durable wiring was simply never done.

- New `PostgresTicketRepository` (`packages/automation/src/tickets.ts`) persists
  tickets and thread messages through `withTenantContext`, matching the pattern
  of every sibling repository (`PostgresWorkflowRepository`, …). Includes
  `get`, `addMessage` (with version bump), `messagesFor`, and an
  optimistic-concurrency `setStatus` — the operator tooling surface is now
  fully backed, not just the two routes in use today.
- New `TicketStore` interface decouples the routes from the concrete store;
  `ThreadLedger` remains as the test double.
- Production bootstrap now wires `new PostgresTicketRepository(f5.database)`.
- `GET /support/tickets` became an `asyncRoute` — a durable async store must be
  awaited, not serialized as a pending Promise.

### FIX 2 — No loading state: first paint claimed "All Clear!" while tickets loaded

The tickets area had no loading UI at all. On every page load merchants briefly
saw the celebratory *"All Clear! No open tickets — your store is running
smoothly!"* banner — then it flipped to real tickets if any existed. A false,
flickering promise.

- New `SupportLoadingState`: spinner + shimmer skeleton bars, `aria-busy`,
  `prefers-reduced-motion` respected. Renders until the first fetch settles.
- The "All Clear!" celebration now only paints after a **successful** fetch
  returned zero tickets.

### FIX 3 — A failed fetch masqueraded as "All Clear!"

If `GET /support/tickets` failed, the page showed a toast for a second and then
proudly displayed the empty-state celebration — an error indistinguishable from
success, with no way to recover short of reloading the browser.

- New `loadFailed` state: the tickets area renders `SupportLoadError` —
  a `role="alert"` card explaining the situation honestly, with a working
  **Try again** button (`Checking…` while retrying) that re-runs the fetch.
  FAQ and AI Command paths stay usable during the outage.
- A successful retry clears the error and paints the real list or empty state.

### FIX 4 — Past-ticket rows were dead buttons

"Past Tickets" rows rendered as `<button onClick={toggle}>` but clicking them
expanded **nothing** — the details panel existed only for open tickets. A
button that does nothing is a broken promise (and an a11y red flag).

- Past rows now expand in place with the full details body: description plus
  Status / Priority / Created / Last update / Ticket ID, `aria-expanded`,
  chevron rotation, single-expansion accordion shared with open tickets.
- Details markup refactored into a shared `TicketDetailsBody` component.

### FIX 5 — FAQ category "Read" button mis-toggled the library

The category card's **Read** button blindly toggled `showAll`: if the full
library was already open, clicking Read **collapsed** it back to the common
questions — the exact opposite of "read this category".

- Read now guarantees the library opens (`onShowAll`) and expands that
  category's first question without ever closing anything.

### FIX 6 — No way to re-check tickets from the empty state

With zero tickets there was no refresh path (the Refresh button lives in the
ticket-history header, which the empty state replaces). Merchants had to
reload the page to check for a support reply.

- The empty-state banner now carries a compact **Check again** action
  (shown when a store is connected).

### AUDIT-1 — verified NOT a bug, now guarded

The description-textarea placeholder and the submitted screenshot note use
real `\n` line breaks in source (verified at the byte level with `od`). New
regression tests lock the contract so no future edit leaks literal `\n`
characters into the UI or the API payload.

---

## 📋 Audit checklist — what was verified working

| Area | Result |
|---|---|
| Page load without console errors (both data paths settle) | ✅ works, now with honest loading paint |
| Plan card from the real billing account (Trial 0/2 · 48h; Growth unlimited · 12h; Commander 4h priority + no Upgrade CTA) | ✅ works |
| FAQ: 4 categories, 7 common questions, expand/collapse, View-all toggle | ✅ works (+ Read-button fix) |
| Ticket creation: category, priority, subject/description validation, 201 round trip, honest `start` mapping for trial, description + priority reach the API | ✅ works |
| Monthly limit gating (Trial 2/2 blocks form, Upgrade routes to Billing, Growth never blocked) | ✅ works |
| Open vs Past split, status badges, priority labels, date formatting | ✅ works (+ past rows now expand) |
| No-store state: FAQ usable, ticket creation blocked with guidance | ✅ works |
| Light theme + dark theme, 12px-min font rule, scoped CSS (no bleed into other modules) | ✅ works (contracts extended to new components) |
| Responsive breakpoints (1080px / 760px) including new states | ✅ covered |
| `POST/GET /support/tickets` validation, priorities, 400 on missing fields | ✅ works (+ async-store regression test) |
| Ticket persistence across restarts | ❌ **was broken** → ✅ Postgres-backed now |

## 🧪 Tests

- **2683/2683 tests pass (213 files)** — zero regressions across the monorepo.
- New `support-audit-regressions.test.tsx` — 8 tests, one per audit finding
  (AUDIT-2…6 each failed before the fix; AUDIT-1 guards the verified escaping).
- New `packages/automation/src/tickets.test.ts` — 9 tests: ThreadLedger basics
  plus PostgresTicketRepository mapping (`Date`↔epoch ms, empty description →
  absent field), parameterized tenant-scoped SQL, 409 on id conflict, 404 on
  unknown ticket, optimistic-concurrency status updates, message threads.
- `automation-routes.test.ts` — new round-trip test proving the routes await an
  **async** durable store (the production wiring shape) + a 400-validation test.
- `support-ui.test.tsx` — static-render contract updated: first paint is the
  loading card; the "All Clear" copy contract moved to the functional suite
  (it only paints post-load now).
- `support-functional.test.tsx` — empty-state copy asserted after loading settles.
- `tsc --noEmit` clean for `apps/web`, `apps/api`, and all packages.

## ⚠️ Notes for reviewers

- The ticket tables, columns, and RLS policies already exist (migrations 0008,
  0014) — **no new migration is required** for this change.
- Operator-side "reply to ticket" endpoints are still future work; the durable
  repository now supports them (`addMessage`/`messagesFor`/`setStatus`) and the
  thread tables are in place.
- RBAC has no `support:*` permission entries today, so the ticket routes keep
  their existing access shape (tenant-scoped queries behind session auth);
  introducing dedicated support permissions is tracked as a separate hardening
  item and does not belong in this UI-behavior PR.
