# ProfitPilot — Permanent Fix: Embedded 401 Unauthorized & Domain Mismatch

**Date:** 2026-08-27 · **Branch:** `arena/01a041f4-profitpilot-ai` → `main`
**Scope:** `packages/shopify`, `packages/db`, `apps/api`, `apps/web`

## Root causes identified

1. **Domain mismatch between JWT and DB lookups.** `parseShopDomain`
   (`packages/shopify/src/oauth.ts`) and `normalizeShopDomain`
   (`packages/db/src/stores.ts`) only applied `trim().toLowerCase()`. A shop
   arriving as `https://Commander-Pilot.myshopify.com/` (OAuth redirect,
   webhook header, stored URL) produced a different lookup key than the bare
   `commander-pilot.myshopify.com` that the JWT `dest` claim maps to — the
   `stores` / token-vault lookup missed and every `/api/*` call answered
   `401 "Authentication is required"`, even after a successful OAuth install.
2. **Silent persistence failures in the OAuth callback.** The callback trusted
   `vault.put()` whenever it did not throw; an RLS-hidden row or a flaky
   pooler write left the install "successful" with no readable offline token
   and no operator-visible error.
3. **No recovery path for persistent 401s.** The frontend latched a permanent
   red "Session expired" banner with only a reload button — a reload cannot
   repair a missing/revoked offline token, so the merchant stayed stuck.

## 1. Domain normalization everywhere

| File | Change |
| --- | --- |
| `packages/shopify/src/oauth.ts` | New exported `normalizeShopDomainInput()` = `value.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')`. `parseShopDomain()` now applies it before the `*.myshopify.com` validation. This single function feeds **every** shopify-package entry point: OAuth `start()`/`complete()`, OAuth state issue/consume (memory + Postgres), session-token `dest` parsing, query-HMAC identity, and the entire `TokenVault` (`get`/`put`/`remove`) + `PostgresTokenRecordStore` (`shopify_tokens`). |
| `packages/db/src/stores.ts` | `normalizeShopDomain()` now applies the identical scheme/case/slash normalization, so `stores.getByShopDomain()` and `stores.upsertByShopDomain()` resolve `https://Commander-Pilot.myshopify.com/` → `commander-pilot.myshopify.com` exactly — no missing or extra `.myshopify.com`. Covers `/session/context`, webhook `storeIdForShop`, and the session-token auth directory lookup. |
| `apps/api/src/security.ts` | Session-token identity already flows through `shopFromDest → parseShopDomain`; now additionally logged with `shopClaim`/`audReceived`/`audExpected` context on rejection (see §4). |

**Guarantee:** if JWT `dest` is `commander-pilot.myshopify.com`, every DB
query (`stores`, `shopify_tokens`) binds exactly `commander-pilot.myshopify.com`.

## 2. OAuth callback DB persistence (`apps/api/src/shopify-routes.ts`, `bootstrap.ts`)

- `ShopifyRouteDependencies` gains an optional **read-back probe**
  `verifyTokenPersisted(shop) → boolean`, wired in `bootstrap.ts` as
  `vault.get(shop) !== null`.
- After `installer.complete()` succeeds, `/shopify/callback` now **verifies the
  offline access token is actually readable** in the token vault
  (`shopify_tokens`) and logs:
  - success: `[OAuthPersistence] Offline access token persisted and verified in the token vault` (`table: shopify_tokens`, `storeStatus: ACTIVE`);
  - probe miss: `logger.error('[OAuthPersistence] Token vault write reported success but the offline access token is NOT readable after the OAuth callback')`;
  - probe failure: `logger.error` with the **exact DB error** (`name: message` + stack).
- Callback failures at step `token-storage` or `tenant-registration` now emit
  an additional explicit
  `logger.error('[OAuthPersistence] DB write failed during OAuth callback …', { dbError: <exact error>, stack })`
  alongside the existing structured failure log.
- **Store row state guaranteed:** `PostgresStoreDirectory.upsertByShopDomain`
  now explicitly inserts `status='ACTIVE', uninstalled_at=NULL` on the fresh
  branch and re-asserts `status='ACTIVE', uninstalled_at=NULL` on the
  `ON CONFLICT` (reinstall-recovery) branch — an uninstalled store that
  re-authorizes is reactivated atomically.

## 3. Frontend race condition & 401 auto-recovery (`apps/web/src/api.ts`, `App.tsx`)

- **Boot race (already guaranteed, verified):** `App.tsx` awaits
  `warmUpEmbeddedSessionToken()` (App Bridge `idToken()`, retried once) before
  the first `/session/context` fetch, and **every** `requestJson`/`requestFile`
  awaits `attachEmbeddedSessionToken(headers)` — a fresh `idToken()` — before
  hitting the network.
- **New auto-recovery (requirement 3):** a 401 that survives the silent
  fresh-token retry now triggers a **top-level reinstall/re-authorize**:
  - `embeddedShopDomainFromUrl()` derives the store domain from the embedded
    URL (`shop` param first, decoded admin `host` fallback) with the same
    strict normalization as the API; bare handles are completed to
    `*.myshopify.com`; non-Shopify input can never produce a redirect target.
  - `triggerEmbeddedReinstallRedirect()` navigates via
    `shopify.navigate({ url: '/shopify/install?shop=<domain>', target: '_top' })`
    when App Bridge exposes `navigate`, otherwise
    `window.open(url, '_top', 'noopener')` (with `location.assign` as last
    resort).
  - Fired from `notifyEmbeddedAuthFailure()` (covers `requestJson` and
    `requestFile`), latched via `attemptEmbeddedReinstallRedirect()` so a storm
    of simultaneous 401s navigates **at most once** per page load.
  - No-ops outside the embedded admin (standalone dev keeps the banner path).
- **`App.tsx` session banner:** the critical banner keeps its contract but is
  no longer a dead end — the primary action **"Reconnect your store"** runs the
  same top-level re-authorization; reload remains the secondary fallback.
  Merchants are never left staring at permanent red 401 cards when
  re-authentication can recover the session.

## 4. JWT audience & API-key verification (`packages/shopify/src/session-token.ts`)

- `verifyShopifySessionToken` compares `decoded.aud` against `config.apiKey`,
  which the API bootstrap builds as `sanitizeCredential(process.env.SHOPIFY_API_KEY)`
  — i.e. the trimmed, quote/newline-stripped `SHOPIFY_API_KEY` env value.
- New diagnostics sink `setSessionTokenVerificationLogger()` (wired in
  `apps/api/src/security.ts` into the structured auth-diagnostics logger).
  On verification failure the **exact required diagnostic** is logged:
  ```
  [AuthDiagnostics] JWT verification failed for shop=<dest>, aud_received=<aud>, aud_expected=<apiKey>
  ```
  with the machine-readable reason (`audience-mismatch` / `expired` /
  `not-yet-valid` / `missing-shop`). For signature mismatches the payload is
  not authenticated, so claims are never echoed — only
  `INVALID_SIGNATURE … aud_expected=<apiKey>`.
- New exported `sessionTokenClaimsPreview()` lets `security.ts` attach
  `shopClaim`/`audReceived`/`audExpected` to its per-request rejection log
  (code, path, method, request id) without trusting unverified claims for any
  authorization decision.

## 5. Verification

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ 0 errors across all workspace packages |
| `pnpm build` | ✅ clean monorepo build (all packages + api + worker) |
| `pnpm test` | ✅ **252 test files, 3248 passed, 1 skipped, 0 failed** |

### New regression coverage

- `packages/shopify/src/shopify.test.ts` — `parseShopDomain` normalizes
  scheme/case/trailing slashes and still rejects foreign domains.
- `packages/db/src/stores.test.ts` — every variant
  (`https://…/`, `HTTP://…`, whitespace, `//`) binds the identical
  `commander-pilot.myshopify.com` key in `stores` queries.
- `packages/shopify/src/session-token.test.ts` — exact `[AuthDiagnostics]`
  lines for audience mismatch, expiry, and signature mismatch (claims never
  echoed when unauthenticated); `sessionTokenClaimsPreview` behavior.
- `apps/web/src/embedded-401-recovery.test.ts` (new, 12 tests) — shop-domain
  resolution & normalization, App Bridge `navigate(_top)` vs `window.open`
  fallback, once-per-page latch, fetcher auto-recovery on persistent 401,
  no redirect for transient healed 401s, and no redirect in standalone mode.

## Deployment note

Merging to `main` triggers the Railway/Render redeploy. After deploy, watch
the logs for the new markers to confirm the fix is live:
`[OAuthPersistence] Offline access token persisted and verified` on the next
OAuth callback, and no further `[AuthDiagnostics] JWT verification failed …
aud_received ≠ aud_expected` lines (an AUD mismatch now names both client ids).
For `commander-pilot.myshopify.com` specifically: one OAuth re-authorization
(top-level `/shopify/install?shop=commander-pilot.myshopify.com`) rewrites the
offline token and sets the store row back to `ACTIVE` — all `/api/*` calls
then authenticate via the session-token → `stores` → `shopify_tokens` chain
with a single normalized domain key.
