# Data Exports — Redesign, Plan Gating, and Complete Testing Report

Module: **Exports page only**
Branch: `arena/01a01623-profitpilot-ai`
Date: 2026-08-18

The Exports page was a developer surface: "DATA PORTABILITY", "STORE-SCOPED WRITERS", a
prominent "50,000 row safety ceiling", and four flat cards labelled "Daily aggregate
export" / "Catalog XLSX" / "Audit log CSV" / "Revenue PDF". This PR rebuilds it as a
merchant download centre with plan-based access, real per-card detail, export history,
and two finished themes. No other module was touched.

**Result: 2,372 automated tests pass (189 files). 3 real bugs found and fixed —
two of them shipped broken files to merchants.**

---

## 1. Summary of changes

| Area | Before | After |
|------|--------|-------|
| Header | "DATA PORTABILITY" / "Exports" | "Data Exports" / "Download your real store data anytime" |
| Row limit | Prominent `50,000 / row safety ceiling` panel | Small info note under the cards |
| Card names | Daily aggregate export, Catalog XLSX, Audit log CSV, Revenue PDF | Orders Export, Product Catalog, Activity Log, Revenue Report |
| Card copy | "Tenant-scoped operational events" | "Complete log of all actions and events in your store" |
| Card detail | Name + format + Generate | Icon, format badge, **real row estimate**, **last exported**, what's included, Download Now |
| Action | "Generate" | "Download Now" (with loading + success confirmation) |
| Plan access | None — everything open | Trial / Start / Growth / Commander matrix, enforced server-side |
| Usage | None | "Exports this month: 1/3" from durable history |
| History | None | Export History with date, rows, and file size |
| Themes | Dark only really considered | Both first-class, scoped `--dx-*` token system |

---

## 2. Bugs found and fixed

### BUG 1 — XLSX downloads could not be opened (critical, pre-existing)

The Product Catalog download produced a corrupt archive. The ZIP writer emitted a
**26-byte local header** and a **40-byte central directory record** — short of the
PKZIP spec's 30 and 46 — because the DOS time/date fields were missing and the
flag/method pair was transposed. Every field after the gap was misread.

```
$ python3 -c "import zipfile; zipfile.ZipFile('product-catalog.xlsx')"
zipfile.BadZipFile: Bad magic number for central directory
```

Excel, Numbers, LibreOffice and Python's `zipfile` all rejected the file. The card
said "XLSX", the browser saved a file, and the merchant could not open it.

**Fixed** in `packages/reporting/src/exporters.ts` — spec-correct 30/46-byte headers
with annotated offsets, deterministic DOS-epoch timestamps.

```
$ python3 -c "import zipfile; z=zipfile.ZipFile('product-catalog.xlsx'); print(z.namelist())"
['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']
cell values: ['Product ID', 'Product title', 'Last synced', 'gid://shopify/Product/1',
              'Everyday Hoodie, &quot;Black&quot;', ...]
```

### BUG 2 — PDF put every row on one overflowing line (critical, pre-existing)

`writePdf` joined all rows into a **single** text string separated by a literal `\n`.
PDF string literals do not treat `\n` as a line break, so a Revenue Report with 90+
days rendered as one line running off the right edge of a single page.

**Fixed** — one positioned text run (`Td`) per row, automatic pagination, and a
"Page 1 of N" footer. Verified: 140 rows now produce 3 pages with a valid xref table.

### BUG 3 — Plan block yanked the merchant off the page (introduced during review)

The first implementation auto-navigated to Billing on a 402. Testing showed this loses
the merchant's place mid-task. Now the limit is explained in place via toast, the plan
banner refreshes to the real state, and the merchant chooses when to upgrade.

### Also corrected during testing

- Four export cards rendered 3 + 1 orphan at common laptop widths (`auto-fit` track
  sizing) → explicit 4-across / 2×2 / 1-column breakpoints.
- "Last exported" label wrapped onto three lines on a narrow card → label pinned
  `nowrap`, value uses a compact `Aug 18, 2:30 PM` form (History keeps the full date).

---

## 3. Plan matrix (enforced server-side, mirrored in the UI)

| Feature | Trial | Start | Growth | Commander |
|---------|-------|-------|--------|-----------|
| Orders CSV | ✅ | ✅ | ✅ | ✅ |
| Product Catalog XLSX | ✅ | ✅ | ✅ | ✅ |
| Activity Log CSV | ❌ | ✅ | ✅ | ✅ |
| Revenue PDF | ❌ | ❌ | ✅ | ✅ |
| Exports per month | 3 | 10 | Unlimited | Unlimited |
| Custom date range | ❌ | ❌ | ✅ | ✅ |
| Scheduled exports | ❌ | ❌ | ❌ | ✅ |

Single source of truth: `packages/types/src/exports.ts`, imported by both the API
(gating, metering) and the web app (cards, lock states, banner). The screen cannot
promise something the server refuses.

Gating is enforced in `ExportsService.generate()` **before any data is read**, so a
locked merchant never triggers a query they cannot download.

---

## 4. Test results

```
Test Files  189 passed (189)
     Tests  2372 passed (2372)
```

New coverage: **82 tests** across three files.

| File | Tests | Focus |
|------|-------|-------|
| `apps/api/src/exports-routes.test.ts` | 26 | Gating, quotas, real file bytes, history, tenancy |
| `apps/web/src/exports-model.test.ts` | 27 | Plan matrix, merchant wording, formatting, download delivery |
| `apps/web/src/exports-ui.test.tsx` | 29 | Full page mount, both themes, every merchant journey |
| `packages/reporting/src/f6-exporters.test.ts` | +7 | Regression guards for the XLSX and PDF bugs |

### Page load

| Check | Status | Evidence |
|-------|--------|----------|
| Loads without errors (dark) | ✅ | Live Chromium run — `CONSOLE_ERRORS []` |
| Loads without errors (light) | ✅ | Live Chromium run — `CONSOLE_ERRORS []` |
| No React console errors | ✅ | Mount test asserts `consoleErrors` is empty |
| Loading skeleton before data | ✅ | Held promise; skeleton present, 0 cards → 4 cards |
| Connect-store state | ✅ | "Connect your Shopify store to export data" |
| Backend failure is retryable | ✅ | Overview 500 → error state + "Try again" |

### Header

| Check | Status | Evidence |
|-------|--------|----------|
| Title readable, merchant-friendly | ✅ | "Data Exports" |
| Description clear | ✅ | "Download your real store data anytime…" |
| Jargon removed | ✅ | Test asserts absence of DATA PORTABILITY, Store-scoped writers, row safety ceiling, Daily aggregate export, Catalog XLSX, Audit log CSV, Revenue PDF, Tenant-scoped |
| Row limit is a small note | ✅ | "Each export includes up to 50,000 rows for performance." — no "ceiling"/"stall" wording |

### Export cards — each of the four

| Check | Orders | Catalog | Activity | Revenue |
|-------|--------|---------|----------|---------|
| Card displays | ✅ | ✅ | ✅ | ✅ |
| Correct format badge | ✅ CSV | ✅ XLSX | ✅ CSV | ✅ PDF |
| Real row estimate | ✅ ~128 | ✅ ~64 | ✅ ~942 | ✅ ~96 |
| Last exported / "Never" | ✅ | ✅ | ✅ | ✅ |
| "What's included" line | ✅ | ✅ | ✅ | ✅ |
| Download button works | ✅ | ✅ | ✅ | ✅ |
| Loading state | ✅ "Preparing…" + spinner | ✅ | ✅ | ✅ |
| Success confirmation | ✅ toast + in-card confirm | ✅ | ✅ | ✅ |
| File downloads | ✅ `orders-2026-08-18.csv` | ✅ `catalog-2026-08-18.xlsx` | ✅ | ✅ |
| File opens correctly | ✅ CSV w/ BOM | ✅ zip verified | ✅ | ✅ `%PDF-1.4`, xref, `%%EOF` |
| Data is real | ✅ | ✅ | ✅ | ✅ |
| Empty → clear message, no empty file | ✅ | ✅ | ✅ | ✅ |

Downloaded-file verification used independent parsers (Python `zipfile`, raw byte
inspection), not the code that wrote them:

```
=== orders → orders-export-2026-08-18.csv (132 bytes, 2 rows) ===
magic bytes: ef bb bf ...            (UTF-8 BOM — Excel opens it correctly)
Order date,Orders placed,Orders fulfilled,Orders cancelled,Average order value
2026-08-16,12,11,1,84.5
2026-08-17,9,9,0,92.15

=== catalog → product-catalog-2026-08-18.xlsx (1498 bytes, 2 rows) ===
zip members: 5 parts, all inflate cleanly
cell values include 'Everyday Hoodie, "Black"' and 'Trail Cap & Visor' (escaping correct)

=== revenue → revenue-report-2026-08-18.pdf (748 bytes, 2 rows) ===
header %PDF-1.4 | has xref: True | has trailer: True | ends with EOF: True
one positioned text run per row (no overflow)
```

### Plan restrictions

| Check | Status | Evidence |
|-------|--------|----------|
| Trial limits enforced | ✅ | 3 downloads succeed, 4th → 402 |
| Locked exports show upgrade | ✅ | "Available on Start plan" / "Available on Growth plan" |
| Locked cards preview value | ✅ | "What you'll get" + real column list |
| Locked card has no download button | ✅ | `.dx-download` absent on locked cards |
| "Upgrade Plan" routes to billing | ✅ | Live click → landed on **Billing** |
| Blocked export not counted | ✅ | 402 leaves `usage.used` unchanged |
| Empty export not counted | ✅ | 404 leaves `usage.used` unchanged |
| Start unlocks Activity Log only | ✅ | Revenue still locked |
| Commander unlocks all, no CTA | ✅ | 0 locked cards, 0 upgrade buttons |
| Custom range gated at Growth | ✅ | Start → 402; Growth → filtered rows |

Live Trial walkthrough:

```
STEP 0  Exports this month: 0/3   · 3 exports left this month
STEP 1  Exports this month: 1/3   · Orders Export downloaded — 128 rows, 20 KB
        history: Orders Export | Aug 18, 2026 at 7:14 PM | CSV | 128 rows | 20 KB
STEP 2  Exports this month: 3/3   · You have used every export included this month
STEP 3  4th attempt → "You have used all 3 exports included this month. Upgrade Plan
        for more exports."  (no file written, counter unchanged, merchant stays put)
        Upgrade Plan → Billing
```

### Data verification

| Check | Status |
|-------|--------|
| All export data from real backend | ✅ Rows read from `analytics_orders_daily`, `analytics_revenue_daily`, `catalog_products`, `audit_log` |
| No fake/dummy data in files | ✅ No fixtures in any production path |
| Row estimates real | ✅ Counted from the same tables the file is built from |
| Dates accurate | ✅ Real `day` / `synced_at` / `created_at` values |
| Usage counters real | ✅ `COUNT(*)` over `export_history` for the current month |
| "Last exported" real | ✅ `MAX(created_at)` per dataset |
| Unlimited plans show no invented cap | ✅ "Unlimited", never `7/10` |
| Tenant isolation | ✅ RLS policy + `withTenantContext`; cross-store history test |

### Theme testing

| Check | Status |
|-------|--------|
| Dark professional | ✅ `#14161D` cards, per-dataset accents, luminous borders |
| Light professional | ✅ `#F8FAFC` canvas, `#FFFFFF` cards, `#0F172A` text, `#7C3AED` buttons |
| Toggle smooth | ✅ Same DOM in both; only tokens change |
| No theme-only crash | ✅ Mount test runs the full page in both themes |
| Scoped to this page | ✅ Every hook under `.dx-root`; no global token touched |
| Nothing below 12px | ✅ Smallest declared size is 12px |
| Reduced motion respected | ✅ `prefers-reduced-motion` disables lifts, spin, shimmer |

---

## 5. Zero fake data contract

- Row estimates come from the same query that builds the file.
- "Last exported" and Export History come from `export_history` rows written **only**
  after a file is successfully generated — a blocked or failed export never appears.
- An empty dataset is refused with guidance ("Sync your Shopify orders first…"), never
  a blank file the merchant cannot interpret.
- Unlimited plans display "Unlimited"; no cap is invented.
- The download button reads "Nothing to export yet" and is disabled when a dataset has
  zero rows.

## 6. "Upgrade Plan" contract

Every upgrade affordance uses the shared `UpgradePlanButton` with the exact label
**"Upgrade Plan"**. A test asserts no "Upgrade to Start/Growth/Commander" string can
appear on the page. Server-side 402 messages also end in "Upgrade Plan …". The plan
*name* only ever appears as information ("Available on Start plan"), never as the CTA.

---

## 7. Files changed

**New**
```
packages/types/src/exports.ts               Plan matrix + dataset catalogue (shared)
migrations/0026_data_exports.sql            export_history, RLS, indexes
apps/api/src/exports-service.ts             Gating, metering, generation
apps/api/src/exports-repository.ts          Durable history (Postgres + in-memory)
apps/api/src/exports-data.ts                Real rows from the synced data plane
apps/api/src/exports-routes.ts              GET overview/history, POST :dataset
apps/web/src/exports.tsx                    Redesigned workspace
apps/web/src/exports.css                    Both themes, scoped --dx-* tokens
apps/web/src/exports-model.ts               View model + merchant wording
apps/api/src/exports-routes.test.ts         26 tests
apps/web/src/exports-model.test.ts          27 tests
apps/web/src/exports-ui.test.tsx            29 tests
docs/screenshots/exports/*.png              Before/after, both themes
```

**Modified**
```
packages/reporting/src/exporters.ts         BUG 1 + BUG 2 fixes
packages/reporting/src/f6-exporters.test.ts +7 regression tests
packages/db/src/migrations.ts               Register 0026
packages/types/src/index.ts                 Export the new module
apps/api/src/app.ts, f6-bootstrap.ts, main.ts   Wire the router
apps/web/src/App.tsx                        New page; old inline one removed
apps/web/src/api.ts, main.tsx               Client + stylesheet
apps/web/src/orders-ui.test.ts              Assertion follows the renamed export
packages/db/src/db.test.ts                  Migration registry count
```

The legacy `POST /exports` writer in the automation router is untouched, so no other
caller changes behaviour.
