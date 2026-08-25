# ProfitPilot — Final Bug Squash, Logic Fixes & Full App QA Sweep

**Date:** 2026-08-25 · **Branch:** `arena/01a0380a-profitpilot-ai` · **Baseline:** commit `5422eeb` (main)

Result: **All 5 tasks complete. Typecheck 0 errors · clean build · 3,208 tests passed | 1 skipped (baseline 3,188 → +20 new tests, zero regressions).**

---

## Task 1 — Dashboard Performance Score: visual & honesty fix ✅

**Bug:** the score ring is a full 360° `conic-gradient`, but the sweep was computed as
`score × 2.4` — a perfect 100/100 only filled **240°** (~2/3 circle), so the ring always
looked incomplete.

**Fix:**
- New shared, tested helper `healthGaugeSweep(score)` in `apps/web/src/model.ts`:
  maps 0–100 → `score × 3.6` degrees (100 → exactly **360° = closed circle**), clamps
  out-of-range values, 8° visibility floor for live scores.
- Applied to **all three** gauges that render the ring:
  - `apps/web/src/dashboard.tsx` (`HealthGaugeWidget`)
  - `apps/web/src/App.tsx` (`HealthGauge` — Settings/billing page)
  - `apps/web/src/inventory.tsx` (`InventoryHealthCard` large gauge)

**Honesty check (verified):**
- Score is computed **only from real synced API data** (`fetchAnalytics`/`fetchCatalog`;
  failures render empty states — "never demo data").
- `storeHealthView` has **no division** (no 0/0 path): empty snapshot → `null` → "NO DATA";
  zero-value rows are capped ≤ 45 ("Needs attention" at best); fully stale 30-day window
  capped ≤ 30 ("Critical"); score hard-capped at 100 and only reachable when revenue,
  orders, product sales, cohorts, and catalog all show **real recent activity**.
- `calculateGrowth` already guards `previous === 0`.
- New regression tests in `apps/web/src/model.test.ts` ("Performance Score honesty + ring
  math"): 0 sales ≠ 100, stale data caps, 100 requires real data, `healthGaugeSweep(100) === 360`,
  monotonicity, clamping.

## Task 2 — Billing UI: button colors & invisible banner text ✅

**2.1 "Choose plan" buttons (all 3 tiers):**
- Root cause found: Polaris Button **does not accept `className`** — the old
  `.billing-plan-cta` CSS rules were dead (never matched the DOM), so merchants saw
  Polaris' default **charcoal primary** button.
- New CSS in `apps/web/src/billing.css` scoped to the real DOM (`.billing-plan-card > button`):
  vibrant royal-blue/primary-indigo gradient (`#2563eb → #4f46e5`), **white text**, clear
  hover/active/disabled states — implemented by overriding Polaris' `--pc-button-*`
  custom properties (the variables the component itself drives, so all states recolor
  without specificity fights). Full-width layout (42px, card-inset) restored.
- New DOM-contract test in `billing-meters.test.tsx` pins that the CTA renders as
  `.Polaris-Button--variantPrimary` and that the wrapper class is not forwarded.

**2.2 "Gift access ended" banner white-on-white:**
- Root cause: the embedded app runs Polaris with its **light token set even in dark mode**
  (same bug class already documented in `analytics.css` for the inventory warning) — the
  banner's content box resolves to a **white surface** while body text inherits the app's
  near-white text color → invisible.
- Fix: all billing banners are wrapped in `.billing-banner-scope`; `billing.css` forces a
  white banner surface with **explicitly dark text — body `p`/`span` at `#0f172a`**, dark
  slate title, tone-correct icons (amber warning / red critical) — readable in both themes.
- Bonus honesty fix: the banner body now distinguishes **forfeited** trials ("…the free
  trial was forfeited when the gift was redeemed…") from the non-forfeited copy, so the
  message is never misleading.
- New structural test pins the wrapper/scope contract.

## Task 3 — Trial forfeiture after gift expiry (critical) ✅

**Bug:** after a gift expiry, stores could be offered their remaining 14-day trial
("10 of 14 days remaining") even though `trial_forfeited = true` — possible whenever the
stored trial row was inconsistent (`state = 'ACTIVE'` with a future `expires_at` alongside
the forfeit flag) or missing.

**Fix (defense in depth, single source of truth):**
1. `normalizeForfeitedTrial()` — new exported helper in `packages/billing/src/trials.ts`:
   `trialForfeited === true` ⇒ the trial is normalized to `CANCELLED`, `consumed`,
   window clamped to the past — **at every read boundary**:
   - `TrialAndGiftLedger.trial()` (in-memory ledger: normalize + repair the cached row)
   - `PostgresTrialGiftStore.trial()` and `.ensureTrial()` (normalize + **persist the
     repair** back to the DB, best-effort)
2. `expiredGiftRevert()` hardened: `trialActive` now requires `!trialForfeited &&
   !consumed && state === 'ACTIVE' && expiresAt > now` — so **`gift_code_expires_at` in
   the past AND `trial_forfeited === true` ALWAYS resolves to `TRIAL_EXPIRED`**
   (upgrade required), never `TRIAL_LIMITED`.
3. **No resurrection:** `startTrial()` (in-memory) and `PostgresTrialGiftStore.ensureTrial()`
   never issue a fresh 14-day trial to a store with a prior gift redemption — they create
   a voided, forfeited record instead (resolves to `TRIAL_EXPIRED`).
4. `billing.ts` state machine documented: `GIFT_ACCESS_UNLIMITED → trial_expired →
   TRIAL_EXPIRED` is the forfeited outcome; forfeit-aware resolution lives in
   `expiredGiftRevert` (context-dependent, correct place).

**Frontend lock state (`apps/web/src/App.tsx`):**
- "N of 14 days remaining" progress bar can never render for a forfeited trial
  (`state === 'ACTIVE' && !trialForfeited`).
- `humanizeBillingStatus`: forfeited ACTIVE rows no longer label "Free Trial"; an expired
  gift with a dead trial labels **"Gift ended — upgrade required"** (previously fell
  through to a misleading "Gift Access").
- Gift-ended banner copy is forfeit-aware (see Task 2.2).

**New tests (7):** inconsistent legacy row ⇒ `TRIAL_EXPIRED`; normalizer idempotency;
ledger never reports ACTIVE/forfeited with days remaining; full redeem→expire scenario
locks the store; consumed trials can't resume; `startTrial` never resurrects after
redemption; Postgres store repairs + persists a legacy ACTIVE/forfeited row.

## Task 4 — Foolproof Shopify test-charge fallback (red error fix) ✅

**Fix (in `packages/billing/src/shopify-billing.ts`):**
1. **Bulletproof test-mode detection** — new `testChargeForcedByEnv()`:
   `SHOPIFY_BILLING_TEST === 'true'` OR `NODE_ENV !== 'production'` ⇒ test charges,
   resolved *before* any shop probe (no wasted API call in dev). Detection order:
   explicit `testMode` config (production operator intent) → environment forcing →
   shop-plan probe. The API bootstrap already enforced this for its client; the worker's
   `billingTestMode` (`apps/worker/src/billing-job.ts`) now mirrors it.
   - **Engineering note on the requested `shopDomain.endsWith('.myshopify.com')` clause:**
     every Shopify store — **including production stores** — is served from a
     `*.myshopify.com` domain, so applying it unconditionally would turn every real
     subscription into a test charge and break revenue. It is therefore folded into the
     non-production branch (where it is implied); in production the shop-plan probe +
     the auto-retry below decide. If you specifically want it, say so and it can be
     re-enabled behind a production kill-switch.
2. **Auto-retry fallback** in `appSubscriptionCreate`: the create is wrapped; if it fails
   with the **specific** rejection (error text containing `test charges` or
   `Custom apps cannot use the Billing API`, checked across message, upstream body, and
   field-level validation errors via new `isTestChargeOnlyRejection()`), it is logged
   (`warn`, with the rejection) and the mutation is **re-executed once with `test: true`**.
   The merchant never sees the red error. Unrelated 422s (price/name validation) are
   rethrown untouched, and a charge already sent as `test: true` is never retried.

**New tests (6):** retry on userErrors-level test-charge rejection; retry on HTTP 422
test-charge rejection; no retry for unrelated 422s; no double-send for test charges;
env-forcing skips the probe outside production; rejection-classifier unit coverage.
The two probe tests now stub `NODE_ENV=production` so they continue to exercise the
production probe path (behavior unchanged in production).

## Task 5 — Full app QA sweep & verification ✅

**Static UI sweep** (Dashboard, Products, Orders, Customers, Inventory, Analytics,
AI Command, Recommendations, GrowthIQ, Automation, Store Coach, PatternAI, Reports,
Exports, Settings):
- All 15 major pages are routed in `PageRouter` with loading/empty/error states and a
  `EmptyDataPage` fallback.
- **No dead links:** zero `href="#"` in production code; the only `#…` anchors
  (`#main-content`, `#exec-*` in Executive Reports) all resolve to existing element ids.
- **No raw 500s:** the API terminal error handler returns sanitized JSON envelopes
  (`Internal server error` for non-exposed errors; full detail server-side logs only);
  UI catches surface humanized messages (e.g. "The API could not be reached.") — no
  stack traces or upstream bodies reach the merchant.
- **No placeholder/fake data in production surfaces:** the only mock datasets live in
  dev-only visual harnesses (`verify.html`, `*-verify.html`, `preview.html`) that are
  **not** part of the Vite build output; `jarvis-mic.html` is a microphone test page
  tied to the intentionally-disabled Jarvis voice feature (all references commented
  `TODO(jarvis)`, removed from nav and router).

**Verification:**
| Check | Result |
|---|---|
| `pnpm typecheck` | **0 errors** (all 17 workspace packages) |
| `pnpm build` | **Clean** (tsc for every package + Vite web build) |
| `pnpm test` | **3,208 passed · 1 skipped · 0 failed** (baseline: 3,188 passed · 1 skipped → **+20 new tests, 0 regressions**) |

---

### Files changed
| File | Change |
|---|---|
| `apps/web/src/model.ts` | `healthGaugeSweep()` helper; `BillingAccount.trial.trialForfeited` type |
| `apps/web/src/dashboard.tsx` · `App.tsx` · `inventory.tsx` | gauges use `healthGaugeSweep` |
| `apps/web/src/model.test.ts` | 5 new honesty + ring-math tests |
| `apps/web/src/billing.css` | royal-blue plan CTAs (real DOM scoping); `.billing-banner-scope` readable banners |
| `apps/web/src/billing-meters.test.tsx` | 3 new DOM-contract tests (CTA + banner) |
| `apps/web/src/App.tsx` | forfeit-aware banner copy/status, trial-progress guard, lock-state labels |
| `packages/billing/src/trials.ts` | `normalizeForfeitedTrial()`, hardened `expiredGiftRevert`, read-boundary normalization + DB repair, no-resurrection guards |
| `packages/billing/src/billing.ts` | state-machine documentation for gift-expiry resolution |
| `packages/billing/src/shopify-billing.ts` | env-forced test mode + auto-retry with `test: true` on test-charge-only rejections |
| `apps/worker/src/billing-job.ts` | worker `billingTestMode` mirrors API env guards |
| `packages/billing/src/f5-billing.test.ts` · `f5-shopify-billing.test.ts` | 13 new tests (forfeiture + retry fallback) |
