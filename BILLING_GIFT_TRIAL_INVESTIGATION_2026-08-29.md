# Billing Investigation — Trial Reset / Gift Code Reuse / Trial After Gift

**Date:** 2026-08-29
**Branch:** `arena/01a04bd5-profitpilot-ai`
**Scope:** `packages/billing/src/trials.ts`, `migrations/0007_billing_growth.sql`, `migrations/0031_gift_sequence_trial_forfeit.sql`

---

## Executive summary

| # | Reported symptom | Verdict |
|---|------------------|---------|
| 1 | Trial resets after app restart | **Not a code bug.** `started_at` is written once and never touched by any update path. Likely a migration/deployment state issue or a re-install. See diagnostics. |
| 2 | Gift code used multiple times on same store | **Guarded in current code** by a pre-flight check, an in-transaction check, and a `gift_redemptions.shop_id` PRIMARY KEY. If it's happening in production, the deployed version predates these guards or the PK is missing. See diagnostics. |
| 3 | Trial is granted after a gift code is redeemed | **Confirmed code bug — fixed.** The in-process trial cache is not refreshed after a Postgres gift redemption, so the pre-redemption `ACTIVE` trial resurfaces after the gift window closes. |

---

## Important limitation

This workspace is a **local sandbox**. It has **no `DATABASE_URL` connection to your production Postgres** and **no access to your Railway / production logs**, so I could **not** directly execute `SELECT * FROM trials WHERE shop_id = ...` or inspect production logs. Instead I:

1. **Read and traced the production code path** end-to-end (`PostgresTrialGiftStore`, `redeemGift`, `expiredGiftRevert`, `ExpiringGiftBillingRepository`).
2. **Burned the real code** (`pnpm build`) and **ran the actual test suite** (`vitest`) with a **stateful fake Postgres** that models the real SQL side effects.
3. **Reproduced issue #3 with a failing test**, then fixed the code and confirmed the fix with a regression test.

The diagnostic SQL/log commands below are for **you to run in production** to confirm issue #1 and #2.

---

## Issue #3 — CONFIRMED: stale in-memory trial cache resurrects the trial after a gift

### Root cause

`PostgresTrialGiftStore.redeemGift` (`packages/billing/src/trials.ts`) persists the forfeiture **in the database** inside its tenant transaction:

```sql
INSERT INTO trials (shop_id, started_at, expires_at, consumed, state, trial_forfeited)
VALUES ($1, to_timestamp($2 / 1000.0), to_timestamp($3 / 1000.0), true, 'CANCELLED', true)
ON CONFLICT (shop_id) DO UPDATE SET
  consumed = true,
  state = 'CANCELLED',
  trial_forfeited = true,
  expires_at = LEAST(trials.expires_at, to_timestamp($3 / 1000.0))
```

…but it **never updates the in-process cache** of the `TrialAndGiftLedger` that sits on top of Postgres.

The sequence that triggers the bug:

1. When a store first views billing, `ensureTrial` creates an **ACTIVE** 14-day trial and hydrates it into the in-memory cache (`cache.hydrate(created)`).
2. The merchant redeems a gift. The **DB** row is correctly set to `consumed = true, state = 'CANCELLED', trial_forfeited = true`. The cache, however, still holds the **pre-redemption ACTIVE trial** — and `hydrate` explicitly refuses to overwrite an existing key.
3. Every subsequent read in the **same process** goes through `trial()` → returns the cached **ACTIVE** trial (`.trialForfeited === false`, `state === 'ACTIVE'`), **never re-reading the DB**.
4. When the 3-day gift window closes, `expiredGiftRevert` (`billing-routes.ts`) consults `trials.trial(shopId)`:

   ```ts
   const trialActive = trial !== null && !trial.trialForfeited && !trial.consumed && trial.state === 'ACTIVE' && trial.expiresAt > now
   ```

   Because the stale cache says the trial is still `ACTIVE`/not forfeited, `trialActive` is `true`, so it reverts the store to **`TRIAL_LIMITED`** with the trial's remaining days — i.e. **the 14-day trial is resurrected after the gift**. The store should instead resolve to **`TRIAL_EXPIRED`** (locked).

This matches the report exactly: *"Gift code use karne ke baad trial mil raha hai."*

It also explains the visible symptom even **before** the gift expires: an `ACTIVE` trial is served alongside the gift subscription in `GET /billing`.

### Why the existing tests missed it

All the gift-forfeiture tests in `f5-billing.test.ts` exercise the **in-memory `TrialAndGiftLedger`**, whose `redeemGift` calls `forfeitTrial()` and does refresh the cache. The **`PostgresTrialGiftStore`** path (the one production uses) had **no test** that redeemed a gift and then observed the trial in the same process.

### The fix (`packages/billing/src/trials.ts`)

- Added `TrialAndGiftLedger.setTrial(trial)` — an **unconditional** overwrite of the cached trial (unlike `hydrate`, which only sets when absent).
- In `PostgresTrialGiftStore.redeemGift`, **after** the transaction commits, refresh the cache with the authoritative forfeited trial from the DB (with a computed fallback). Now `trial()` in the same process returns the forfeited record, and `expiredGiftRevert` correctly resolves to `TRIAL_EXPIRED`.

```ts
const forfeitedTrial = await this.loadTrial(shopId).catch(() => null)
if (forfeitedTrial) {
  this.cache.setTrial(normalizeForfeitedTrial(forfeitedTrial, now) ?? forfeitedTrial)
} else {
  const cachedTrial = this.cache.trial(shopId, now)
  this.cache.setTrial({
    shopId,
    startedAt: cachedTrial?.startedAt ?? now - DEFAULT_TRIAL_DAYS * 86_400_000,
    expiresAt: cachedTrial ? Math.min(cachedTrial.expiresAt, now) : now,
    consumed: true,
    state: 'CANCELLED',
    trialForfeited: true,
  })
}
```

### Regression test

Added `packages/billing/src/trials-postgres.test.ts` (stateful fake Postgres + the real `PostgresTrialGiftStore`):
- After `ensureTrial` → `redeemGift`, `store.trial()` returns `trialForfeited = true`, `consumed = true`, `state = 'CANCELLED'`.
- `expiredGiftRevert` after the gift window resolves to `TRIAL_EXPIRED`.

**Verified:** the two regression tests **fail before the fix** and **pass after**. Full billing + billing-routes suite: **191 tests pass**.

---

## Issue #1 — Trial resets after app restart: not a code bug

Every write path preserves `started_at`:

| Path | Behavior |
|------|----------|
| `persistTrial` (initial create) | sets `started_at` on INSERT only; the `ON CONFLICT DO UPDATE` deliberately **omits** it |
| `redeemGift` forfeit upsert | preserves `started_at` (only clamps `expires_at`) |
| `cancelTrial` | only toggles `consumed`/`state` |
| `ensureTrial` / `trial` reads | load the persisted row from Postgres; cache is empty after restart so DB is the source of truth |

So on restart, `started_at` should be whatever was stored. If a store is genuinely seeing a fresh 14-day window after each restart, the likely explanations (in order) are:

1. **The store row / trial row is gone** — e.g. the merchant uninstalled + re-installed (the `trials` row is `ON DELETE CASCADE` from `stores(id)`), or the store was re-registered under a **new `store_id`**. This is a *fresh trial for a new store identity*, not a reset of the old one.
2. **Migrations not applied** — if `0031` didn't run, the `trials.trial_forfeited` column is absent. `loadTrial` swallows the `column does not exist` error and returns `null`, and `ensureTrial` would try to re-create — but `persistTrial` also references the missing column, so this path **throws 500** rather than quietly resetting. Not a clean "reset".
3. **User misunderstanding** — the UI re-renders the remaining days from the *trial start*, and after a re-install the trial looks "reset."

### How to confirm in production

```sql
-- 1. Is the store's trial row present, and what is started_at?
SELECT shop_id, started_at, expires_at, consumed, state, trial_forfeited
FROM trials WHERE shop_id = '<affected_store_id>';

-- 2. Does the store actually change identity across restarts?
SELECT id, shop_domain, created_at FROM stores WHERE id = '<affected_store_id>';

-- 3. Did a reinstall touch the store row? Check for a newer stores row / a CASCADE delete.
--    (If the trial row vanished between two `SELECT`s, the store was re-uninstalled+reinstalled.)

-- 4. Confirm the migration actually ran (0031 must be present):
SELECT id, filename, applied_at FROM schema_migrations WHERE id IN ('0007','0027','0031');
\d trials                                  -- expect: trial_forfeited boolean NOT NULL DEFAULT false
\d gift_codes                              -- expect: sequence integer NOT NULL DEFAULT 0
\d gift_redemptions                        -- expect: shop_id uuid PRIMARY KEY
```

---

## Issue #2 — Gift code used multiple times on same store: guarded in current code

Three independent layers enforce one-gift-per-store:

1. **Pre-flight** `assertGiftSingleUse` (`apps/api/src/gift-codes.ts`) → 400 for an already-redeemed store before touching a code.
2. **In-transaction, atomic** check inside `redeemGift`:
   ```sql
   SELECT shop_id, code, redeemed_at, expires_at FROM gift_redemptions WHERE shop_id = $1 LIMIT 1
   ```
   → throws `CONFLICT 400` (`GIFT_ALREADY_REDEEMED`) if a row exists. This runs under the `FOR UPDATE` lock on the `gift_codes` row, serializing concurrent redemptions of the same code.
3. **Schema** — `gift_redemptions.shop_id` is a **PRIMARY KEY**, so a second redemption INSERT for the same store violates uniqueness at the DB level (even if both guards were somehow bypassed).

If a store is genuinely redeeming multiple gift codes successfully, the strongest hypothesis is a **database state** problem:

- The `gift_redemptions` table in production was created by an **older schema without the PRIMARY KEY**. Migration `0007` uses `CREATE TABLE IF NOT EXISTS gift_redemptions (shop_id uuid PRIMARY KEY …)`, so if the table already existed **without** the PK, the migration **silently skipped** creating it — leaving no uniqueness guarantee.
- Or the deployed API predates the atomic in-transaction check.

### How to confirm

```sql
-- Does the actual table have the PRIMARY KEY?
SELECT conname, contype, conkey
FROM pg_constraint
WHERE conrelid = 'gift_redemptions'::regclass AND contype = 'p';

-- Full constraint definition:
\d gift_redemptions

-- Are there any stores with more than one redemption?
SELECT shop_id, COUNT(*) AS n
FROM gift_redemptions
GROUP BY shop_id HAVING COUNT(*) > 1;

-- When the last redemption happened + which code:
SELECT shop_id, code, redeemed_at, expires_at FROM gift_redemptions WHERE shop_id = '<affected_store_id>';
```

---

## Production diagnostics: gift eligibility after a redemption

To confirm issue #3 is/was real for the affected store, run these together:

```sql
-- The subscription state the store is being served:
SELECT shop_id, plan, state, current_period_end, version, interval, charge_id
FROM billing_subscriptions WHERE shop_id = '<affected_store_id>';

-- The trial row (authoritative state):
SELECT shop_id, started_at, expires_at, consumed, state, trial_forfeited
FROM trials WHERE shop_id = '<affected_store_id>';

-- The redemption (gift window):
SELECT shop_id, code, redeemed_at, expires_at FROM gift_redemptions WHERE shop_id = '<affected_store_id>';

-- Global gift usage counter:
SELECT code, max_uses, uses, active, duration_days, sequence, expires_at
FROM gift_codes ORDER BY sequence;
```

**Expected after my fix, for a store that already redeemed a gift:**

- `trials.trial_forfeited = true`, `trials.consumed = true`, `trials.state = 'CANCELLED'`.
- After the gift window (`current_period_end` / `gift_redemptions.expires_at` in the past), `billing_subscriptions` transitions to `plan = 'trial'`, `state = 'TRIAL_EXPIRED'` (locked) — **never** `TRIAL_LIMITED`.

If `trials.trial_forfeited` is `false` but a redemption row exists, the store is on the affected (pre-fix) build, a previous lease of the cache, or an inconsistent row — the fix in `normalizeForfeitedTrial` + the new cache refresh handles it.

---

## Production log queries

The API logs structured JSON (see `apps/api/src/app.ts` error handler). Look for:

```bash
# Errors during trial/gift operations (status/code/path are in context):
grep -E 'A gift code has already been redeemed|Gift code is invalid|used for this store|primary promotion code' <log>

# 400/409/500s on /billing/gift:
grep -E 'path":"/billing/gift' <log>

# Startup/migration lines (confirm 0031 was applied):
grep -E 'Applied pending database migrations|Database schema is up to date' <log>

# Pool / protocol / relation errors that suppress trial reads:
grep -E 'Postgres pool connection error|column .* does not exist|relation .* does not exist|portal ' <log>
```

### Deployment / configuration checklist

- **`RUN_MIGRATIONS`** must not be `false`/`0`/`no`/`off`. Production default runs migrations at boot (`shouldRunMigrations` → true when `NODE_ENV === 'production'`). Confirm 0007/0027/0031 appear in `schema_migrations`.
- **`DATABASE_URL`** must point at the **same** Postgres for the **API** and the **worker** (each process has its own cache; both must read/write the same tables).
- **Gift codes** come from env (`GIFT_CODE_SEQUENCE_1` / `GIFT_CODE_SEQUENCE_2`, legacy `GIFT_CODE_1/2`). If unset, every redemption fails as "invalid or exhausted" — confirm `GIFT_CODE_SEQUENCE_1_ACTIVE` isn't `false`.
- **`SHOPIFY_BILLING_FORCE_LIVE`** only affects live vs test Shopify charges — unrelated to trial/gift logic.

---

## Files changed

- `packages/billing/src/trials.ts` — added `TrialAndGiftLedger.setTrial()`; refresh the forfeited trial in the cache after a Postgres `redeemGift`.
- `packages/billing/src/trials-postgres.test.ts` — regression tests simulating the full install → redeem → gift-expiry flow against a stateful fake Postgres.

Verified: `pnpm build` (all 20 workspaces) passes; billing + billing-routes + bootstrap + migration suites all green (191+ tests).
