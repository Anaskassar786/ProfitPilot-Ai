# PR: fix(auth): restore embedded shop context and hide false Connect Shopify CTA

**Date:** 2026-08-21 · **Scope:** Frontend embedded auth + store-context boot only (no billing, no GDPR, no sidebar changes)

## Root cause

After the Polaris/App Bridge rewrite (#156) and the nav-leak hotfix (#157), the
embedded app booted with **no loading gate and no retry** around its single
`/session/context` bootstrap fetch. Concretely:

1. **The connect wall was painted on every render where `storeId` was still
   null** — including the first paint, while the App Bridge session token and
   `/session/context` were still in flight. Any transient hiccup (App Bridge
   CDN still booting, a slow first frame, a 401, a network blip) left the
   merchant staring at a permanent "No Shopify store context detected" banner,
   "Connect Shopify" CTAs, and a "Connect your Shopify store" dashboard title —
   even though they were an installed embedded merchant inside Shopify Admin.
2. **The bootstrap fetch ran exactly once and never waited for the session
   token.** `fetchSessionContext` fired immediately; `attachEmbeddedSessionToken`
   raced the App Bridge `idToken()` mint. If the token wasn't ready, the request
   went out bearer-less, the (third-party-blocked) cookie couldn't vouch for the
   tenant, and the UI fell into the connect empty state.
3. **A 401 or missing tenant was conflated with "not installed."** The old
   `catch` just set `{ storeId: null, shop: null }`, so a session-expired store
   was told to install from scratch.
4. **App Bridge boot had no runtime guard.** A static/CDN-hosted build with an
   empty `shopify-api-key` meta placeholder, or a blocked CDN script, left the
   bridge unable to mint tokens at all.

## What changed

### Frontend — embedded boot (`apps/web/src/main.tsx`, `shopify-app-bridge.ts`, `api.ts`, `App.tsx`)

- **App Bridge boot:** `main.tsx` now calls `ensureShopifyApiKeyMetaTag()`
  before render (fills the v4 meta tag when the build placeholder was empty).
  `shopify-app-bridge.ts` gains an npm-`@shopify/app-bridge` `createApp`
  fallback (lazy chunk) used when the CDN global is missing or has no
  `idToken()`, plus `getShopifySessionTokenWithRetry()` (one retry, 250 ms).
- **Token-first bootstrap:** `api.ts` gains `warmUpEmbeddedSessionToken()`
  (retries once, fires the single de-duplicated session-expired notification).
  `App.tsx` awaits it **before** the first `fetchSessionContext`, so the very
  first request already carries `Authorization: Bearer <idToken>`.
- **Loading gate:** new `authState` (`loading | ready | unavailable`). While
  loading, the main content shows a spinner — never the connect wall.
- **Correct connect condition:** `showConnect = authState === 'ready' &&
  !context.storeId && !context.shop`. The ContextBanner, the dashboard connect
  title, the sync-banner "Connect Shopify" CTA, and the legacy
  `OnboardingModal` are all gated on it. Installed merchants (shop known,
  tenant pending) get a "Restoring your store context…" reload banner; a failed
  bootstrap gets a Retry banner; a 401 or failed token mint gets exactly one
  Polaris `Banner` — "Session expired — reload the app" (no stacked toasts).
- **Sync guards:** `sync`/`syncAll` no longer auto-open the legacy install
  modal for installed stores whose context is still resolving.
- **Dashboard:** greeting stays a normal greeting for installed stores; the
  "Connect your Shopify store" title is reserved for the genuinely-uninstalled
  state. "No store context" label removed from the sync banner.

### Backend — bootstrap source of truth (`apps/api/src/session-routes.ts`)

- `GET /session/context` now returns `{ storeId, shop, installed }` so the
  frontend can distinguish "no tenant, no shop" (not installed) from "shop
  known, tenant missing" (reload/reauth). Resolution order unchanged: verified
  bearer → session cookie → signed `shop` param, all through the store
  directory. No billing or GDPR touched.

## Verification

- `pnpm build` — passes (all workspaces).
- `pnpm typecheck` — passes (all workspaces).
- New tests lock the contract:
  - `shopify-app-bridge.test.ts` — retry-once warm-up, retry budget, meta-tag guard.
  - `api-embedded-auth.test.ts` — `warmUpEmbeddedSessionToken` success/once-only failure/no-op.
  - `session-routes.test.ts` — `installed: true/false` in the bootstrap payload.
  - `embedded-context-gate.test.ts` — source contract: connect wall derives
    from settled bootstrap state (never analytics), false banner copy gone,
    single session banner, modal gated on `showConnect`.
- Full test suite: identical pass/fail set to the pre-change baseline (no
  regressions; the pre-existing failures are environment-level Polaris SSR
  issues unrelated to this change).

## Rules honored

- ❌ No billing/mock-charge changes · ❌ No GDPR changes · ❌ No custom sidebar
  reintroduced · ✅ Polaris components only · ✅ Minimal diff focused on
  auth/context/connect CTA.
