# Store Coach — Ultra-Level Audit & Functional Test Report

**Date:** 2026-08-19
**Scope:** Store Coach only (page, sub-views, API routes, service layer, dev-server routing).
**Branch:** `arena/01a018cf-profitpilot-ai`

Other modules (AI Command, Recommendations, Automation, GrowthIQ, PatternAI) were not
modified, except for one genuinely broken shared test that this audit fixed (see B4).

---

## 1. Result summary

| Check | Before | After |
|---|---|---|
| Full test suite | 203/204 files, 2539/2540 tests (1 failing) | **204/204 files, 2558/2558 tests** |
| Store Coach API routes returning 5xx | 1 (`review/:id/email` → 503) | **0** |
| Fabricated / hardcoded merchant data | 4 instances | **0** |
| Dead or non-functional buttons | 4 | **0** |
| "Coming soon" placeholder surfaces | 2 | **0** |
| Store Coach deep links surviving refresh | 0 of 5 (all 404) | **5 of 5** |
| Rules-of-Hooks violations | 2 | **0** |
| Workspace build (`pnpm -r build`) | pass | pass |
| Workspace typecheck (`pnpm -r typecheck`) | pass | pass |
| Console errors on mount (populated + empty store) | 0 | **0** |

New permanent regression tests added: **17** (12 UI integrity + 5 API sweep cases
covering 62 routes × 4 plans + a hostile-input pass).

---

## 2. Bugs found and fixed

### A. Fake / fabricated data (merchant-visible)

**A1 — Hardcoded sync progress and order count.** *(most serious)*
`store-coach.tsx` rendered a literal progress bar while priorities loaded:

```
Sync Progress: 60%  [████████░░░]
Need 30+ orders for personalized priorities · Currently: 12 orders
```

`60%` and `12 orders` were string constants — shown to **every** store regardless of
its real sync state. A merchant with 0 orders or 5,000 orders saw "12 orders".
**Fix:** replaced with an honest loading state that claims no numbers.

**A2 — Invented personality trait scores.**
`CoachPersonalityRadarSmall` drew a radar chart from a hardcoded lookup
(`PROFESSIONAL: [80,60,90,50]`, etc.) presented as "Current style traits". No API
produces these values. **Fix:** component and its usage removed.

**A3 — Momentum wave mislabelled as a week.**
The revenue wave always captioned its x-axis `M T W T F S S` (7 weekdays) while
plotting an arbitrary-length series (up to 90 points). The labels did not correspond
to the plotted data. **Fix:** caption now reads `oldest · N days of real revenue · latest`.

**A4 — Progress heading promised a window it never requested.**
The card printed `{planLimit}-DAY LOOK BACK` (e.g. "90-DAY LOOK BACK" on Growth) but
the fetch was hardcoded to `days=30`, so a Growth/Commander merchant read a 90-day
headline over 30 days of data. **Fix:** the home page now requests 90 days, the API
clamps to the real plan entitlement, and the heading renders `summary.window` — the
window the server actually served. The Progress sub-view derives its window from the
plan instead of a hardcoded 30.

### B. Broken / dishonest controls

**B1 — "Take Action" did not take any action.**
The primary button on every priority card was labelled `Take Action`, implying the app
would perform the task. It only called `completePriority` — a status write. The
priority's `actionType` / `actionPayload` fields were never read by the UI at all.
**Fix:** relabelled `Mark as done` (with a `Saving…` busy state), which is what it does.

**B2 — Four dead buttons in the Progress sub-view.**
`CoachProgressView` passed `onNavigate={() => undefined}` and
`onRetry={() => undefined}`, so "Open progress view", "Explore detailed patterns",
the back arrow, and the error-state **Retry** button were all inert — Retry on a
failed load did nothing at all. **Fix:** wired to real `history.back()` / `load()`
handlers.

**B3 — "Email me this review" always failed on deployments without SMTP.**
`POST /store-coach/review/:id/email` throws `DEPENDENCY_ERROR` 503 when no mailer is
configured, but the button was rendered unconditionally — a guaranteed error toast.
This was the single 5xx the endpoint sweep found.
**Fix:** the service now reports `emailAvailable` / `pdfAvailable` capability flags,
and the UI only renders actions the server can actually perform.

**B4 — Time-of-day flaky test (pre-existing, unrelated to Store Coach).**
`command-center-functional.test.tsx` asserted an exact "7 insights today" count over
fixtures spanning the previous 8 hours against a live `Date.now()`. Whenever the suite
ran before 08:00 UTC those rows straddled UTC midnight and the count silently drifted
(observed 7 → 6 → 5 across consecutive runs on the same commit). This was failing on
`main` before any of my changes. **Fix:** pinned the clock with
`vi.setSystemTime`, making the assertion deterministic.

### C. Correctness / robustness

**C1 — Two Rules-of-Hooks violations.**
`HeatmapSection` and `BestDaysSection` both called `useMemo` *after* an
`if (!heatmap) return <CoachSkeletonRow />` early return. Hook count therefore varied
between renders as the payload flipped null ↔ loaded (which happens on every reload
and on the Progress view's independent fetch).

*Honest note:* I probed this and React 19 tolerates it in the current arrangement —
I could not produce a crash or a warning, so this was a latent defect rather than an
active outage. It becomes a real "Rendered fewer hooks than expected" crash the moment
any hook is added below the early return. **Fix:** hooks hoisted above the early
return, using a stable `EMPTY_HEATMAP_CELLS` constant so the `useMemo` dependency
identity does not churn.

**C2 — Nonsense projection sentence on malformed goal data.**
`GoalPaceNote` formatted unvalidated numbers, producing
`Coach's projection: at today's real pace (—/day) you're heading to about — by …`
whenever a pace field was missing or non-finite. **Fix:** the note is suppressed
unless every number it prints is finite and usable.

**C3 — Unreachable dead branch.** In `GoalSection`, `active = goals[0]`, so inside the
`!active` branch `goals.length > 0` can never be true; the copy
"You have N goals — none active this week" was unreachable. Removed.

### D. Dev-server routing (found by running the app, not by reading it)

**D1 — Every Store Coach deep link 404'd on refresh.** *(most serious)*
The Vite proxy's broad `'/ai'` rule swallowed all `/ai-growth-command/*` navigations
and forwarded them to the API, so refreshing or deep-linking to Store Coach answered a
**page navigation with API JSON**:

```
/ai-growth-command/coach              -> 404
/ai-growth-command/coach/goals        -> 404
/ai-growth-command/coach/progress     -> 404
/ai-growth-command/coach/achievements -> 404
/ai-growth-command/coach/settings     -> 404
```

PatternAI and Automation already had HTML-bypass rules for exactly this problem;
Store Coach was missing one. **Fix:** added an `^/ai-growth-command` bypass that serves
the SPA shell to browser navigations (`Accept: text/html`) while genuine API calls —
which never accept HTML — still reach the API. All five paths now return 200, and
`/store-coach/*` API calls still proxy correctly.

### E. Clutter removed (the "make it more attractive" ask)

- **`ComingSoonSection`** and both surfaces it powered ("Executive Briefing" and
  "Insights Hub"), which told merchants features were *"Shipping in PR #49 / PR #50"* —
  internal PR numbers leaking into the product UI.
- **`briefing` / `insights` view types and routes** — `/insights` is owned by PatternAI
  and `/briefing` never shipped; both now fall back to the coach home.
- **`CoachChartTooltip`** — defined, never rendered (dead since a chart-library swap).
- **`averageOf`** — defined, never called.
- **`onBackNavigate`** — a wrapper that ignored its argument.
- **`CoachPersonalityRadarSmall`** — the fake-data radar (A2).
- **Unused `Award` and `Star` icon imports.**

Net effect on the page: 13 real, data-backed sections and no placeholder blocks.

---

## 3. How this was tested

### Live API sweep — every route, every plan
`apps/api/src/store-coach-endpoint-sweep.test.ts` boots the **real Express app** over a
real HTTP socket and exercises **62 route probes × 4 plans (trial/start/growth/commander)**,
asserting no response is ever ≥ 500. Probes deliberately include hostile input:

- missing `storeId`, non-numeric `days=abc`, `days=-5`, `days=99999`, `days=0`
- unknown metrics, bogus goal statuses, invalid personalities, `huddleTimeMinutes=99999`
- empty request bodies, malformed dates, out-of-range onboarding steps
- operations on non-existent huddle / priority / goal / report ids
- double-resolving an already-completed priority

All resolve as 400 / 402 / 404 as designed — **zero 500s**. A dedicated case asserts the
missing-`storeId` path is a clean 400 across all 62 routes.

### UI integrity suite
`apps/web/src/store-coach-integrity.test.tsx` (12 tests) mounts the full app against a
**populated** store (14 days of real series, heatmap cells, active priorities, streak) —
the empty-store path was already covered by the existing mount test. It asserts:
no fabricated strings, no "coming soon", no leaked PR numbers, correct button labels,
route round-tripping, and — by clicking **every enabled button on the page** — that no
control produces a React error or hook warning.

### Regression-proofing (mutation check)
I verified the new tests actually fail when the fixes are reverted, rather than passing
vacuously. Reverting the priority label, the wave caption, and the proxy rule each
produced the expected failure; all were then restored.

### Manual verification against a running app
Booted the Vite dev server plus a mock API serving realistic payloads, and rendered the
real page. This is how D1 was found — it is invisible in unit tests. Final render:
**0 console errors**, all 13 sections present, no fake strings.

---

## 4. Honest notes / limitations

- **C1 is a latent defect, not an observed crash.** I tried to reproduce a hook-order
  failure and React 19 absorbed it. I fixed it because it is a real violation that
  breaks on the next edit, but I am not claiming it was causing a live outage.
- **No real browser screenshot.** Chromium could not be downloaded in this sandbox
  (`playwright install` blocked), so visual verification was done via full jsdom render
  dumps plus live HTTP checks rather than pixel screenshots. CSS-only regressions would
  not be caught by this method.
- **D1 is a dev-server fix.** Production serves the SPA through `web-app.ts`, not Vite,
  so this specific 404 affected local development and preview environments.
- **No database was exercised.** The API sweep uses the in-memory repositories the
  existing route tests use; Postgres-specific SQL in `store-coach-repositories.ts` is
  covered only by the pre-existing suite.
- **"Take Action" is now honestly labelled, not implemented.** The backend supplies
  `actionType`/`actionPayload` that the UI still ignores. Wiring real deep-link actions
  is a product change beyond this audit's scope; I fixed the false promise rather than
  silently leaving it.
