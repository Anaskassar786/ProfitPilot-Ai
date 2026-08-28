# Investigation — “Session expired” + every module “Authentication is required”

**Date:** 2026-08-28 · **Store:** `commander-pilot.myshopify.com` (display name “Commander Pilot”)
**Reported UI state (verbatim from the merchant screenshot):**

```
API unavailable · Some synced data could not be loaded: Authentication is required
Session expired — Your Shopify session expired — reload the app to reconnect.
Good morning, Commander Pilot
Welcome back — your workspace is ready for real Shopify data.
Shopify data plane ready · No analytics sync yet
products / orders / customers / inventory / collections / discounts → Authentication is required
```

**Status: diagnosed.** The last line of the investigation (§6) narrows the trigger to
one of three environment causes; §7 gives the single log line that settles it in
10 seconds. No code has been changed yet.

---

## 1. TL;DR

Nothing is wrong with the Shopify connection, the offline access token, or the
database. **The app shell is authenticated by a completely different (and much
weaker) mechanism than the data plane.**

| Layer | Requires | Result in this incident |
|---|---|---|
| Bootstrap — `GET /session/context` | **Nothing.** No token, no signature. Falls back to the session cookie or the *unsigned* `?shop=` query param. | **200** → the shell renders “Good morning, Commander Pilot”, “Shopify data plane ready” |
| Data plane — `GET /analytics?storeId=…`, `/catalog`, `/orders`, `POST /sync/all`, … | A **verified Shopify session token** in `Authorization: Bearer` | **401 “Authentication is required”** → every card empty, every sync module red |

So the dashboard confidently says “your workspace is ready” at the exact moment
every single data call is being rejected. That is the contradiction you are
looking at — it is a **reporting bug on top of an auth failure**, not two
different problems.

The “Session expired” banner is *also* misleading: it does **not** mean the
Shopify session expired. It is the generic name of the banner the client shows
whenever any `storeId`-scoped call answers 401.

---

## 2. Proof (reproduced locally, not inferred)

I built a throwaway harness that mounts the **real** `authenticationMiddleware`,
`tenantContextMiddleware` and `createSessionRouter` from this repo against a
fake store directory, with `requireAuthentication: true` (the production
default) and a real `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` pair. Results:

| # | Request | Credential sent | Status |
|---|---|---|---|
| 1 | `GET /session/context?shop=commander-pilot.myshopify.com` | **none** | **200** `{storeId, shop, installed:true}` |
| 2 | `GET /catalog?storeId=store_abc123` | **none** | **401** `Authentication is required` |
| 3 | `GET /catalog?storeId=store_abc123` | session cookie only | **401** |
| 4 | `GET /catalog?storeId=store_abc123` | valid App Bridge token | **200** |
| 5 | `GET /catalog?storeId=store_abc123` | valid signature, **wrong `aud`** | 401 `AUD_MISMATCH` |
| 6 | `GET /catalog?storeId=store_abc123` | **wrong secret** | 401 `INVALID_SIGNATURE` |
| 7 | `GET /catalog?storeId=store_abc123` | expired token | 401 `EXPIRED` |
| 8 | `POST /sync/all` body `{storeId}` | none | **401** |

Rows 1–3 are the whole story of the screenshot: **the shell can boot with zero
credentials while the data plane cannot boot at all.** Row 8 is why all six
sync modules are painted red with one identical message — a single 401 on
`POST /sync/all`, not six independent Shopify failures.

The harness was deleted afterwards; the branch is untouched.

---

## 3. The exact code paths

### 3.1 Why the shell says “Shopify data plane ready”

`apps/api/src/session-routes.ts:53` — `resolveContext()` tries three sources in
order and **never 401s**:

1. a verified Bearer session token,
2. the `profitpilot_session` **cookie** (`:64`),
3. the `?shop=` **query parameter**, which is unsigned (`:71`).

If any one resolves a `stores` row it returns `200 { storeId, shop, installed: true }`.
There is no `storeId` in the request, so `tenantContextMiddleware` short-circuits
(`apps/api/src/security.ts:516`) and `authenticationMiddleware` skips the 401
because `hasTenant` is false (`security.ts:346`).

The client then renders the greeting and the “ready” pill from that answer:

* `apps/web/src/App.tsx:1040` → `greetingTitle` / “Welcome back — your workspace is ready for real Shopify data.”
* `apps/web/src/App.tsx:1081` → `context.storeId ? 'Shopify data plane ready' : 'Waiting for store context…'`

`latestSyncLabel(null)` returns `'No analytics sync yet'` (`apps/web/src/model.ts:165`).

### 3.2 Why every data call is rejected

`apps/api/src/security.ts:340` — `authenticationMiddleware` looks at **one thing
only**: `bearerToken(request)`. There is no cookie path, no query-HMAC path, no
`x-shopify-session-token` path. If there is no verifiable Bearer and the request
carries a `storeId`, it 401s (`security.ts:348`).

`apps/api/src/security.ts:513` — `tenantContextMiddleware` then repeats the check
and is the only place that logs `hasBearer`:

```
Tenant request rejected: NO_AUTH_CONTEXT — no verified session token or JWT
accompanied a storeId-scoped request   { code, path, method, hasBearer, requestId }
```

`requireAuthentication` is **true by default in production**
(`security.ts:151`), so this is always on for the Railway deploy.

### 3.3 Why the six sync modules are all red with the same text

`apps/web/src/App.tsx:782` — when `POST /sync/all` itself rejects, the catch
block paints **every** module with the single error string:

```ts
setSyncProgress(syncModules.map((module) => ({ module, status: 'failed', detail: message })))
```

`syncModules = ['products','orders','customers','inventory','collections','discounts']`
(`App.tsx:236`). It reads like “all six Shopify modules are broken”; it is really
“one auth call failed six times”. This is cosmetic but it is what made the
screenshot look catastrophic.

### 3.4 Why the “Session expired” banner appears

`apps/web/src/api.ts:90` → `notifyEmbeddedAuthFailure()` (`:274`) fires on the
first 401 that survived the silent fresh-token retry. It first tries an
automatic top-level re-auth (`attemptEmbeddedReinstallRedirect()`, `:426`) and
only shows the banner **if that redirect could not be dispatched**.

The banner text is hard-coded in `App.tsx:497`:

```ts
setSessionError('Your Shopify session expired — reload the app to reconnect.')
```

…even though the underlying failure is usually “no token reached the API” or
“the token was rejected” — nothing to do with expiry.

---

## 4. Latent defects found while investigating

These are real bugs regardless of which environment cause in §6 is yours. They
are why the failure is *stuck* and *mislabelled* rather than self-healing.

### D1 — Bootstrap is unauthenticated, data plane is token-only
`session-routes.ts:53` vs `security.ts:340`. Guarantees the “ready dashboard +
dead data” contradiction on any credential outage. **(Confirmed by repro rows 1–3.)**

### D2 — The session cookie can never authenticate the data plane
`security.ts:340` only reads `Authorization: Bearer`. The `profitpilot_session`
cookie set at install time (`embedded-entry.ts` → `setSessionCookie`) is accepted
by `/session/context` but by nothing else. So in **any** context where App Bridge
does not mint a token — standalone tab, blocked CDN script, missing `host`
param, preview iframe — **no request can ever succeed, no matter how many times
you reinstall.** Reinstalling cannot fix it. **(Confirmed by repro row 3.)**

### D3 — `navigateTopLevel()`’s last-resort escape can never report success
`apps/web/src/shopify-app-bridge.ts:243`:

```ts
const opened = window.open(url, '_top', 'noopener')
if (opened) return true
```

MDN, `Window.open()` → `noopener`: *“If this feature is set, the new window will
not have access to the originating window via `Window.opener` **and returns
null**.”* [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/open)

So `opened` is **always null**, `navigateTopLevel` returns `false`, and
`notifyEmbeddedAuthFailure` falls through to the red banner. The code comment
above it claims `null` means “popup-blocked” — that is wrong for `noopener`.
This defeats the entire automatic 401 recovery added in
`EMBEDDED_401_PERMANENT_FIX_REPORT.md` whenever App Bridge’s navigation surfaces
are unavailable.

### D4 — App Bridge failure is completely silent
`attachEmbeddedSessionToken()` (`api.ts:482`) catches everything and returns
`{ status: 'unavailable' }`. `getShopifySessionToken()` never throws. A CDN
blocked by CSP, a missing `VITE_SHOPIFY_API_KEY`, or an `idToken()` rejection is
invisible — the user just gets a generic 401.

### D5 — The sync panel amplifies one error into six
`App.tsx:782`. Cosmetic, but it is what makes an auth blip look like a total
Shopify outage.

---

## 5. What is definitively ruled out

* **The Shopify offline access token is fine.** A missing/revoked offline token
  fails *inside* a sync with a Shopify-specific message and would leave
  `/analytics` and `/catalog` (which read our own DB) working. Here even
  `POST /sync/all` never got past authentication.
* **The `stores` row exists.** `/session/context` resolved `storeId` + `shop`
  from it — that is where “Commander Pilot” came from.
* **`NODE_ENV`/`SECURITY_REQUIRE_AUTH` misconfiguration.** If auth were off,
  nothing would 401.
* **DB or migrations.** `STORE_NOT_FOUND` / `DB_UNAVAILABLE` would be logged and
  `/session/context` would have returned `storeId: null`.

---

## 6. The remaining question: why is the Bearer missing or rejected?

Three candidates, all consistent with the screenshot:

| | Cause | Signature in the server log |
|---|---|---|
| **A** | **No `Authorization` header reaches the API at all.** Not embedded (no `host` param → `getShopifySessionToken()` returns `not-embedded` and never attaches a header), or App Bridge failed to mint (`window.shopify` missing / CDN blocked / `idToken()` rejected). | `NO_AUTH_CONTEXT` with **`hasBearer: false`**, and **no** `[AuthDiagnostic]` line |
| **B** | **Client-id drift.** `SHOPIFY_API_SECRET` is right (signature verifies) but `SHOPIFY_API_KEY` ≠ the client id App Bridge mints for. | `[AuthDiagnostic] Session token 401 failure` with **`code: AUD_MISMATCH`**, `aud_received: <the real client id>` |
| **C** | **Secret drift.** `SHOPIFY_API_SECRET` was rotated / belongs to a different app. | `[AuthDiagnostic] …` with **`code: INVALID_SIGNATURE`** (+ `SHOP_CLAIM_FALLBACK_REFUSED`) |

Last session’s PR #202 added `SHOPIFY_API_KEY_ALIASES` specifically for case **B**
(see `SESSION_TOKEN_401_DIAGNOSTIC_REPORT.md`). If you never set that variable,
**B is still live**.

---

## 7. The one line that settles it

In the Railway **API service** log, filter for the failing request path
(e.g. `/analytics`):

```bash
# case A  → banner cause is "no token ever arrived"
Tenant request rejected: NO_AUTH_CONTEXT … "hasBearer":false

# case B  → copy aud_received into SHOPIFY_API_KEY_ALIASES
[AuthDiagnostic] Session token 401 failure … "code":"AUD_MISMATCH","aud_received":"<client-id>"

# case C  → SHOPIFY_API_SECRET is wrong for this app
[AuthDiagnostic] Session token 401 failure … "code":"INVALID_SIGNATURE"
```

Client-side cross-check (DevTools → Network → any `/analytics?storeId=…`
request → Request Headers): **is there an `authorization: Bearer eyJ…` header?**
No ⇒ case **A**. Yes ⇒ case **B** or **C**, and the log tells you which.

Also worth confirming: is the app being opened **inside Shopify admin**
(Apps → ProfitPilot, URL contains `?shop=…&host=…`), or as a **bare tab**?
A bare tab is case **A** by construction — `getShopifySessionToken()` short-circuits
to `not-embedded` when the `host` param is absent (`shopify-app-bridge.ts`).

---

## 8A. Render migration — what it changes (added after the merchant moved hosts)

Moving from Railway to Render does **not** change a single line of the auth
contract above, so the mechanism in §1–§3 is unchanged. What a host move *does*
change is every credential and every URL, which makes cases **B** and **C** in
§6 the overwhelming favourites:

| What moves | What breaks if it drifts | Symptom |
|---|---|---|
| `SHOPIFY_API_KEY` | no longer the client id App Bridge mints for | `AUD_MISMATCH` |
| `SHOPIFY_API_SECRET` | copied wrong, or from a *different* Shopify app | `INVALID_SIGNATURE` |
| Which Shopify app is installed on `commander-pilot.myshopify.com` | the store still carries the **old** app, so App Bridge signs with the old client id | `AUD_MISMATCH` — the classic post-migration case |
| App URL in the Partner dashboard | still pointing at Railway | app would not load at all — **not** your case, the shell renders |

**The migration-specific trap:** if the store has App **A** installed (Railway
era) while Render runs the credentials of App **B**, then *every* session token
is genuine, correctly signed by Shopify, and still rejected — because its `aud`
claim is App A’s client id. That is exactly the `AUD_MISMATCH` case, and it is
recoverable without touching the store:

```bash
# Render → API service → Environment
# SHOPIFY_API_KEY   = client id of the app you want to be (App B)
# SHOPIFY_API_SECRET= secret of that SAME app (signatures must verify)
# SHOPIFY_API_KEY_ALIASES = <client id of the app actually installed on the store>
```

`SHOPIFY_API_KEY_ALIASES` accepts the old client id **only if the HMAC still
verifies against `SHOPIFY_API_SECRET`** (`packages/shopify/src/session-token.ts`,
`matchAudience()`), so it cannot be used to bypass signature checking. Every
request served through an alias logs `code: CLIENT_ID_DRIFT`, so the temporary
allowlist cannot silently become permanent.

**Order of checks on Render:**

1. Render → API service → **Logs**, search `AuthDiagnostic`. This single grep
   separates A / B / C (see §7).
2. Render → API service → **Environment**: confirm `SHOPIFY_API_KEY` and
   `SHOPIFY_API_SECRET` come from the **same** Partner-dashboard app, with no
   quotes/newlines (`sanitizeCredential()` strips those, but verify anyway).
3. Partner dashboard → the app installed on `commander-pilot.myshopify.com` →
   **Client ID**. Compare with step 2. Different ⇒ put the *installed* app’s
   client id into `SHOPIFY_API_KEY_ALIASES` and redeploy, or reinstall the app
   on the dev store so both sides agree.
4. Only if the log shows `hasBearer:false` (case A) start looking at App Bridge:
   page source must contain a non-empty `<meta name="shopify-api-key"
   content="…">` (the API injects it at serve time from `SHOPIFY_API_KEY` via
   `web-app.ts:117`), and `https://cdn.shopify.com/shopifycloud/app-bridge.js`
   must be allowed by the CSP `script-src` (`web-app.ts:57`).

---

## 8. Recommended fix order

**Implemented** — see `PR_SESSION_AUTH_HONESTY_FIXES.md` on branch
`arena/01a046a7-profitpilot-ai`. All five defects (D1–D5) are fixed and covered
by tests; §6's environment question is the only thing left open.

1. **Pin the cause** with §7. That alone may be a one-line env change.
2. **Fix D1** — make `/session/context` fail closed when `requireAuthentication`
   is on and no credential verified, or have the client treat
   `installed: true` from the unsigned `?shop=` fallback as “context pending”,
   not “data plane ready”. The shell must stop claiming ready on a dead auth.
3. **Fix D3** — drop `noopener` from the `_top` escape (or treat `null` as
   “attempted” when the target is `_top`), so the automatic re-auth can actually
   report success instead of collapsing to the dead-end banner.
4. **Fix D2** — accept the first-party session cookie as an authentication
   credential for `storeId`-scoped reads the same way `/session/context` does,
   so non-embedded/standalone contexts are not a permanent dead end.
5. **Fix D4/D5** — surface “App Bridge could not mint a session token”
   distinctly from “session expired”, and stop fanning one sync error out to six
   module rows.
