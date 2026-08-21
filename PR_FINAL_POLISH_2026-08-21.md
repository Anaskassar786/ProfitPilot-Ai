# fix(ui, logic): reorder nav, redesign AI command center, fix reports, audit trial and gift code flows

Final pre-submission polish PR — everything in one focused change set for the Shopify App Store review.

## 1. Header navigation — exact 18-tab merchant-approved order
`apps/web/src/App.tsx`, `apps/web/src/header-navigation.css`

- `HEADER_NAV` reordered to the exact approved sequence: Dashboard → Products → Orders → Customers → Inventory → Analytics → **AI Command Center** → **AI Commander** → Recommendations → GrowthIQ → Automation → Store Coach → PatternAI → Reports → Exports → Billing → Help & Support → Settings.
- Both AI Command Center (`/command`) and AI Commander (`/ai-command`) are visible as **separate tabs** — they are different live pages.
- **Analytics, Exports, and Help & Support were missing from the header — added.**
- Tabs stay SPA-only buttons wired to client-side `navigate()` (history.pushState) — never `<a href>`; back/forward now also keeps `/command` in sync.
- Dev/hidden pages (Admin Ops, QA Chart Board, Jarvis) are not in the header.
- New regression test `header-nav-order.test.ts` pins the exact 18-tab sequence, the "no anchors" rule, and the theme-token CSS contract.

## 2. Dark mode — top nav bar follows the Shopify Admin theme
- `header-navigation.css` rebuilt on Polaris tokens: `background: var(--p-color-bg-surface)`, `border-color: var(--p-color-border)`, `color: var(--p-color-text)`, active tab `var(--p-color-text-brand)`. No hardcoded `#FFFFFF` / `white` anywhere in the bar; it now follows Light **and** Dark themes.

## 3. Light mode — icons visible
- Custom SVG logos (PatternAI / GrowthIQ / AI Command) audited — they already use gradient plates + `currentColor`-independent brand strokes that read on both themes; no `fill: white` icon regressions found.
- Command Center icon tiles and status glyphs verified against the light-theme palette (WCAG AA contracts in `command-center-light.test.ts`).

## 4. AI Command Center — enterprise-grade redesign
`apps/web/src/command-center.tsx`, `command-center.css`, `command-center-light.css`

- Polaris-native chrome: `Layout` / `BlockStack gap="400"` page structure, `InlineGrid columns={{xs:1,sm:2,md:4}}` KPI row, `Badge` statuses, `Text variant="headingLg"/"headingXl"`, `ProgressBar` confidence, `InlineStack` error banner, `Button variant="plain"` view-details.
- **Top KPI row** (Store Health Score / AI Actions / Insights Today / Active Agents) — equal-height cards with a `cc-kpi-body` flex region and `margin-top:auto` footer so there is never empty space at the bottom; sparklines sized to fit.
- **Your AI Team** section with `Text` section titles, status badges (Active/Paused), version chips, 2-line taglines, stats rows, confidence bars, `View details` plain buttons.
- **AI Growth Command** 3-module grid (Store Coach / GrowthIQ / PatternAI) with Available/Requires-Growth badges, plan-availability lines, bordered sample-insight quotes, `Details` + `Open [Name]` actions.
- **Jarvis "Coming Soon" card DELETED entirely.** All merchant-visible "Coming Soon" labels removed: Command Center settings rows (notifications/auto-run), the Campaigns placeholder page (redirects to Copilot/real pages), and the standalone `ai-command-preview.html` attachment tooltips.
- **Activity feed concatenation fixed** (`Inventory AgentUnlock cash in The Draft SnowboardAPPROVED…`): rows now use `RichButton` (UnstyledButton) which preserves child structure, with Polaris `Badge tone="success"/"critical"/"attention"` statuses, separate agent / title / time cells and `aria-label` describing the full event.
- Growth path, Start-plan value card, Commander actions + Live snapshot preserved and made Polaris-native.

## 5. Reports — stuck "Generating…"/"Processing…" fixed
`packages/reporting/src/f8-vault.ts`, `apps/api/src/f8-bootstrap.ts`, `apps/web/src/reports.tsx`

- **Backend:** every stage now logs `[REPORTS] Started generating report <id>` / `[REPORTS] Completed report <id>` / failure. Stale `GENERATING` runs (crashed worker / timed-out request) are recovered to `FAILED` on every `list()` and before retry (`STALE_GENERATING_MS` = 10 min) so a run can never spin forever.
- **Frontend:** 5s polling while any run is generating; `GENERATING` rows show a Polaris `loading` button **plus a Retry**; `FAILED` rows show Retry. The ugly black disabled button is gone.
- New test: stale-run recovery → FAILED, fresh runs untouched, retry re-completes.

## 6. Trial (14-day) & gift code audit — bulletproofed
`packages/billing/src/trials.ts`, `apps/api/src/billing-routes.ts`, `apps/api/src/f5-bootstrap.ts`, `apps/web/src/App.tsx`

- **Trial:** new installs auto-start a 14-day Trial (`ensureTrial`). Day-15 expiry shows a Polaris **"Trial expired — upgrade to continue"** critical banner; paid features lock while Dashboard/sync keep working (trial state `EXPIRED` → subscription `PENDING_CONFIRMATION`). Upgrading **during** the trial now actually cancels the trial (`cancelTrial` wired into mock + real charge paths). Uninstall/reinstall keeps the same `trials` row (no trial re-triggering).
- **Gift codes:**
  - Valid `KASSAR786`/`AFRIDI786` → Commander for exactly `durationDays` (72h), stored in Postgres (`gift_redemptions`) so it survives restarts.
  - Gift **overrides** the trial while its window is open; the trial is left intact so the store **reverts** to Trial (if still valid) or locked when the gift ends — enforced on every `GET /billing` and `GET /billing/usage` via `expiredGiftRevert()`.
  - After expiry the merchant sees a **"Gift access ended — upgrade to keep Commander features"** warning banner and Commander perks lock.
  - Redemption is now **atomic**: `FOR UPDATE` row lock on `gift_codes` + redemption INSERT + use-counter increment in one transaction (no double-redemption race, no crash-orphaned uses). Double redemption → 409 "already redeemed"; invalid/expired/exhausted → clear 400s; gift on an active paid plan → 409.
- Billing checkout stays mock (`BILLING_MOCK_CHARGES`); real Shopify checkout untouched. GDPR handlers untouched.

## 7. SPA tab-switching restored to instant
`apps/web/src/data-cache.ts` (new), `command-center.tsx`, `reports.tsx`, `automation-hooks.ts`, `store-coach.tsx`

- New module-scope **stale-while-revalidate cache**: pages seed their state from the last-good payload (no spinner), then silently refresh in the background. Tab A → B → A now renders instantly.
- Applied to the heaviest pages: AI Command Center (6 fetches), Reports (4 fetches), Automation (5 fetches), Store Coach (12 fetches). Concurrent double-mounts dedupe via an inflight map; mutations invalidate the cache.
- No inline component definitions or forced remounts added — `PageRouter` structure unchanged.

## Test infra (no behavior change)
- Fixed the systemic Polaris test harness failures that existed at HEAD: SSR tests now render inside `AppProvider` (i18n), jsdom mount tests stub `matchMedia` before Polaris loads, and `polaris-ui-regression.test.tsx` resolved `src/…` relative to the repo root instead of `apps/web/src/`.
- Global `vitest.setup.ts` clears the new SPA data cache between test cases.

## Verification
- `pnpm build` ✅ (all 19 packages, incl. `vite build`)
- `pnpm typecheck` ✅ 0 errors
- Full test suite: **2861 passed / 111 failed** (baseline at HEAD: 2518 passed / 281 failed) — every remaining failure is pre-existing behavioral drift in unrelated pages (verified identical at HEAD); all 13 PR-related suites (331 tests) pass.
- New tests: header nav order (4), stale report recovery, gift-expiry revert (4), trial-cancel-on-upgrade, atomic redemption guards.

## Rules respected
- No real Shopify billing checkout wiring (mock retained). GDPR handlers untouched. Sync engine untouched. Tenant isolation intact (all queries remain store-scoped). Polaris components/tokens only — no custom design-system regression. No lorem ipsum / fake data.
