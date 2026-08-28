# PR — “Session expired” was never about expiry: honest auth reporting + a real recovery path

**Date:** 2026-08-28 · **Branch:** `arena/01a046a7-profitpilot-ai`
**Scope:** `apps/api`, `apps/web`, `.env.example`
**Baseline:** 252 files / 3280 tests passing · **After:** 254 files / 3304 tests passing, typecheck clean

## The bug this fixes

A merchant opened the embedded app and saw, on one screen:

```
API unavailable · Some synced data could not be loaded: Authentication is required
Session expired — Your Shopify session expired — reload the app to reconnect.
Good morning, Commander Pilot
Shopify data plane ready · No analytics sync yet
products / orders / customers / inventory / collections / discounts → Authentication is required
```

“Ready” and “Authentication is required” on the same screen, and a banner that
blamed expiry for something expiry had nothing to do with.

## Root cause

Two different auth contracts, and the weaker one drives the UI:

| Layer | Requires | In the incident |
|---|---|---|
| `GET /session/context` (bootstrap) | **nothing** — falls back to the session cookie or the unsigned `?shop=` param | **200** → shell renders greeting + “data plane ready” |
| every `?storeId=` route (data plane) | a **verified** `Authorization: Bearer` session token | **401** → every card empty |

So the dashboard was guaranteed to claim a healthy workspace at the exact
moment every data call was being rejected. On top of that, three distinct
failures — “the app isn’t inside the admin”, “App Bridge couldn’t mint a
token”, “the credentials drifted” — all produced the same “session expired”
sentence, and auto-recovery was silently broken.

Reproduced before fixing by mounting the real `authenticationMiddleware` +
`tenantContextMiddleware` + `createSessionRouter` against a fake directory:
`/session/context` answered 200 with **zero credentials**, `/catalog?storeId=…`
answered 401 with the session cookie alone, and `POST /sync/all` 401’d — which
is why all six sync modules were painted red by one failure.

## Changes

### 1. `/session/context` reports whether it actually authenticated (`apps/api/src/session-routes.ts`)

`SessionContext` gains `authenticated: boolean` — true only when the tenant
resolved from a credential the server verified (Shopify session token, or a
correctly signed tenant cookie). The unsigned `?shop=` parameter and
pre-signing cookies still *name* the store but are reported unauthenticated.
A new `CONTEXT_UNAUTHENTICATED` warning is logged once per such request.

An unverified context counts as authenticated only when
`requireAuthentication` is false (local dev), because that is precisely when
the data plane will still serve it.

### 2. The session cookie can now authenticate the data plane (`apps/api/src/cookies.ts`, `security.ts`)

The cookie used to carry a bare `storeId` — fine for a bootstrap lookup,
useless as a credential, and unsafe to trust since `storeId` travels in URLs.
It is now HMAC-signed (`signSessionValue` / `verifySessionValue`, split on the
last dot so dotted ids survive), written by `setSignedSessionCookie` from both
the OAuth callback and the embedded app load, and accepted by
`authenticationMiddleware` as a third credential.

Guards, all mandatory:

* signature must verify against a real secret; the public development
  placeholder is refused (`sessionCookieAuthEnabled`, checked in both
  `securityOptionsFromEnv` and the middleware);
* the signed storeId must still resolve to a store row, so a cookie for a
  deleted/uninstalled tenant stops authenticating immediately;
* **it is only consulted when no `Authorization` header was sent.** A rejected
  session token must still 401 and still log `AUD_MISMATCH` /
  `INVALID_SIGNATURE` — the cookie path must never paper over credential drift.

This is what makes non-embedded contexts (standalone tab, blocked App Bridge
CDN, preview iframe) recoverable instead of a permanent dead end that
reinstalling could never repair.

### 3. `navigateTopLevel` no longer defeats its own auto-recovery (`apps/web/src/shopify-app-bridge.ts`)

```diff
- const opened = window.open(url, '_top', 'noopener')
- if (opened) return true
+ window.open(url, '_top')
+ return true
```

Per MDN (`Window.open()` → `noopener`): *“If this feature is set, the new
window will not have access to the originating window via `Window.opener` and
returns null.”* The old `if (opened)` could therefore **never** pass, so every
automatic 401 re-auth reported failure and the merchant was dropped on the
static red card this function exists to prevent. `_top` navigates the existing
top frame rather than opening a popup, so a null return is not a blocked popup.

Two more call sites carrying the same footgun were fixed:
`App.tsx` onboarding now goes through `navigateTopLevel`, and
`ai-command.tsx` `startReauthorize` drops the feature.

### 4. The banner names the failure that actually happened (`apps/web/src/api.ts`)

The fetcher records the outcome of every session-token mint
(`lastSessionTokenResult`) and `unauthorizedGuidance()` turns a 401 into the
matching sentence:

| Last mint | Banner says |
|---|---|
| `not-embedded` | open the app from Shopify admin — this page is outside it |
| `unavailable` | Shopify could not create a session token (+ the bridge’s reason) |
| `ok` / unknown | session expired — reload to reconnect |

### 5. The sync panel stops amplifying one error into six (`apps/web/src/App.tsx`)

When `POST /sync/all` itself fails (auth/network/server) **no module ran**, so
blaming all six was actively misleading. It now renders one `Sync request` row
with the single cause.

### 6. The dashboard tells the truth (`apps/web/src/App.tsx`, `model.ts`)

`WorkspaceContext` carries `authenticated`. When the store resolves without a
verified credential the dashboard shows **“Shopify authorization required · No
verified session credential”** with a *Reconnect Shopify* action instead of
“Shopify data plane ready”, plus a critical `UnauthorizedStoreBanner` whose
primary action re-runs the OAuth re-authorization.

## Tests

New:

* `apps/api/src/session-cookie-auth.test.ts` (15) — cookie signing round-trip,
  tamper/wrong-secret/unsigned rejection, placeholder-secret refused, cookie
  authenticating a `storeId` GET **and** `POST /sync/all`, cookie ignored when
  a bearer was sent, and all four `/session/context` `authenticated` cases.
* `apps/web/src/session-token-guidance.test.ts` (6) — the three guidance
  branches and the banner wiring, including the fresh-token retry outcome.
* `shopify-app-bridge.test.ts` — regression tests that `noopener` is never
  passed for `_top` and that a null return is treated as dispatched.

Updated: tests that encoded the old behaviour now assert the fixed one —
`noopener` removed from `_top` calls, failure only when `window.open` throws,
and the new banner wording.

## Operator note (still worth doing on Render)

These fixes make the failure honest and recoverable; they do not replace
matching the deployment’s credentials to the installed Shopify app. One grep
settles the remaining question:

```bash
"hasBearer":false            → no token reached the API (open from the admin)
"code":"AUD_MISMATCH"        → put `aud_received` into SHOPIFY_API_KEY_ALIASES
"code":"INVALID_SIGNATURE"   → SHOPIFY_API_SECRET belongs to a different app
```

New optional variable: `SESSION_COOKIE_SECRET` (falls back to `JWT_SECRET`;
documented in `.env.example`).

## Risk

* Existing unsigned cookies stop authenticating the data plane (they still name
  the store). Recovery is automatic: the embedded app load re-issues a signed
  cookie on every verified load.
* Cookie auth is additive — it is only reachable when no bearer was sent, so
  embedded behaviour and its diagnostics are unchanged.
