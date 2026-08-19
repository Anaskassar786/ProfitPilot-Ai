# Help & Support — Professional Redesign (FAQ · Plan-Based Support · Empty States · Both Themes)

Support Tickets is now **Help & Support**: merchant-friendly language, a real self-help FAQ, plan-based support tiers, a three-path empty state, a proper ticket form and history, and an ultra-professional look in both themes. Support page only — no other module touched.

## What changed

### 🚨 Renamed & redesigned
- Sidebar + page title: **Support tickets → Help & Support**; eyebrow "Operator inbox" → "Help Center"
- New description: *"Get help from our team. We track every question and respond quickly."*
- Removed the internal note about duplicate tickets, "SUPPORT INBOX" → **YOUR TICKETS**, empty title → **"All Clear! No open tickets."**
- Extracted the page from `App.tsx` into a dedicated `support.tsx` + `support-model.ts` (pure logic) + `support.css` (scoped tokens, both themes)

### 📚 FAQ / self-help (before ticket creation)
- **QUICK ANSWERS** — four category cards: Getting Started · Billing & Plans · AI Features · Technical Help
- **COMMON QUESTIONS** — the seven top questions, expandable, plus **View all FAQs** for the full 12-answer library
- Every answer names a real ProfitPilot module (Sync all, Billing, Recommendations, Automation templates…) — zero invented features

### 🎉 Helpful empty state
- "All Clear!" banner + three fastest options: **Ask AI Command** (instant answers about your store) → navigates to AI Command, **Browse FAQs**, **New Ticket**
- Tip line: *"AI Command can answer 80% of questions instantly!"*

### 💎 Plan-based support (from the real billing account)
| | Trial | Start | Growth | Commander |
|---|---|---|---|---|
| Tickets/month | 2 | 5 | Unlimited | Unlimited |
| Response target | 48h | 24h | 12h | **4h Priority** |
| Priority queue | ❌ | ❌ | ❌ | ✅ |

- Plan card: plan name, `0/2 this month` usage meter, response target, priority-queue status
- **Bug fixed:** the old page showed a hardcoded Growth "24h" badge — Trial now correctly shows **48h** everywhere
- Quota enforced client-side from real ticket history (calendar-month window); reaching the limit shows an upgrade panel instead of the form
- **"Upgrade Plan" is always present** (shared global CTA) and routes to Billing; Commander sees a "top plan" thank-you

### 📧 Better ticket form
- Six categories, Low/Normal/High priorities with merchant hints, subject + description per spec copy, 📎 Attach Screenshot (file name + size ride along in the description — no fake upload), Cancel / Submit
- Honesty fix: the old form sent `plan: 'growth'` for everyone (inflating trial tickets to HIGH priority). The plan sent now never exceeds what the merchant actually has.

### 📋 Support history
- Open tickets as expandable cards (status dot, subject, *Created: Aug 18, 2026*, *Priority: Normal*, *Awaiting response*, details with ticket ID + response target)
- **Past Tickets:** with honest *"No resolved tickets yet."* empty state

### 🌗 Both themes professional
- Light: `#F8FAFC` canvas, white cards, `#E2E8F0` borders, soft shadows, strong status colors, prominent gradient buttons
- Dark: untouched deep-space palette with enhanced focus borders; nothing under 12px in either theme

## Testing — ✅ all green
- **60 new tests** across 4 suites (model, static UI, jsdom functional, theme contracts) — every item of the PR checklist is executable
- **Full monorepo: 190 files / 2,342 tests passed**; `typecheck` and `build` clean
- Real-browser pass (Chromium, mocked honest API): every screen, both themes, **zero console errors**; Ask AI Command → `#/ai-command`; Upgrade Plan → Billing
- Coverage gate note: repo-wide `functions ≥ 80%` was already failing on the base commit (78.67%); this PR improves it to 78.78%

## Screenshots
`docs/screenshots/support/` — before/after, dark/light, empty state, form, ticket history, expanded FAQ (2× DPI).

## Files
- New: `apps/web/src/support.tsx`, `support-model.ts`, `support.css`, `support-model.test.ts`, `support-ui.test.tsx`, `support-functional.test.tsx`, `support-light-theme.test.ts`
- Modified: `apps/web/src/App.tsx` (nav label, page meta, router, old inline page removed), `apps/web/src/main.tsx` (CSS import)
- Docs: `SUPPORT_HELP_REDESIGN_TEST_REPORT.md`, `docs/screenshots/support/*`
