# ProfitPilot — Session-Token 401 Diagnosis & Fix Report

**Date:** 2026-08-27 · **Scope:** `packages/shopify/src/session-token.ts`, `apps/api/src/security.ts` (+ `apps/api/src/session-routes.ts` for parity) · **Symptom:** embedded Shopify app calls to `/api/*` failing with `401 Unauthorized` ("Authentication is required")

## 1. Root-cause analysis

Embedded App Bridge calls authenticate with a Shopify session token (`id_token`, HS256) sent as `Authorization: Bearer …`. Verification checks, in order:

1. **HMAC signature** against `SHOPIFY_API_SECRET` → failure surfaces as `INVALID_SIGNATURE`.
2. **`aud` claim** against `SHOPIFY_API_KEY` (sanitized) → failure surfaces as `AUD_MISMATCH`.
3. **`exp`/`nbf`** window (±10 s leeway) → `EXPIRED` / `NOT_YET_VALID`.
4. **`dest`** claim must be a valid `*.myshopify.com` domain → `MISSING_DEST_SHOP`.

Any mismatch between the credentials deployed on the API and the app that actually minted the token — credential rotation, a recreated Partner-app entry, `SHOPIFY_API_KEY` copied from a different app copy, or a quoted/whitespace-padded env value — turns **every** embedded `/api/*` call into a 401 that looks identical from the browser. Previously the operator had no single log line stating received-vs-expected client id, so the incident was not diagnosable from server logs alone.

## 2. Changes

### 2.1 Explicit 401 diagnostics (both files)

- `apps/api/src/security.ts` now emits, on **every** failed session-token verification:
  `logger.warn('[AuthDiagnostic] Session token 401 failure', { aud_received, key_expected, shop, code, reason, detail, shopQueryHint, shopHeaderHint, path, method, requestId })`
  - `key_expected` is the sanitized `SHOPIFY_API_KEY` (the API bootstrap builds it as `sanitizeCredential(process.env.SHOPIFY_API_KEY)`; logging the sanitized value avoids quote/newline artifacts). Both values are public client ids — no secret material is logged.
- `packages/shopify/src/session-token.ts` failure diagnostics were enriched with the same `aud_received` / `key_expected` / `shop` context keys (existing message formats preserved). For a **signature mismatch**, unauthenticated claims are still never echoed (`null`) — a forged token's payload remains untrusted.

### 2.2 Graceful handling of `aud_received !== key_expected`

New opt-in `SessionTokenVerificationOptions.allowAudienceFallback` on `verifyShopifySessionToken`:

- When the **HMAC signature verifies** against `SHOPIFY_API_SECRET` but `aud ≠ SHOPIFY_API_KEY`, the token is accepted, flagged `audienceFallback: true`, and a loud diagnostic is logged (`[AuthDiagnostic] Session token audience fallback … — SHOPIFY_API_KEY is stale relative to the app that minted this token`).
- The store is then resolved via the existing shop-domain directory lookup (`getByShopDomain` → idempotent `upsertByShopDomain`) from the **signature-authenticated** `dest` claim, falling back to the `iss` claim (`https://{shop}.myshopify.com/admin`) when `dest` is unusable.
- Enabled at the embedded API boundary (`authenticateBearer` in `security.ts`) and `/session/context` (`session-routes.ts`). **Not** enabled for the OAuth token exchange (`token-exchange.ts`) or the app-load URL path (`verifyEmbeddedRequest`), which stay strict.

**Security invariants preserved:**

| Check | Fallback behavior |
|---|---|
| HMAC signature | **Never relaxed** — forged tokens fail before the audience comparison and can never reach the store lookup. Rationale: a valid signature proves Shopify minted the token with *this app's* secret, so the claims (incl. `dest`/`iss`) are authentic even if the deployed client id drifted. |
| `exp` / `nbf` | Fully enforced on fallback tokens. |
| Shop domain | Must still parse as a valid `*.myshopify.com` domain. |
| Request headers / query params | **Never** used for identity (attacker-controlled). `shopQueryHint` / `shopHeaderHint` are echoed in diagnostics only, to compare against the token's claims. |
| Strict default | `verifyShopifySessionToken` without the flag rejects audience mismatches exactly as before. |

## 3. Verification

| Step | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | ✅ 0 errors (note: fresh clones require `pnpm build` first, since workspace packages serve types from `dist/`) |
| Build | `pnpm build` | ✅ clean build, all packages |
| Tests | `pnpm test` | ✅ 252 files, 3279 passed, 1 skipped, 0 failed |

New/updated tests:

- `packages/shopify/src/session-token.test.ts` — fallback acceptance + flag, strict default unchanged, forged-signature rejection under fallback, expiry/nbf enforcement under fallback, `iss` fallback (and its absence in strict mode), diagnostic content for fallback/failure/signature-mismatch.
- `apps/api/src/shopify-session-token-auth.test.ts` — full HTTP stack: stale-audience token now authenticates via shop-domain lookup with the fallback logged; forged-signature token still 401.
- `apps/api/src/session-token-auth-diagnostics.test.ts` — asserts the exact `[AuthDiagnostic] Session token 401 failure` line with `aud_received`/`key_expected`/`shop` for expired and secret-mismatch bearers, and no-auth-context + fallback behavior for stale-audience bearers.

## 4. Operator follow-up

The fallback is a resilience measure, not a config strategy. When `[AuthDiagnostic] Session token audience fallback` appears in logs:

1. Align `SHOPIFY_API_KEY` (and the frontend's `%SHOPIFY_API_KEY%` injection / `VITE_SHOPIFY_API_KEY`) with the Partner app whose secret is deployed as `SHOPIFY_API_SECRET`.
2. Restart the API so App Bridge and the API agree on one client id; the fallback lines should disappear.
