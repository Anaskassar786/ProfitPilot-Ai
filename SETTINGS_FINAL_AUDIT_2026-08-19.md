# Settings — complete final audit + no-internal-server-error verification (2026-08-19)

Scope: the full Settings workspace (all six tabs, both themes), its backend
routes, and a project-wide pass to confirm zero internal server errors.

## What was inspected

- **Frontend** — `apps/web/src/settings.tsx` (955 lines), `settings-model.ts`,
  `settings.css`, `settings.test.ts`, `settings-functional.test.tsx`,
  `settings-light.test.ts`, and the shell wiring in `App.tsx`
  (theme toggle, reduced-motion class, Jarvis bubble hide + position via
  `SETTINGS_EVENT`, per-store persistence).
- **Backend** — `GET/POST /settings/merchant-email`,
  `POST /settings/merchant-email/verify`, `GET/PUT /settings/workspace`,
  plus every endpoint the page calls (`/billing`, `/sync/status`,
  `/jarvis/preferences`, `/store-coach/preferences`,
  `/ai-command/preferences`, `/exports`).
- **Full surface cross-check** — every frontend API path (164) was matched
  against backend route registrations (255). **0 missing routes.**
- **Runtime boots** — API (`:3000`), web dev server (`:5173`), worker
  (`:3100`). `/live`, `/health`, `/ready`, `/security/csrf`, SPA deep links
  (`/store/:id/settings`) and the Vite proxy all answer correctly.
- **Full workspace gates** — `corepack pnpm build` ✅, `corepack pnpm
  typecheck` ✅ (all 19 packages), `corepack pnpm test` ✅ (211 files, 2664
  tests).

## What works (verified)

| Area | Status |
| --- | --- |
| All six sidebar tabs navigate and highlight | ✅ |
| Store context shows the real Shopify domain + clickable admin link | ✅ |
| Merchant email save → verification token → verify → Verified badge | ✅ |
| Theme dark/light + reduced motion persist and apply to the shell | ✅ |
| All six notification toggles save locally + `PUT /settings/workspace` | ✅ |
| AI mode, bubble toggle, position, quiet hours | ✅ |
| Store Coach personality (plan-gated with Upgrade Plan CTA) | ✅ |
| AI Command response style + auto-suggestions | ✅ |
| Team Members: real owner, honest Coming Soon, plan gating | ✅ |
| Security: OAuth status, honest empty audit, privacy facts, real exports | ✅ |
| Danger Zone: confirmation modal + type-the-store-domain for disconnect | ✅ |
| Both dark and light themes render professionally | ✅ |

## Bug found and fixed

**AI Preferences “Save” silently swallowed server failures.**

Before: `updateCoachPreferences` and `updateAiCommandPreferences` were wrapped
in `.catch()` that only rethrew 402 plan gates. A 500 (or any other failure)
from either endpoint was swallowed, and the page still showed
“AI preferences saved.”

After (`apps/web/src/settings.tsx`):
- The four saves run through `Promise.allSettled`.
- A 402 plan gate still shows the upgrade prompt (other saves complete).
- A core Jarvis save failure shows a real error toast.
- Any other partial failure shows an honest warning —
  “Saved on this device, but some AI server settings could not be saved
  right now.”
- The local device save still lands, so the merchant never loses state.

## Regression tests added (`settings-functional.test.tsx`)

1. Coach preferences PATCH returns 500 → warning toast, no false success,
   local state still persisted.
2. Jarvis preferences PUT returns 500 → error toast, no false success.

Settings-related test count: **39** (13 model + 3 light CSS + 13 functional +
10 backend). Full workspace: **2664 tests pass.**

## No internal server errors

- API and worker boot with zero errors in the log.
- All probed endpoints return the API envelope (200/400/404/503 as designed) —
  no HTML error pages, no stack traces to the client.
- Every frontend API call has a matching backend route (164/164).
- Error middleware normalizes anything unexpected to a sanitized JSON 500.
