# Reports page — functional test report

Date: 2026-08-18  
Scope: Reports page only (`apps/web/src/reports.tsx`, `reports-model.ts`, `reports.css`, App routing).

## Checklist

### Page load
- [x] Loads without errors (SSR markup + unit tests)
- [x] No `undefined` / `[object Object]` in markup
- [x] Both themes styled (dark default + light `#F8FAFC` / `#FFFFFF` / `#0F172A`)

### Header
- [x] Title is **Business Reports** (not CLOSED-PERIOD PDFS)
- [x] Merchant description: reports come from real store data
- [x] Monthly / Quarterly / Custom dropdown works
- [x] Generate Report button present and disabled without a store
- [x] Settings button opens email / white-label settings

### Report generation
- [x] Monthly, Quarterly, and Custom cards
- [x] Custom range requires a closed period (end before today)
- [x] Trial: 1 monthly report / month
- [x] Start: 3 monthly / month, 1 quarterly / quarter
- [x] Growth+: unlimited monthly/quarterly, custom range, email
- [x] Commander: white-label + API noted honestly
- [x] Locked cards say **Upgrade Plan** (never a plan name in the CTA)

### PDF vault → Your Reports
- [x] Human-readable names (`Monthly Report — August 2026`) — UUIDs never shown as titles
- [x] Status: Ready / Generating… / Failed / Emailed
- [x] “email not requested” removed
- [x] Download PDF, Preview, Email (Growth+) / Upgrade Plan, Retry, remove-from-view
- [x] Generating rows poll until ready

### Preview
- [x] Executive summary from real synced rows
- [x] Key metrics null when unmeasurable (never invented)
- [x] Revenue sparkline from `analytics_revenue_daily`
- [x] Top products from real product sales (+ forecast titles when present)
- [x] Customer summary from cohorts / forecast churn
- [x] Full PDF download from the preview

### Forecast methodology
- [x] Educational copy replaces “FORECAST METHOD STAMPS”
- [x] Minimum data: two closed weekly periods
- [x] Checkmark only when a real forecast band exists

### Data honesty
- [x] All numbers from `fetchReports`, `fetchForecast`, `fetchAnalytics`
- [x] Empty vault when nothing has been generated
- [x] No demo customers, no fake revenue

### Automated tests
```
npx vitest run apps/web/src/reports-model.test.ts \
  apps/web/src/reports-ui.test.ts \
  apps/web/src/reports-functional.test.tsx \
  apps/web/src/f8-ui.test.ts
```
**23 passed** (4 files)

## Bugs found and fixed
1. Custom reports would have reused the monthly label — now a non-1st start date renders as **Custom Report**.
2. Empty store first-paint showed a spinner forever under SSR — loading now starts false when there is no store.
3. Preview product titles fell back to raw SKUs even when forecast titles existed — titles now resolve from forecast demand.

## Screenshots
- `docs/screenshots/reports-before-dark.png` (legacy vault language)
- `docs/screenshots/reports-after-dark.png`
- `docs/screenshots/reports-after-light.png`
