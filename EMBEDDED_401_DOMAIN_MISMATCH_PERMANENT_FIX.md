# Embedded 401 Unauthorized & Domain Mismatch — Permanent Fix

**Date:** 2026-08-27
**Store reproducing the issue:** `commander-pilot.myshopify.com`
**Symptom:** every `/api/*` call from the embedded Shopify Admin app answered `401 Unauthorized`
("Authentication is required" / "Session expired") **after a completed OAuth install**, and the UI
parked the merchant on a permanent red card with no way out.

---

## 1. Root causes found

| # | Cause | Where | Effect |
|---|-------|-------|--------|
| A | **Shop domain spelled differently per entry point.** The App Bridge session token's `dest` claim is `https://commander-pilot.myshopify.com`; `parseShopDomain` only lowercased/trimmed, and `packages/db` normalized separately with a *different* rule. A scheme, a trailing slash, mixed case or a bare handle produced a **different key** than the one the OAuth callback wrote. | `packages/shopify/src/oauth.ts`, `packages/db/src/stores.ts` | `stores` / `shopify_tokens` lookup misses → `STORE_NOT_FOUND` → 401. RLS (`shop_domain = current_setting('app.shop_domain')`) compares byte-for-byte, so a mis-spelled row is *invisible*, not merely unmatched. |
| B | **OAuth callback could "succeed" without persisting.** The token vault write happened *before* tenant registration, the DB error was swallowed into a generic `INTERNAL_ERROR`, and nothing verified the row actually landed. | `packages/shopify/src/install.ts` | Merchant installed on Shopify's side, unknown to the app → permanent 401. |
| C | **JWT rejections were unattributable in production.** `verifyShopifySessionToken` returned `null` with no log line naming `dest` / `aud_received` / `aud_expected`. | `packages/shopify/src/session-token.ts` | Impossible to tell an `aud` mismatch from an expired token from a wrong secret. |
| D | **The client had no recovery path.** A terminal 401 only latched a red banner; nothing ever re-ran the install flow. Concurrent boot requests each raced their own `idToken()` mint. | `apps/web/src/api.ts`, `App.tsx` | Merchant stuck; the one action that fixes it (re-authorize) was never offered. |

---

## 2. Changes made

### 2.1 Domain normalization everywhere

**`packages/shopify/src/oauth.ts`**
* Added `normalizeShopDomain(value)` — the single canonical normalizer:
  `toLowerCase().trim()` → strip `https?://` → strip path/query/fragment/userinfo/port → strip trailing slash → expand a bare handle (`commander-pilot` → `commander-pilot.myshopify.com`). Never throws; returns `''` when unusable.
* `parseShopDomain` now delegates to it (still strict: rejects non-`*.myshopify.com`).
* Added `safeParseShopDomain()` (normalize-or-null) for non-throwing call sites.
* Because *every* consumer already routes through `parseShopDomain`, this fixes `TokenVault`,
  `PostgresTokenRecordStore` (`shopify_tokens`), `PostgresOAuthStateStore`, `ShopifyTokenExchangeService`
  and `ShopifyInstallService` in one place.

**`packages/db/src/stores.ts`**
* `normalizeShopDomain` is now byte-identical to the shopify-package rule and **exported** (duplicated
  deliberately: `@profitpilot/shopify` depends on `@profitpilot/db`, not the reverse). Applies to
  `getByShopDomain`, `upsertByShopDomain` and the in-memory double.

**`apps/api/src/security.ts`**
* `resolveShopifySessionContext` normalizes once more immediately before the DB call — the last hop
  can never query a value the callback did not write. Log context now carries `shopDomain` + raw `dest`.

**`apps/api/src/shopify-routes.ts`**
* `GET /shopify/install` normalizes the `shop` parameter, so the client's re-authorization redirect
  (which may carry a URL) starts OAuth for the same canonical domain the callback later persists.
* The **callback query is deliberately left untouched** before HMAC verification (normalizing a signed
  parameter would break the decoded/encoded signature methods); canonicalization happens inside
  `installer.complete()` before every DB write.

**`packages/shopify/src/session-token.ts`**
* `shopFromDest()` normalizes the `dest` claim, so `claims.shop` is *always* the exact key used for
  `stores` / token-vault lookups. `claims.dest` keeps the raw value for diagnostics.

**`migrations/0032_normalize_shop_domains.sql` (new, registered in `packages/db/src/migrations.ts`)**
* Repairs rows written by earlier deploys: normalizes `stores.shop_domain`,
  `shopify_tokens.shop_domain` and `shopify_oauth_states.shop_domain` (skipping any row whose
  normalized form would collide with an existing canonical row).
* Re-activates (`status='ACTIVE'`, `uninstalled_at=NULL`) any store that still holds a live offline
  access token. Idempotent; safe to re-run.

### 2.2 OAuth callback DB persistence

**`packages/shopify/src/install.ts` — `complete()` rewritten**
1. **Tenant row FIRST** (was: token first). The `stores` row is what every embedded API call resolves
   `dest` to; registering it first means a transient vault failure can never leave "installed on
   Shopify, unknown to the app". The upsert already forces `status='ACTIVE'`, `uninstalled_at=NULL`.
2. **Token vault write wrapped in explicit `try/catch` + `logger.error`** carrying the *exact* DB error:
   `error`, `errorName`, `dbCode` (SQLSTATE), `dbDetail`, `dbHint`, `dbConstraint`, `dbTable`, `dbSchema`,
   `dbRoutine`, `dbSeverity`, the cause chain and the stack (helper `describeDbError`).
   Same treatment for the `stores` write.
3. **Read-back verification (new step `token-verification`)**: the vault is re-read (and decrypted)
   after the write. A pooler that accepts and rolls back a write now fails the install loudly
   (`TOKEN_VAULT_READBACK_EMPTY`) instead of silently producing later 401s.
4. Success emits `Shopify OAuth callback persisted the offline access token` with
   `tokenStored: true`, `accessMode: 'offline'`, `storeId`, `shopDomain`.
5. `ShopifyInstallService` accepts an optional structural `logger` (5th ctor arg, `{ logger }`), wired
   from `apps/api/src/bootstrap.ts` to the app's structured `Logger`.

**`apps/api/src/shopify-routes.ts`**
* Success log now records `tokenStored` + `storeStatus: 'ACTIVE'`.
* Failure log adds `dbCode` / `dbDetail` / `dbConstraint` walked from the error's cause chain.

### 2.3 JWT audience & diagnostics

**`packages/shopify/src/session-token.ts`**
* `sanitizeSessionTokenConfig` falls back to `process.env.SHOPIFY_API_KEY?.trim()` /
  `SHOPIFY_API_SECRET?.trim()` when the caller passes an empty value (env-drift protection).
* `verifyShopifySessionToken` now emits, on **every** rejection, exactly:
  ```
  [AuthDiagnostics] JWT verification failed for shop=<dest>, aud_received=<aud>, aud_expected=<SHOPIFY_API_KEY>
  ```
  with structured context `{ code, reason, shop, audReceived, audExpected }`
  (`MALFORMED_JWT` / `UNSUPPORTED_ALG` / `INVALID_SIGNATURE` / `AUD_MISMATCH` / `EXPIRED` /
  `NOT_YET_VALID` / `MISSING_DEST_SHOP` / `MISSING_CREDENTIALS`). No token, secret or PII is logged.
* Sink is pluggable via `setSessionTokenDiagnosticsSink()`; `apps/api/src/bootstrap.ts` routes it into
  the structured logger (stderr by default, so it works even without wiring).

### 2.4 API 401 envelope the client can act on

**`apps/api/src/security.ts`**
* New `AuthFailure` record (`STORE_NOT_FOUND` | `SESSION_TOKEN_INVALID` | `NO_AUTH_CONTEXT` |
  `DB_UNAVAILABLE`) attached to the request and exposed via `getAuthFailure()`.
* Every 401 now carries `details: { reason, code?, shop?, reauthorize }`.
  `reauthorize: true` ⇒ the install flow can restore the session;
  a DB outage returns `reauthorize: false` so the merchant is never bounced through OAuth for nothing.
* `STORE_NOT_FOUND` log line upgraded to
  `[AuthDiagnostics] Session token verified but no stores row resolved for shop=… (dest=…)`.

### 2.5 Frontend race condition & 401 auto-recovery

**`apps/web/src/api.ts`**
* **Boot gate** `ensureEmbeddedSessionTokenReady()` — the first request (and `warmUpEmbeddedSessionToken()`)
  awaits App Bridge's retried `idToken()`, and every concurrent boot request shares that one promise.
  No fetch can leave the app while the bridge is still booting.
* **`handleTerminalUnauthorized(payload)`** replaces the unconditional banner latch on a 401 that
  survived the silent fresh-token retry:
  * `isRecoverableAuthFailure()` (exported, unit-tested) accepts `reauthorize: true`,
    `UNAUTHORIZED`/`STORE_NOT_FOUND`/`SESSION_TOKEN_INVALID`/`NO_AUTH_CONTEXT`, or the message
    "Authentication is required" / "Session expired"; rejects `DB_UNAVAILABLE` / `SCHEMA_MISSING`.
  * `requestEmbeddedReauthorization(shop)` performs a **top-level** redirect to
    `/shopify/install?shop=<shop>` — at most **once per page load** (no iframe redirect loops).
  * The session banner is now only the *fallback* when no redirect is possible.
* Same path applied to `requestFile()` (PDF downloads).

**`apps/web/src/shopify-app-bridge.ts`**
* `redirectToShopifyReauthorization(shopHint?)` — `shopify.navigate({ url, target: '_top' })` when the
  bridge exposes it, else `window.open(url, '_top')` (OAuth pages send `X-Frame-Options: DENY`, so the
  navigation must leave the iframe).
* `embeddedShopDomain(hint?)` — resolves the shop *without* a session token: `?shop=` → base64 `host`
  (`admin.shopify.com/store/<handle>`) → caller hint.
* `normalizeShopDomainForClient()` — client-side twin of the server normalizer.

**`apps/web/src/App.tsx`**
* Bootstrap 401 and `retryContext()` 401 now attempt `requestEmbeddedReauthorization(...)` first and
  only fall back to the banner when no redirect is possible.
* `SessionExpiredBanner` gained a **"Reconnect Shopify"** action that re-runs the install at top level
  (with "Reload the app" kept as the last resort).

---

## 3. Verification

| Gate | Command | Result |
|------|---------|--------|
| Types | `pnpm typecheck` | **0 errors** (19 workspace projects) |
| Build | `pnpm build` | **clean** across the monorepo (packages + api + web + worker) |
| Tests | `pnpm test` | **252 files, 3263 passed, 1 skipped, 0 failed** |

### New/updated test coverage
* `packages/shopify/src/embedded-401-domain-fix.test.ts` **(new, 17 tests)** — normalization of every
  spelling; `dest` → canonical shop; the exact `[AuthDiagnostics]` line and per-reason codes; env-key
  fallback; callback writes token **and** ACTIVE store row; read-back verification; exact SQLSTATE /
  constraint / detail logging for both the vault and the stores failure; tenant row survives a vault
  failure so a retry can recover; unsigned callbacks still rejected before any DB write.
* `packages/db/src/stores.test.ts` — normalization parity, canonical bound parameters, one tenant per
  spelling.
* `apps/api/src/session-token-auth-diagnostics.test.ts` — `STORE_NOT_FOUND` ⇒ `reauthorize: true` +
  normalized shop in the 401 body; `DB_UNAVAILABLE` ⇒ `reauthorize: false`; scheme-prefixed `dest`
  resolves the canonical row; shop hint fallback.
* `apps/web/src/api-embedded-auth.test.ts` — recoverable-vs-not classification; redirect instead of a
  permanent red card; at-most-once redirect; banner fallback; never re-install on a DB outage.
* `apps/web/src/shopify-app-bridge.test.ts` — client normalizer parity; shop resolution order;
  App Bridge `_top` navigation and `window.open` fallback.
* `packages/db/src/db.test.ts`, `apps/web/src/session-expiry-hotfix.test.tsx` — updated contracts.

---

## 4. Deployment notes

* Migration **0032** runs automatically on API start (`RUN_MIGRATIONS`), repairing existing rows.
* No environment variables were added. `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` are now also read
  directly from the environment as a last-resort fallback for session-token verification.
* What to grep in the deploy logs after release:
  * `Shopify OAuth callback persisted the offline access token` — install actually wrote both rows.
  * `[AuthDiagnostics] JWT verification failed for shop=…` — names `aud_received` vs `aud_expected`.
  * `dbCode` on `Shopify OAuth callback failed` — the SQLSTATE behind any remaining install failure.
