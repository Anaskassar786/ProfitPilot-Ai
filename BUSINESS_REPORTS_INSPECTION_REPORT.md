# Business Reports — Full Inspection & Fix Report

Date: 2026-08-19
Scope: the merchant-facing **Business Reports** section
(`apps/web/src/reports.tsx`, `reports-model.ts`, `reports.css`,
`packages/reporting/src/*`, `apps/api/src/f8-routes.ts`, `f8-bootstrap.ts`,
`f8-repositories.ts`, `apps/worker/src/report-job.ts`) plus its billing/plan
integration.

## TL;DR

The section was functional on the surface but had **no server-side enforcement of
the monthly subscription quota** — the plan gating existed only in the UI, so a
trial/start store could call `POST /reports/generate` directly and generate
unlimited reports. That is now fixed and metered. Three additional bugs were
found and fixed (invalid-period 500, the Email button silently not sending, and
the UI plan matrix drifting from the canonical entitlement). All 2666 tests pass
and every workspace typechecks.

## What was checked

| Concern | Result |
|---|---|
| Server crash on generate | No crash paths; but invalid periods surfaced as **500** instead of **400** (fixed) |
| 401 / auth errors | Reports endpoints ride the same session/CSRF middleware as the rest of the API; no report-specific 401 bug found |
| Network error handling | `refresh()` uses `Promise.allSettled` and surfaces a friendly error banner — correct |
| CSRF on `POST /reports/generate` | Token initialized at app boot + auto retry in `requestJson` — correct |
| Monthly subscription plan | **Broken server-side** (no enforcement, no metering) — fixed |
| Tenant isolation / RLS | `report_runs` / `report_schedules` have `WITH CHECK` policies (migration `0014`); repositories use `withTenantContext` — correct |
| R2 / vault fallback | PDF is stored in `report_runs.content_base64` and mirrored to R2 when configured — correct |

## Problems found & fixed

### 1. (Critical) Monthly subscription quota was not enforced on the server

`POST /reports/generate` accepted any request. The Trial/Start/Growth/Commander
report limits lived only in the client (`reports-model.ts`), so they were
cosmetic: anyone could bypass them by calling the API directly, and the `reports`
row in `billing_usage` was never incremented, so the Billing page always showed
`0 used` for reports.

**Fix**
- `ReportService` now accepts an optional `ReportQuota` gate
  (`packages/reporting/src/f8-vault.ts`).
- On generate it **atomically reserves** one `reports` slot in `billing_usage`
  (`INSERT … ON CONFLICT … DO UPDATE … WHERE used < limit`), matching the existing
  recommendation/analytics/orders metering pattern. Two concurrent requests
  cannot both claim the last slot.
- When the limit is reached it returns **402 `PAYMENT_REQUIRED`** with
  `reason: UPGRADE_REQUIRED`, `feature: reports`, `plan`, `used`, and `limit`.
- A reserved slot is **refunded** if generation fails, so a failed attempt never
  burns a merchant's monthly allowance.
- Idempotent re-generation (same frequency + period) does **not** double-count.

### 2. (High) UI plan matrix drifted from the canonical entitlement

The UI said Start = 3 reports/month + 1 quarterly and Growth = unlimited. The
single source of truth (`PLAN_ENTITLEMENT_LIMITS.reports`) is Trial 1 / Start 1 /
Growth 2 / Commander unlimited, and the README states plan limits live in one
place. The UI now mirrors it, and quarterly/custom are Growth+ features so the
client and server can never disagree.

`apps/web/src/reports-model.ts`: `PLAN_ACCESS` aligned; `canGenerateReport` and
`usageCopy` now count **all** reports in the current UTC month against the one
monthly entitlement.

### 3. (High) The vault's "Email" button reported success but sent nothing

`emailRun` re-issues `POST /reports/generate` with `email: true` for a report
that is already `COMPLETED`. The service's idempotent-replay path returned the
stored run **without sending the email**, while the UI toasted "Report emailed".
Now the replay path honors the email request, delivers the stored PDF, and
persists `emailStatus` (`SENT`/`FAILED`), and the UI reflects the real outcome.

### 4. (Medium) Invalid report periods returned a 500 instead of a 400

`assertClosedPeriod` throws a plain `Error`/`RangeError`, which the error handler
mapped to `500 INTERNAL_ERROR`. A bad `start`/`end` (e.g. a future end date) is a
client mistake, so it now maps to `400 VALIDATION_ERROR` with the same message.

### 5. (Low) Locked report cards hardcoded a "trial" plan for the upgrade CTA

`GenerateCard` passed `plan="trial"` to `UpgradePlanButton` regardless of the
merchant's real plan. It now receives the actual plan. Also removed a redundant
`?? (trial ? 'trial' : 'trial')` fallback in `refresh()`.

## Known gap (not a regression)

`report_schedules` are writable via `GET/POST /reports/schedules`, and the worker
has a `SixHourlyReportTick` class — but **no runner** reads due schedules and
generates reports, and the reports page has no scheduling UI. Scheduled reports
are therefore a stored-but-inert feature. This is outside the section's on-demand
flow and is left as a documented follow-up (needs a schedule runner wired to the
existing `ReportService`).

## Verification

```
corepack pnpm -r --workspace-concurrency=1 run typecheck   # all pass
corepack pnpm vitest run                                   # 211 files, 2666 tests pass
```

New/updated coverage:
- `packages/reporting/src/f8-reporting.test.ts` — quota enforcement, idempotent
  replay no-double-count, refund-on-failure, email-on-replay, 400 validation.
- `apps/web/src/reports-model.test.ts` — canonical plan matrix and monthly
  counting across report kinds.
- `apps/api/src/f8-bootstrap.test.ts` — report composition exercises the new
  billing_usage quota reservation.

## Files changed

- `packages/reporting/src/f8-vault.ts`
- `apps/api/src/f8-bootstrap.ts`
- `apps/web/src/reports-model.ts`
- `apps/web/src/reports.tsx`
- `packages/reporting/src/f8-reporting.test.ts`
- `apps/web/src/reports-model.test.ts`
- `apps/api/src/f8-bootstrap.test.ts`
