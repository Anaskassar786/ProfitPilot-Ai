# Help & Support (Support Tickets) — Professional Redesign · Functional Test Report

**Scope:** Support Tickets page only (`apps/web/src/support.tsx`, `support-model.ts`, `support.css`, plus its nav/meta wiring in `App.tsx`). No other module was touched.

**Result: ✅ ALL TESTS PASS** — 60/60 new tests, 2,342/2,342 monorepo tests, TypeScript clean, and a real-browser pass with **zero console errors** on both themes.

---

## 1. What changed (per the PR spec)

| Fix | Status |
|---|---|
| **FIX 1 — Rename & redesign** | ✅ "OPERATOR INBOX"/"Support tickets" → **"Help & Support"** everywhere (sidebar, page title, topbar). Description → *"Get help from our team. We track every question and respond quickly."* The internal note ("Duplicate 'New merchant question' tickets are no longer created") is gone. "SUPPORT INBOX" → "YOUR TICKETS". Empty title → "All Clear! No open tickets." |
| **FIX 2 — FAQ / self-help** | ✅ 📚 **QUICK ANSWERS** with the four category cards (Getting Started, Billing & Plans, AI Features, Technical Help) + ❓ **COMMON QUESTIONS** with the seven expandable questions from the spec + **View all FAQs** → the full 12-question library grouped by category. Answers reference real ProfitPilot modules only — no invented features. |
| **FIX 3 — Better empty state** | ✅ 🎉 **All Clear!** banner ("Your store is running smoothly!") + the three fastest-help options — **Ask AI Command** (instant answers), **Browse FAQs**, **New Ticket** (complex issues) — plus the tip *"AI Command can answer 80% of questions instantly!"* |
| **FIX 4 — Plan-based support** | ✅ Real plan from `/billing`. Trial **2/month · 48h** · Start **5/month · 24h** · Growth **unlimited · 12h** · Commander **unlimited · 4h priority + priority queue**. Plan card shows 💎 plan, tickets `0/2 this month` with a usage meter, response target, and priority-queue status. **The Trial 48h/24h bug is fixed** — the old page hardcoded a Growth "24h" badge for everyone. |
| **FIX 5 — Better ticket form** | ✅ 📧 CREATE SUPPORT TICKET: 6 categories (Billing & Plans, Technical Issue, Feature Request, Data & Sync, AI Features, General Question), Low/Normal/High priority radios with merchant hints, subject (160 chars) + description with spec copy, 📎 Attach Screenshot (name + size ride along in the ticket description — no fake upload promise), Cancel / Submit Ticket. |
| **FIX 6 — Support history** | ✅ 📋 YOUR TICKETS: open tickets as cards (status dot, subject, "Created: Aug 18, 2026", "Priority: Normal", "Awaiting response", expandable details incl. ticket ID + response target) + **Past Tickets:** ("No resolved tickets yet." when empty). |
| **FIX 7 — Both themes** | ✅ Light: `#F8FAFC` canvas, `#FFFFFF` cards with `#E2E8F0` borders + soft shadows, visible FAQ cards, strong status colors (#047857/#B45309/#1D4ED8), prominent gradient buttons. Dark: untouched deep-space palette with enhanced focus borders on cards/FAQ/tickets. Nothing below 12px in either theme. |
| **FIX 8 — Testing** | ✅ See below — every checklist item is executable. |

### Honesty guarantees (zero fake data)
- Tickets come from `/support/tickets`; the plan comes from `/billing`. Nothing is seeded or invented.
- Trial stores send `plan: 'start'` to the support API (the API accepts only start/growth/commander) — the old page hardcoded `'growth'`, silently inflating trial tickets to HIGH priority. The merchant's chosen priority is sent explicitly.
- A store that isn't connected sees FAQ + AI Command and an honest "Connect your Shopify store" message instead of a ticket form that can't submit.

---

## 2. Test suites added (60 tests)

| Suite | File | Tests | Covers |
|---|---|---|---|
| Model | `apps/web/src/support-model.test.ts` | 22 | Tier matrix, 48h/24h/12h/4h badges, plan resolution from billing, monthly quota (2/5/∞/∞) incl. month rollover, category/priority mapping, API-plan honesty, subject composition + 200-char cap, attachment notes, open/past split newest-first, status/priority labels, date formatting, FAQ completeness |
| Static UI | `apps/web/src/support-ui.test.tsx` | 12 | Renames (no jargon anywhere), FAQ section + 4 categories + 7 questions collapsed by default + View all FAQs, empty state copy + 3 options + tip, plan card per plan, Trial never shows 24h, Upgrade Plan on upgradeable plans / congratulations on Commander, zero seeded tickets |
| Functional (jsdom mount) | `apps/web/src/support-functional.test.tsx` | 17 | Full interaction: form open, category via listbox, priority radio, subject/description typing, validation blocks, submit POST body (subject prefix, priority, plan, description), ticket appears in YOUR TICKETS, details expand, past tickets separate, Trial limit blocks form + Upgrade routes to billing, Growth never blocked, no-store behavior, zero console errors |
| Themes | `apps/web/src/support-light-theme.test.ts` | 9 | Light `#F8FAFC`/`#FFFFFF`/`#E2E8F0`/shadow contracts, strong status colors, prominent buttons, dark theme untouched, scoped selectors only (no bleed into other modules), ≥12px fonts, enhanced dark borders |

## 3. PR checklist — item by item

| Checklist item | How it's proven |
|---|---|
| Page loads (both themes) | Playwright screenshots dark + light (`docs/screenshots/support/`) + theme contract tests |
| No console errors | jsdom mount tests assert `consoleErrors === []`; Playwright pass captured **0 errors** on every screen |
| Title and description readable | Static UI tests + `after-empty-*.png` |
| "New ticket" button works | Functional test `opens the form from the header…` + browser pass |
| Ticket creation form opens | ✓ same |
| Category selection works | Functional test clicks the shared listbox → "Billing & Plans" |
| Priority selection works | Functional test selects High → POST `priority: HIGH` |
| Subject field works | Typed "Invoices are missing" → POST subject `[Billing & Plans] Invoices are missing` |
| Description field works | Typed text arrives verbatim in POST body |
| Submit ticket works | POST captured, form closes, success toast |
| Ticket appears in list | List refresh shows `1 open ticket` + subject |
| Status updates correctly | `OPEN → Awaiting response`, `IN_PROGRESS → In progress`, `RESOLVED → Resolved` |
| "24h response target" accurate for plan | Badge tests per plan; Trial asserts 48h and never 24h |
| FAQ section displays | Static + functional + screenshots |
| FAQ items expandable | Functional: expand reveals answer; collapse hides |
| "Ask AI Command" link navigates | Functional test (navigates) + Playwright: hash becomes `#/ai-command` |
| Plan restrictions enforced | Trial at 2/2 blocks the form with an upgrade panel; 12 Growth tickets don't block |
| "Upgrade Plan" routes to billing | Functional test + Playwright: lands on the Billing page, 0 console errors |
| Empty state helpful | "All Clear!" + 3 options + tip, all covered |
| Both themes professional | Contract tests + verified screenshots (white cards / #F8FAFC in light; deep surfaces in dark) |
| No bugs anywhere | Full monorepo suite green, TypeScript clean |

## 4. Verification runs

| Command | Result |
|---|---|
| `pnpm vitest run` (support suites) | **60/60 passed** |
| `pnpm test` (full monorepo) | **190 files / 2,342 tests passed** |
| `pnpm typecheck` | **passed** (exit 0) |
| `pnpm build` | **passed** |
| Real browser (Chromium 149, mocked honest API) | All screens render, **zero console errors**; "Ask AI Command" → `#/ai-command`; "Upgrade Plan" → Billing |

> Note: the repo-wide **coverage gate** (`functions ≥ 80%`) was already red **before** this PR (78.67% on the base commit). This PR raises it to 78.78% — `support-model.ts` lands at 100% functions / 98.97% lines. The gate is a pre-existing condition, not a regression from this change.

## 5. Screenshots (`docs/screenshots/support/`)

Before: `before-empty-dark.png`, `before-empty-light.png`, `before-tickets-dark.png`
After: `after-empty-dark.png`, `after-empty-light.png`, `after-form-dark.png`, `after-tickets-dark.png`, `after-tickets-light.png`, `after-faq-expanded-light.png`

All captured at 2× DPI against a mocked honest API (empty store data, real endpoints, no fabricated rows).
