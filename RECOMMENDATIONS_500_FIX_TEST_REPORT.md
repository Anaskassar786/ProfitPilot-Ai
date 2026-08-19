# Recommendations — 500 Error Fix and Real-Click Verification

**Scope:** Recommendations page only. No other product module was changed.

**Date:** 2026-08-19

## Result at a glance

- The Recommendations decision paths now carry the tenant context into the same PostgreSQL transaction used by the recommendation repository.
- `Skip This` is a one-click rejection and sends `POST /recommendations/:id/reject` with the current CAS version.
- `Approve & Take Action` sends `POST /recommendations/:id/approve` with the current CAS version; high-risk records still require the confirmation sheet.
- The client disables both decision buttons while a decision is in flight, reloads the active filtered page after success, and uses the required success messages: `Recommendation skipped` and `Recommendation approved`.
- At the monthly limit, discovery is blocked with an explicit Upgrade Plan warning. Reviewing existing recommendations remains available because decisions do not consume quota.
- No recommendation-specific 500 response was observed in the stateful real-click test harness or the API test suite.

## Root-cause analysis

### 1. Missing PostgreSQL tenant context on recommendation repository operations

The database protects `ai_recommendations` with a store-scoped row-level security policy that reads `current_setting('app.store_id', true)`. The production `PostgresRecommendationRepository` was using the pooled `PostgresDatabase` directly. It received a `storeId` argument, but did not set `app.store_id` on the connection that performed `get`, `decide`, `reject`, `approve`, list, summary, snooze, undo, or execution-state writes.

That made the recommendation lifecycle dependent on the database role/RLS state. In the production configuration this could turn a normal decision into an opaque database failure or a misleading compare-and-set miss. The API error middleware correctly sanitized the response to `Internal server error`, which is what the merchant saw.

**Fix:** every PostgreSQL recommendation operation now runs through `withTenantContext`. For a real `PostgresDatabase`, this opens a transaction, calls `set_config('app.store_id', storeId, true)`, and then runs the read/write on that same transaction client. The CAS update is still a single atomic SQL statement.

### 2. Unsafe UUID comparison for IDs arriving from the browser

Recommendation IDs are UUIDs in PostgreSQL, while the route parameter is user-controlled text. Directly comparing `id = $2` lets PostgreSQL cast an invalid/legacy string and raise `22P02` instead of returning a normal not-found/conflict result.

**Fix:** lifecycle lookups and updates compare `id::text = $2`. Unknown or legacy-shaped IDs now resolve through the normal API not-found/conflict path rather than becoming a 500.

### 3. Ancillary lifecycle writes also needed the store context

Calibration samples are written after a decision. That write is non-critical to the merchant decision, but it was also using the raw pooled executor. The calibration append now uses the same tenant-context helper. The route already treats calibration/audit persistence as best-effort so a ledger problem cannot turn a successful decision into a red error toast.

## Bugs fixed

| Area | Fix | Verification |
|---|---|---|
| Skip This | One click, CAS version included, server-confirmed rejection, active-page reload | Real DOM click; HTTP 200; card/status/tab/toast assertions |
| Approve & Take Action | CAS version included; duplicate clicks blocked; high-risk confirmation retained | Real DOM click; HTTP 200; approved tab/KPI/toast assertions |
| Pending tab state | Server-confirmed decision reloads the current filtered page | Pending tab no longer keeps decided cards |
| KPI Approved this month | Value/helper copy and activity bars share a deliberate row layout | SSR/UI tests; populated and empty states |
| KPI Approval rate | Null state is a clean `No decisions yet` empty state; no empty colored gauge/marker | SSR/UI tests |
| KPI Avg time to decide | Existing no-data arc remains neutral and explicitly says `No data yet`; populated state keeps a needle | SSR/UI tests |
| Monthly usage | Limit banner, `Limit reached` CTA, Upgrade Plan action, and `Come back next month or Upgrade Plan` copy | Real click at 10/10; no analysis 500 |
| Search | Searches title, reason, explanation, entity key, impact label, agent, and rule label | Real input event and clear click |
| Filters and controls | Date inputs accept input/change events; sort, tabs, group views, chips, refresh, evidence, menu, and How it works exercised | Real DOM clicks/changes |

## Real-click test evidence

New test: `apps/web/src/recommendations-functional.test.tsx`

The test mounts the real `RecommendationsWorkspace`, dispatches DOM mouse/input/change events, and uses a stateful HTTP boundary. It does not merely assert that a handler exists: the mock updates the durable recommendation state only after receiving the same endpoint and request body the browser uses. Every subsequent list/summary request reads the updated state.

### Critical decision flow

| Test | Click/action | HTTP result | Verified result |
|---|---|---:|---|
| 1.1 | First card → `Skip This` | `POST /recommendations/r1/reject` → **200** | Expected version `0`; card becomes Rejected; Rejected tab contains it; toast is `Recommendation skipped`; no request ≥500 |
| 1.2 | Second card → `Approve & Take Action` | `POST /recommendations/r2/approve` → **200** | Expected version `0`; card becomes Approved; Approved tab contains it; Approved this month changes; toast is `Recommendation approved`; no request ≥500 |
| 1.3 | `View Full Details` | `GET /recommendations/r1/evidence/verify` → **200** | Correct drawer opens; evidence field and SHA-256 are visible; close button closes the drawer |
| 1.4 | `More actions` → `Remind me in 1 hour` | `POST /recommendations/r1/snooze` → **200** | Menu opens and snooze completes without an error |

### Filters, search, and controls

The same real-click suite verifies:

- Search for `Snowboard`, then clear search.
- Sort changes to Highest confidence and sends `sort=confidence`.
- List, By agent, and By rule toggles change the active view.
- From/to date inputs send `dateFrom` and `dateTo` filters.
- Inventory Agent and All agents chips send/clear `agent=INVENTORY_AGENT`.
- Refresh makes a new GET request.
- How it works opens and Got it closes.

### Limit and high-risk flow

- With usage at **10/10**, clicking `Limit reached` produces the Upgrade Plan warning and does not send an analysis request that could become a 500.
- A high-risk existing recommendation still opens `Confirm approval`; confirming it sends an approve request and returns HTTP 200.

## API/server verification

The Recommendations API tests exercised the actual Express routes and recorded the structured request logs emitted by the API logger. Decision logs were HTTP 200 for approve/reject, with expected validation/conflict cases remaining 400/403/409 rather than 500.

Relevant command:

```text
corepack pnpm vitest run \
  apps/api/src/pr46-recommendations-api.test.ts \
  packages/ai/src/f4-repository.test.ts \
  packages/ai/src/pr46-lifecycle.test.ts
```

Results:

```text
apps/api/src/pr46-recommendations-api.test.ts   28 passed
packages/ai/src/f4-repository.test.ts            9 passed
packages/ai/src/pr46-lifecycle.test.ts         27 passed
```

The repository regression test explicitly verifies that `set_config('app.store_id', storeId, true)` is issued before the decision SQL on the same transaction client.

### Railway log limitation

This sandbox does not have a Railway CLI session, Railway project binding, or production `DATABASE_URL`, so I could not honestly claim to have read the live Railway deployment logs. No production stack trace was fabricated. The local API logger output and the transaction-level regression test are included above; after merge/deploy, the production operator should confirm the Railway log has no `recommendations/{id}/approve` or `recommendations/{id}/reject` entries with status 500.

## Test totals

Recommendations-specific checks run after the fix:

- Web model: **29 passed**
- Web UI/SSR: **45 passed**
- Web workflow: **4 passed**
- New real-click functional flow: **3 passed**
- API recommendation routes: **28 passed**
- AI lifecycle: **27 passed**
- PostgreSQL recommendation repository: **9 passed**
- Recommendations-specific total: **145 passed**
- Recommendations web/API/package builds: **passed**
- Recommendations web/API/package typechecks: **passed**
- Vite preview smoke: `/recs-verify.html` HTTP **200** and `/src/recommendations.tsx` HTTP **200**

The repository-wide run was **2482/2483** because one pre-existing, out-of-scope AI Command Center test expected `7 insights today` while its fixture currently renders `4 insights today`. That test is in another module and was not changed under the Recommendations-only constraint. The complete Recommendations test set above passes independently.

## Screenshots / visual review

A live Vite preview was started on port 5173 for visual review. It includes the existing Recommendations verification harness and can be opened at `/recs-verify.html`; it supports empty, populated, limit, and light/dark scenarios. This headless environment has no browser screenshot-capture tool, so no screenshot file is claimed as captured.
