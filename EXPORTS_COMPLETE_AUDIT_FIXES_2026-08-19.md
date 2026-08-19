# Data Exports — Complete Audit, Runtime Verification & Hardening

Module: **Exports page (end to end: web UI → API routes → service → data plane → file writers)**
Branch: `arena/01a01a12-profitpilot-ai`
Date: 2026-08-19

A full independent inspection of the Exports page: every plan tier, every dataset,
every error path, and the real bytes of every generated file — CSV, XLSX and PDF —
validated with real parsers, not just shapes.

**Result: the surface was already in good health (94 existing Exports tests green,
full suite green). The audit still found and fixed 2 real defects, added 11 new
tests (all passing), and closed the last untested production code path
(`exports-data.ts` had no test file).**

---

## 1. What was inspected (and found healthy)

| Layer | Check | Outcome |
|---|---|---|
| Build | `pnpm -r build` (all 18 workspaces) | ✅ clean |
| Typecheck | `pnpm -r typecheck` | ✅ clean |
| Tests | full suite | ✅ 2,700 passing (2,689 before this PR + 11 new) |
| Plan gating | Trial / Start / Growth / Commander × Orders / Catalog / Activity / Revenue | ✅ exact 402/201 matrix over real HTTP |
| Monthly allowance | Trial 3, Start 10, Growth/Commander unlimited; blocked/empty exports never count | ✅ verified over real HTTP |
| Custom date range | Growth+ filters rows, lower plans get plain-language 402, inverted range → 400 | ✅ |
| File bytes | XLSX opened with Python `zipfile` + XML parse (hostile chars: quotes, `<`, `>`, `&`, newline, emoji/unicode); CSV parsed with `csv` module (BOM, headers, row counts); PDF xref table + every object offset + multi-page pagination verified byte-by-byte | ✅ all valid |
| Malformed requests | bad JSON (400), array body (400 no crash), empty body (400), unknown dataset (400), `limit=abc/-9/999999` clamped | ✅ no 500s |
| Error envelope | merchant-facing messages everywhere; no stack traces leak; 402 always says "Upgrade Plan" | ✅ |
| No-DB degraded boot | API starts, `/exports/*` answers JSON 404, web page shows its retry panel | ✅ |
| UI wiring | nav → `ExportsWorkspace`, scoped `--dx-*` CSS, both themes, locked states, history list, toasts | ✅ (covered by 472-line UI test, jsdom renders) |
| Concurrency | two downloads racing the last quota slot: one wins, quota meter stays truthful | ✅ documented, accepted |

Live runtime was also exercised through the Vite dev proxy (the exact browser path):
`GET /exports/overview`, all four `POST /exports/:dataset` downloads, and
`GET /exports/history` — all correct with real files landing.

---

## 2. Bugs found and fixed

### BUG 1 — Impossible calendar dates passed validation (real bug)

`normalizeDay()` in `apps/api/src/exports-service.ts` guarded custom date ranges with
a pattern + `Date.parse`. But **`Date.parse('2026-02-30')` does not fail** — V8
normalizes it to March 2nd. A merchant who typed February 30 (or April 31, or
February 29 in a non-leap year) sailed through validation; the string range filter
then matched nothing, and the API answered **404 "There is no orders export data in
the dates you picked. Try a wider date range."** — the wrong problem stated, sending
the merchant hunting for data instead of fixing the typo.

**Fix** — a UTC round-trip check (`isCalendarDay`) rejects non-existent calendar
days while keeping real leap days (2028-02-29 passes). The merchant now gets a clear
400: *"The from date must be a real calendar date in YYYY-MM-DD format."*

Verified live: `from=2026-02-30` → 400 with the new message; `2026-02-29` → 400;
`2028-02-29` (real leap day) → accepted; `2026-08-18` → 201.

### BUG 2 — Malformed request values surfaced as 500 Internal Server Error (hardening)

When a request-supplied value breaks a typed database column — e.g. a hand-edited or
stale `?storeId=` that is not a UUID compared against `export_history.store_id uuid` —
PostgreSQL raises `22P02 invalid_text_representation`, which fell through
`normalizeRequestError` into a merchant-hostile **500 INTERNAL_ERROR** ("Internal
server error"). The value came from the caller; the error is a 400-class client
problem. On the Exports surface this path was reachable on overview, history, and
download (and the same class existed app-wide).

**Fix** — `normalizeRequestError` in `apps/api/src/security.ts` now maps `22P02`
(including via `error.cause` chains) to `400 VALIDATION_ERROR` with plain language:
*"One of the values in this request is not in a valid format. Please check it and
try again."* — same established pattern as the existing `42P01 → 503 SCHEMA_MISSING`
mapping right above it. Server-side logging still records the full internal error,
so nothing becomes undebuggable.

---

## 3. Tests added (11 new, all green)

**`apps/api/src/exports-data.test.ts` (new file, 9 tests)** — the production data
plane behind every download previously had *no* dedicated tests (routes were tested
against stubs). Now pinned:

- orders/revenue mapping into merchant-facing columns, custom-range filtering
  (closed, open-ended), unsynced store returns zero rows,
- catalog title fallback to product id, `EXPORT_ROW_CEILING` hard cap,
- Activity Log: audit table first, fallback to sync records when the audit table is
  missing (42P01) or empty,
- row estimates stay real for healthy datasets when another read fails.

**`apps/api/src/exports-routes.test.ts` (+1 test)** — rejects `2026-02-30`,
`2026-04-31`, `2026-02-29`, `2026-13-05` with the calendar message; keeps real leap
days and normal dates working.

**`apps/api/src/security.test.ts` (+1 test)** — a direct `22P02` and a cause-chained
`22P02` both answer 400 `VALIDATION_ERROR` (never 500), with no internal detail in
the HTTP body.

---

## 4. Considered and deliberately left as-is

- **Quota race on the final slot** (two concurrent downloads can both pass the count
  check): worst case a merchant gets one bonus export. A hard fix needs
  serializable transactions or advisory locks — complexity and new failure modes for
  zero merchant-facing harm. Documented, accepted.
- **CSV formula injection**: Orders/Activity CSVs contain only server-generated
  numbers/dates/system strings; the catalog (merchant titles) ships as XLSX inline
  strings, which Excel never evaluates as formulas. No attacker-controlled data path.
- **Legacy `POST /exports` writer** (automation router): untouched by design, as the
  module docs state.
- **Degraded boot (no DATABASE_URL)** answering JSON 404 for `/exports/*`: the web
  page renders its retry panel; production always boots with a database.

## 5. Verification summary

- `pnpm -r build` ✅ · `pnpm -r typecheck` ✅ · **2,700 tests pass** (214 files) ✅
- 41/42 scenario probes green over real HTTP (the 1 outlier was the probe's own
  range-unaware stub, since replaced by dedicated `exports-data` tests that pin the
  real filtering) ✅
- Real-parser file validation: XLSX zip+XML ✅, CSV parse+BOM ✅, PDF xref offsets +
  multi-page ✅
- Live preview path (Vite proxy → real built API): overview/download/history all
  correct ✅
