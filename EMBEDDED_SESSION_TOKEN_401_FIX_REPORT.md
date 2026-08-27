# Embedded Session Token Authentication — 401 Fix Report

Branch: `arena/01a04160-profitpilot-ai` · Commit: `285cfb1`

## Summary

Embedded API calls returned `401 UNAUTHORIZED` ("Authentication is required" / "Session expired") with no
server-side explanation. Four independent failure modes could each produce that identical response. All four
are now either fixed or made self-diagnosing in the logs.

## 1. HTML meta tag injection (`apps/api/src/web-app.ts`)

- `injectShopifyAppBridgeApiKey` now replaces **both** `%VITE_SHOPIFY_API_KEY%` and `%SHOPIFY_API_KEY%`
  placeholders.
- The meta-tag rewrite regex was tightened to match `<meta ... name="shopify-api-key" ...>` regardless of
  attribute order or quoting, so a **stale or empty build-baked value can never survive** a serve.
- If no meta tag exists at all, one is now inserted right after `<head>` so App Bridge can still boot.
- New exported helper `resolveAppBridgeApiKey(env)` is the single runtime source of truth
  (`SHOPIFY_API_KEY` → `VITE_SHOPIFY_API_KEY`), sanitized on **every** HTML serve request. Both serve paths
  (`spaFallback` and `mountClientRouteFallback`) go through `sendShopifyIndex`, so both are covered.
- Rationale: an unreplaced placeholder makes App Bridge mint JWTs with an invalid `aud`, which the API then
  rejects — the exact 401 reported.

## 2. Environment variable sanitization

New exported `sanitizeCredential()` (`packages/shopify/src/oauth.ts`) strips CR/LF/tabs, surrounding
whitespace, and wrapping `"` / `'` pairs (repeatedly), returning `''` for undefined. Applied at every read:

| File | Values sanitized |
|---|---|
| `packages/shopify/src/session-token.ts` | `sanitizeSessionTokenConfig()` applied inside `verifyShopifySessionToken` and `describeSessionTokenRejection`; empty credentials now fail closed |
| `apps/api/src/f7-bootstrap.ts` | `JWT_SECRET`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` |
| `apps/api/src/bootstrap.ts` | all `REQUIRED_KEYS` via `requiredEnv` |
| `apps/api/src/security.ts` | `CSRF_SECRET`, `JWT_SECRET` |
| `apps/api/src/web-app.ts` | `SHOPIFY_API_KEY` / `VITE_SHOPIFY_API_KEY` before HTML injection |

The bearer token itself is also trimmed before splitting.

## 3. Detailed 401 verification logging

- New `diagnoseSessionToken(token, config)` in `packages/shopify/src/session-token.ts` returns
  `{ reason, code, message }` with codes: `AUD_MISMATCH`, `INVALID_SIGNATURE`, `EXPIRED`, `NOT_YET_VALID`,
  `MALFORMED_JWT`, `UNSUPPORTED_ALG`, `MISSING_DEST_SHOP`, `MISSING_CREDENTIALS`.
  - `AUD_MISMATCH` logs `expected <configured client id> got <token aud>` — both public values.
  - `EXPIRED` logs how many seconds past `exp` the token was.
  - No token, secret, or merchant PII is ever emitted.
- `apps/api/src/security.ts` gained a pluggable `setAuthDiagnosticsLogger()` sink (defaults to `console.warn`,
  wired to the structured logger in `apps/api/src/app.ts`). Failures now log with the `[AuthError]` prefix:
  - `authenticateBearer` — logs the exact JWT rejection reason for any JWT-shaped bearer that fails.
  - `resolveShopifySessionContext` — logs `STORE_NOT_FOUND` when a verified token has no resolvable store.
  - `tenantContextMiddleware` — logs `NO_AUTH_CONTEXT` (401) and `TENANT_MISMATCH` (403) with path, method,
    and whether an Authorization header was present.

## 4. Database pooler session resilience

`resolveShopifySessionContext` now routes every `StoreDirectory` call through `safeDirectoryCall()`:

- `getByShopDomain` and `upsertByShopDomain` are attempted **independently**; a throw in either is caught,
  logged as `DB_UNAVAILABLE` with the operation name, and converted to `null`.
- A Supabase pooler blip therefore no longer bubbles a 500 or crashes the auth middleware; the request simply
  proceeds unauthenticated and the log states the real cause.
- Return type widened to `AuthContext | null` accordingly.

## Verification

- `pnpm typecheck` — 0 errors
- `pnpm build` — clean
- `pnpm test` — **251 files, 3229 passed, 1 skipped, 0 failed**
- New regression suite `apps/api/src/session-token-auth-diagnostics.test.ts` (13 tests) covering credential
  sanitization, each diagnostic code, meta-tag injection (placeholder, stale value, quoted env), and pooler
  failure / missing-store fallback.

## Deployment note

Work was committed and pushed to `arena/01a04160-profitpilot-ai` (this session is fixed to that branch and
cannot push to `main`). Merge that branch into `main` — or open a PR from it — to trigger the Render/Railway
deployment.
