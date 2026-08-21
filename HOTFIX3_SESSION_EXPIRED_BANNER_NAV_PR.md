# PR: fix(auth): eliminate false session expired banner and speed up tab navigation

**Date:** 2026-08-21 · **Scope:** Frontend embedded auth + SPA navigation only (no billing, no GDPR)

## Root cause

1. **Stuck red banner.** Transient `401 Unauthorized` responses (App Bridge
   `idToken()` delays during fast tab switching / iframe reloads) latched the
   global session banner permanently. Token-mint failures at boot
   (`warmUpEmbeddedSessionToken`) fired it too, and nothing in the success
   path ever cleared it — so the banner stayed visible even while page data
   was rendering fine (e.g. "You've reached your limit 2 of 2 automations").
2. **Sluggish tabs.** The App Bridge v4 `ui-nav-menu` (admin sidebar
   navigation) rendered plain `<a href>` anchors, which hard-navigate the
   embedded iframe — a full page reload + full bootstrap re-run on every
   admin-side tab click (Shopify app-bridge issues #240 / #242).

## What changed

### 1. Bulletproof API fetcher (`apps/web/src/api.ts`)

- Before **every** authenticated fetch, `attachEmbeddedSessionToken` awaits a
  fresh App Bridge `idToken()` — no cached bearers.
- A `401` is treated as a **transient token race, not session expiry**:
  silently mint a brand-new `idToken()` and retry the request exactly once.
- Only a `401` that **survives the fresh-token retry** latches the
  session-expired notification (`notifyEmbeddedAuthFailure`).
- Boot warm-up never latches the banner by itself anymore — the request
  outcome is the only thing allowed to surface it.
- New `setEmbeddedAuthRecoveryHandler`: any `2xx` response clears the latch
  (and the banner) automatically, and the latch resets so a later genuine
  expiry can notify again.
- Caller-supplied `Authorization` headers are never overwritten or retried
  with a minted bearer.

### 2. Auto-clear the banner on success (`apps/web/src/App.tsx`)

- The recovery handler sets `sessionError = null` on any successful
  authenticated call — the red banner can never stay visible while real page
  data is rendering.
- Bootstrap success and page-data success (`loadData`) also clear any stale
  banner.
- `onDismiss` is preserved so the merchant can always close it manually.

### 3. SPA tab navigation & cached bootstrap

- `ui-nav-menu` anchors now intercept clicks (`preventDefault`) and route
  **client-side** through the SPA router (`history.pushState`) — the same
  client-side routing pattern as the official Shopify Remix starter. No more
  iframe hard reloads; tab switching is instant.
- Header tabs remain SPA buttons (no `<a href>` full reloads).
- The floating Coach widget's "Open Store Coach" link is now intercepted and
  routed client-side too (it was the last bare internal anchor).
- The resolved `/session/context` result is **cached globally** (keyed by
  shop) so remounts never re-run the boot loading sequence (token warm-up +
  tenant lookup).

### 4. De-noised UI

- The banner region now renders inside a Polaris `Layout.Section` (the app
  shell already sits in a Polaris `Frame`) so it pushes content down
  gracefully instead of breaking the layout.

## Verification

- ✅ `pnpm build` — passes (all packages).
- ✅ `pnpm typecheck` — passes (all packages).
- ✅ Tests green: `api-embedded-auth.test.ts` (silent 401 retry, retry-proof
  latch, auto-clear on success, silent warm-up), new
  `session-expiry-hotfix.test.tsx` (source contracts + click-interception
  behavior for the App Bridge nav menu and the Coach widget), plus
  `embedded-context-gate`, `nav-chrome`, `api`, `shopify-app-bridge`.
- ⚠️ The monorepo test suite has 47 pre-existing failing test files (Polaris
  `window.matchMedia` jsdom import-order issue) — verified identical on
  `main` before this PR; **zero regressions** (20 new passing tests, same
  failing set).

No backend billing or GDPR changes.
