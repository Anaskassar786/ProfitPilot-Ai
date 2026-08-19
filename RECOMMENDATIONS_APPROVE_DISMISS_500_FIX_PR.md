# Recommendations — Approve / Dismiss 500 Fix + Full Lifecycle Verification

> **Scope:** Recommendations agent only (page, API routes, and the PostgreSQL
> recommendation repository). Dark theme, light theme, and all existing copy
> ("Upgrade Plan", "Skip This", "Approve & Take Action") preserved.

## What the merchant reported

On the Recommendations page, two of the most important buttons were broken in
production:

1. **"Skip This" (dismiss / reject)** → `Internal server error`
2. **"Approve & Take Action"** → `Internal server error`

Both share the same decision path, so the page could list recommendations but
could never actually decide on them.

## Root cause (reproduced, not guessed)

`PostgresRecommendationRepository` issues the decision UPDATE with one
parameter serving **two different SQL types**:

```sql
UPDATE ai_recommendations SET ... decided_at = $5, ...
  payload = payload || jsonb_build_object(..., 'decidedAt', $5::text, ...)
```

`$5` must be `timestamptz` for the `decided_at` column, and is also cast to
`text` inside `jsonb_build_object`. PostgreSQL's parameter-type deduction sees
two conflicting requirements and fails at parse time with:

```
inconsistent types deduced for parameter $5
```

The API error middleware then sanitizes it to `Internal server error` — which
is exactly what the merchant saw on both buttons (approve and reject share the
same SQL). The same hazard existed in `snooze` (`$3`), the expiry sweep, and
`decidePending` (the Jarvis / AI Command Center decision path).

The existing test suite could not catch this because the API tests run against
the in-memory repository. The fix was verified against a real PostgreSQL
engine (PGlite — genuine PostgreSQL 16 compiled to WebAssembly) with the full
migration chain applied and row-level security enabled, running the actual
Express routes over HTTP.

### Evidence (before the fix, live API + real Postgres)

| Flow | HTTP result |
|---|---|
| `POST /recommendations/:id/approve` | **500** `inconsistent types deduced for parameter $5` |
| `POST /recommendations/:id/reject` (dismiss) | **500** `inconsistent types deduced for parameter $5` |
| `POST /recommendations/:id/snooze` | **500** `inconsistent types deduced for parameter $3` |

## Fix

Every shared parameter in the PostgreSQL repository now carries an explicit
cast in **every** position where it is used, so the planner never has to
deduce conflicting types:

```sql
SET status = $4::text, decided_at = $5::text::timestamptz,
    decided_by = $6::text, reject_reason = $7::text,
payload = payload || jsonb_build_object(
    'status', $4::text, 'decidedAt', $5::text, ...)
```

`::text::timestamptz` keeps the column write identical while the payload keeps
the exact ISO-8601 string the frontend already renders (no format change).

Fixed statements: `decide`, `decidePending` (Jarvis / AI Command Center),
`snooze`, `markExecution`, `expireStale`, and the `undo` cutoff comparison.

## Evidence (after the fix, live API + real Postgres + RLS)

| Flow | HTTP result |
|---|---|
| Approve (SAFE) | **200** — card moved to Approved, version bumped |
| Dismiss / reject | **200** — card moved to Rejected |
| Approve (high-risk) → execute | **200** → **200** EXECUTED |
| Undo (within 30s window) | **200** — back to PENDING |
| Snooze 1h | **200** — `snoozedUntil` persisted |
| Bulk decide (mixed, one stale version) | **200** with per-item `ok/error` (409 per item, never a page-level 500) |
| Expiry sweep (expired PENDING row) | flipped to EXPIRED on summary/list |
| List filters (status/agent/date/sort/pagination) | **200** with correct rows |
| Analyze | **200**, `billing_usage` row written |
| Evidence verify | **200** |
| Calibration samples | written to `ai_calibration_samples` after every decision |

## Additional fixes

1. **Undo route honesty** — undoing a recommendation that does not exist now
   returns `404 NOT_FOUND` instead of the misleading
   `409 The undo window has closed for this recommendation`.
2. **Snooze is now visible** — snoozing a recommendation previously had no
   visible effect on the card (the "Remind me" state existed only in the
   database). Pending cards now show a **"Snoozed · reminds in 2h"** chip, and
   the evidence drawer's decision trail shows "Snoozed until …". Dark and
   light themes both styled. Added `snoozeBadge()` to
   `recommendations-model.ts` with unit tests.

## Regression tests added

- `packages/ai/src/f4-repository.test.ts` — three new tests lock the SQL shape:
  decision, snooze, and expiry sweep statements must cast every shared
  parameter explicitly (`decided_at = $5::text::timestamptz` +
  `'decidedAt', $5::text`). This test fails on the old SQL and would have
  caught the bug at PR time.
- `apps/api/src/pr46-recommendations-api.test.ts` — undo returns 404 for a
  missing recommendation.
- `apps/web/src/recommendations-model.test.ts` — `snoozeBadge()` active,
  expired, invalid, and null cases.

## Verification

- Recommendations suite: **152 passed** (web model 30 · web UI 45 · web
  functional 3 · web workflow 4 · API routes 29 · lifecycle 27 · repository 12
  + regression assertions)
- Repo-wide suite: **2490 / 2491 passed** — the single failure is the
  pre-existing, out-of-scope AI Command Center fixture drift
  (`7 insights today` vs fixture's `6 insights today`), documented in the
  earlier `RECOMMENDATIONS_500_FIX_TEST_REPORT.md`; it is untouched by this PR
  and belongs to the Command Center pass.
- `pnpm -r typecheck` — **passes** (all packages + apps).
- Live Postgres harness (full migration chain, RLS on, real HTTP): every
  recommendation endpoint above exercised and green.
- Design review of the full page: every button/filter/modal exercised —
  tabs, search, sort, group views, agent chips, date filters, refresh, load
  more, bulk approve/skip, card menu (snooze/copy link), evidence drawer +
  SHA verification, approval/reject sheets, undo snackbar, rule modals,
  How it works, analysis progress modal, and the health-check panel. No fake
  data introduced; all copy and both themes preserved.
