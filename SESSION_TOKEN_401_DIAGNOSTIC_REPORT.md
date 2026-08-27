# ProfitPilot — Session Token 401 Diagnostic & API Key/Secret Mismatch

**Date:** 2026-08-27 · **Branch:** `arena/01a04346-profitpilot-ai`
**Scope:** `packages/shopify/src/session-token.ts`, `apps/api/src/security.ts`, `.env.example`
**Symptom:** Embedded Shopify app `/api/*` calls fail `401 Unauthorized` — "Authentication is required".

---

## 1. Diagnosis

### What was already in place (found, not written, this session)

`main` already carried session-token diagnostics from two earlier merges
(`EMBEDDED_SESSION_TOKEN_401_FIX_REPORT.md`, `EMBEDDED_401_PERMANENT_FIX_REPORT.md`):

- `packages/shopify/src/session-token.ts` — a `SessionTokenVerificationLogger`
  sink emitting `[AuthDiagnostics] JWT verification failed for shop=…,
  aud_received=…, aud_expected=…`, plus `describeSessionTokenRejection()` /
  `diagnoseSessionToken()` mapping failures to `AUD_MISMATCH`,
  `INVALID_SIGNATURE`, `EXPIRED`, `NOT_YET_VALID`, `MISSING_DEST_SHOP`,
  `MALFORMED_JWT`, `MISSING_CREDENTIALS`.
- `apps/api/src/security.ts` — `setAuthDiagnosticsLogger()`, wired in
  `apps/api/src/app.ts:58` into the structured logger, and a rejection log in
  `authenticateBearer()`.

So the "print a diagnostic log" half of the task was largely present. What was
**missing** was (a) the single grep-able 401 line with the three fields an
operator compares side by side, and (b) any recovery path for an `aud` mismatch.

### The actual failure mode behind the reported 401

Verification order in `verifyShopifySessionToken()` is **signature first, then
`aud`**. That ordering is what makes the reported bug diagnosable, because it
splits "API key/secret mismatch" into two very different cases:

| Case | Evidence in the log | Meaning |
| --- | --- | --- |
| `SHOPIFY_API_SECRET` wrong | `code: INVALID_SIGNATURE` | Payload is **unauthenticated**. Nothing about the token can be trusted. |
| `SHOPIFY_API_KEY` wrong | `code: AUD_MISMATCH`, `claims_authenticated: true` | Signature **verified** — the token is genuine Shopify, this deployment is simply advertising a different client id than App Bridge mints tokens for. |

The second case is the one the task describes, and it is the one that is safely
recoverable.

---

## 2. Changes

### 2.1 The 401 diagnostic line (`apps/api/src/security.ts`)

`authenticateBearer()` now emits the requested line on every session-token 401:

```jsonc
{"level":"warn","message":"[AuthError] [AuthDiagnostic] Session token 401 failure",
 "context":{"aud_received":"another-app","key_expected":"client-id-123",
            "shop":"https://demo.myshopify.com","code":"AUD_MISMATCH",
            "claims_authenticated":true,"shop_source":"verified-claim",
            "path":"/api/analytics","method":"GET","requestId":"…"}}
```

Captured verbatim from the test run, not transcribed:

```
[AuthError] [AuthDiagnostic] Session token 401 failure
  context: {"aud_received":"(absent)","key_expected":"embedded-test-client-id",
            "shop":"profitpilot","code":"INVALID_SIGNATURE",
            "claims_authenticated":false,"shop_source":"unverified-claim", …}
```

Notes on the field choices:

- `key_expected` is the **sanitized** `SHOPIFY_API_KEY` (`sanitizeCredential()`
  strips quotes/newlines/whitespace), because that sanitized value is what the
  comparison actually uses. Logging the raw env value would print the very
  invisible characters the scrubber exists to remove.
- `claims_authenticated` / `shop_source` state whether the echoed `shop` came
  from a verified payload or from an attacker-controlled one. The two cases look
  identical in a log line otherwise.
- `key_expected_aliases` lists any configured aliases, so a still-failing
  `AUD_MISMATCH` shows whether the alias list was actually loaded.

### 2.2 Log-injection hardening

On a signature failure, `dest`/`iss`/`aud` are whatever the sender put there.
They are still worth logging (naming the shop a forged token claims is exactly
what an incident responder needs), so `safeClaimForLog()` strips control
characters and truncates at 253 chars rather than dropping them.

### 2.3 Graceful `aud` mismatch handling — `SHOPIFY_API_KEY_ALIASES`

New optional `audienceAliases` on `SessionTokenConfig`, populated from
`SHOPIFY_API_KEY_ALIASES` (comma-separated) via
`securityOptionsFromEnv()` → `withAudienceAliases()`.

Recovery loop for a live 401 incident:

1. Read `aud_received` from the `[AuthDiagnostic] Session token 401 failure` line.
2. Confirm it is a client id you own.
3. Add it to `SHOPIFY_API_KEY_ALIASES`, redeploy. Service resumes.

Accepted-alias traffic logs `code: CLIENT_ID_DRIFT` on every request, so the
temporary allowlist cannot become permanent by accident.

**Invariant:** an alias widens the *audience* check only. The HMAC signature
must still verify against `SHOPIFY_API_SECRET`. There is no configuration that
makes this package trust a claim from an unverified token.

### 2.4 `dest` / `iss` shop resolution

`shopFromClaimedShop()` resolves the shop from `dest`, falling back to the `iss`
host (`https://<shop>.myshopify.com/admin`) **only when `dest` is absent**. Both
claims are authenticated at that point.

### 2.5 Why the requested fallback was NOT implemented as written

The task asked to "look up the store via `shopDomain` extracted from `dest` /
`iss` claims **or request headers**" when `aud_received !== key_expected`.

Implemented literally for the `INVALID_SIGNATURE` case, that is a **full
tenant-takeover vulnerability**:

```
header:  {"alg":"HS256","typ":"JWT"}
payload: {"dest":"https://victim.myshopify.com","aud":"anything","exp":<future>}
signing: any attacker-chosen secret
```

`dest` would resolve to the victim's `storeId`, and the attacker would be
authenticated as that store. An unsigned `X-Shopify-Shop-Domain` header is the
same bypass with less effort. This is the reason
`verifyEmbeddedRequest()` already refuses a bare `shop` query parameter.

The `aud`-mismatch-only reading is safer (there the signature has verified), but
it is still an implicit widening, and it cannot distinguish "our key drifted"
from "a third app reuses our client secret". The explicit, opt-in allowlist in
§2.3 delivers the same operational outcome — merchant traffic resumes — while
keeping the trust decision visible in configuration and auditable in the log.

Instead of the unsafe fallback, a signature failure now logs
`SHOP_CLAIM_FALLBACK_REFUSED` stating the refusal explicitly.

---

## 3. Tests

15 new tests across `packages/shopify/src/session-token.test.ts` and
`apps/api/src/session-token-auth-diagnostics.test.ts`:

- 401 line carries `aud_received` / `key_expected` / `shop` and `code: AUD_MISMATCH`.
- Signature failure sets `claims_authenticated: false`, logs
  `SHOP_CLAIM_FALLBACK_REFUSED`, and yields no auth context.
- **Forged token** with an attacker secret naming `victim.myshopify.com` in
  `dest`/`iss`, sent with an `x-shopify-shop-domain` header, authenticates as
  nobody and performs **zero** store-directory calls.
- Alias token authenticates and logs `CLIENT_ID_DRIFT`; an alias does not rescue
  a bad signature; aliases are sanitized, de-duplicated, and blanks dropped;
  `SHOPIFY_API_KEY_ALIASES` empty leaves the config untouched.
- `iss` fallback resolves a shop when `dest` is absent; a present-but-invalid
  `dest` is **not** rescued by a valid `iss`.

### One regression caught and fixed

The first `iss` fallback used `shopFromDest(dest) ?? shopFromIss(iss)`. That
broke the existing test *"rejects a dest that is not a myshopify domain"*: a
token with `dest: https://evil.example.com` but a valid `iss` was silently
accepted as the `iss` host. Shopify always mints both from the same host, so
that shape is malformed, not recoverable — preferring `iss` there would have
quietly deleted a real guard. Fixed to consult `iss` only when `dest` is absent,
with a new test pinning the behaviour.

---

## 4. Verification

All three commands run against this branch, exit codes captured directly:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | **exit 0**, `grep -c "error TS"` → **0** |
| `pnpm build` | **exit 0**, `grep -c "error TS"` → **0** |
| `pnpm test` | **exit 0** — 252 files passed, **3280 passed**, 1 skipped |

Baseline at `61891ce` was 3265 passed / 1 skipped, so the delta is exactly the
15 new tests.

One ordering caveat worth recording: on a clean checkout `pnpm typecheck` **fails
before `pnpm build`**, because `apps/web` resolves `@profitpilot/types` through
`dist/*.d.ts`, which does not exist until packages are built. Run `pnpm build`
first. This is pre-existing and unrelated to these changes.

---

## 5. Deployment note

`SHOPIFY_API_KEY_ALIASES` defaults to empty — behaviour is unchanged until an
operator sets it. No migration, no data change.

For a production 401 incident:

1. Deploy this build.
2. Reproduce one `/api/*` call from the embedded admin.
3. Grep the server log for `[AuthDiagnostic] Session token 401 failure`.
4. Branch on `code`:
   - `AUD_MISMATCH` → set `SHOPIFY_API_KEY` to `aud_received`, or add it to
     `SHOPIFY_API_KEY_ALIASES` to restore service first and fix the key after.
   - `INVALID_SIGNATURE` → `SHOPIFY_API_SECRET` is wrong; no alias will help.
   - `EXPIRED` → App Bridge is reusing a stale `id_token`; the frontend must
     mint a fresh one per request.
