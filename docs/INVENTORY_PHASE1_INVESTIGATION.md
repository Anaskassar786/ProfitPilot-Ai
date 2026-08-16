# Inventory page — Phase 1 investigation and design proposal

**Status:** investigation only. No implementation code written. Awaiting approval before Phase 2.
**Date:** 2026-08-16
**Branch:** `arena/01a00a18-profitpilot-ai`
**Baseline commit:** `f09d6e1` (merge of PR #31)

---

## A) Root cause of the empty page + comparison with PR #26 / PR #29

### A.1 Where the page is rendered

| Concern | Location | State |
| --- | --- | --- |
| Sidebar entry | `apps/web/src/App.tsx:104` — `{ id: 'inventory', label: 'Inventory', icon: Box }` | ✅ exists |
| Page metadata | `apps/web/src/App.tsx:136` | ✅ exists, no jargon |
| PageRouter branch | `apps/web/src/App.tsx:410` — `if (active === 'inventory') return <InventoryPage … />` | ✅ **exists** (this is *not* the bug) |
| Component | `apps/web/src/App.tsx:458` — single-line `InventoryPage(...)` | ❌ **hardcoded placeholder** |
| Dedicated module | `apps/web/src/inventory.tsx` | ❌ does not exist |
| View model | `apps/web/src/inventory-model.ts` | ❌ does not exist |
| Stylesheet | `apps/web/src/inventory.css` | ❌ does not exist (styles live in `styles.css` as `.inventory-hero`) |
| API client fns | `apps/web/src/api.ts` | ❌ no inventory functions |

### A.2 The actual defect

`InventoryPage` receives only `data.analytics` (an `AnalyticsSnapshot`, built from **orders**, not inventory). Every inventory number in the component is a **literal**:

```tsx
<MiniMetric label="Units in stock" value="—" sub="Awaiting inventory sync" />
<MiniMetric label="Days of cover"  value="—" sub="Deterministic F2 input" />
<MiniMetric label="Stockout risk"  value="—" sub="No claim without rows" />
<MiniMetric label="Dead stock"     value="—" sub="F4 decision rule later" />
```

There is no data path that could ever change them. The `EmptyState` is likewise unconditional.

**The "100/100" score is a different data source entirely.** The page renders
`<HealthGauge health={storeHealthView(snapshot)} />`. `storeHealthView`
(`apps/web/src/model.ts:97`) is the *store* health heuristic scored from revenue,
orders, product-sales rows and cohort rows — `35 + 25 + 20 + 10 + 10 = 100`. It
contains **zero inventory input**. Showing it on the Inventory page is
misleading and must be replaced with a real Inventory Health Score.

### A.3 Why "Sync inventory" appears to do nothing

The button **does work end to end on the backend**:

1. `onSync('inventory')` → `requestSync(storeId, 'inventory')` → `POST /sync`.
2. `apps/api/src/data-plane-routes.ts` validates `'inventory'` against `SYNC_MODULES` ✅.
3. `packages/sync/src/shopify-source.ts` `fetchInventory()` calls
   `GET /locations.json?limit=250`, then
   `GET /inventory_levels.json?limit=250&location_ids=…` ✅.
4. `packages/sync/src/postgres-sink.ts` upserts each level into
   `sync_records (store_id, module='inventory', record_id, payload)` with a
   composed `record_id` of `"{location_id}:{inventory_item_id}"` ✅.

5. **Then `App.tsx` `sync()` calls `loadData()`, which refetches only
   `/analytics`, `/catalog`, `/ai/agents`, `/recommendations`.** None of those
   read `module='inventory'`. `PostgresSyncSink.complete()` also early-returns
   for anything that is not `'orders'`.

So rows land in Postgres and nothing on the client is able to see them. The
toast says "inventory synced from Shopify" and the page stays empty — a
**silent success**, which is the worst variant of this bug class.

### A.4 The identical architectural gap from PR #26 / #29

| Wiring step | Orders (fixed in #26) | Customers (fixed in #29) | Inventory (today) |
| --- | --- | --- | --- |
| Express router file | `apps/api/src/order-routes.ts` | `apps/api/src/customer-routes.ts` | ❌ missing |
| Domain/service module | `orders.ts` | `customers.ts` + `customer-insights.ts` | ❌ missing |
| Wired in `app.ts` | `if (dependencies.orders) app.use(createOrderRouter(...))` | same for customers | ❌ missing |
| Constructed in `f8-bootstrap.ts` | ✅ | ✅ | ❌ missing |
| Added to `API_PATH_PREFIXES` (`apps/api/src/web-app.ts:7`) | `'/orders'` added in #26 | `'/customers'` added in #29 | ❌ **`/inventory` absent** |
| Added to Vite dev proxy (`apps/web/vite.config.ts`) | `'/orders'` present | `'/customers'` added in #29 | ❌ **`/inventory` absent** |
| Frontend workspace + model + css | ✅ | ✅ | ❌ missing |
| CSS imported in `main.tsx` | ✅ `./orders.css` | ✅ `./customers.css` | ❌ missing |

**Answer to "is this the same bug?" — Yes, plus one extra layer.** Orders and
Customers were missing the *entire* read path. Inventory is missing the same
read path **and** the placeholder component actively lies (hardcoded dashes +
an unrelated 100/100 gauge + internal phase jargon).

Consequence if the two routing lines are forgotten in Phase 2: `GET /inventory`
would fall through `isApiPath()` into the SPA fallback and return `index.html`
with a 200 — the client would then throw `INVALID_ENVELOPE`. Both lines are
mandatory.

---

## B) Complete inventory of real Shopify data available today

### B.1 Product / variant level — `catalog_products.payload` (and `sync_records module='products'`)

Confirmed present and already read by the Products page
(`apps/web/src/products-model.ts` `productStockView`, `productPriceView`).

| Field | Path | Notes |
| --- | --- | --- |
| Variant id | `payload.variants[].id` | table row key |
| SKU | `payload.variants[].sku` | may be `""` |
| Variant title | `payload.variants[].title` | e.g. "Black / L" |
| Price | `payload.variants[].price` | string decimal |
| Compare-at price | `payload.variants[].compare_at_price` | optional |
| **On-hand qty** | `payload.variants[].inventory_quantity` | ✅ **already available for all 18 products — this alone unblocks Rows 1, 2, 5** |
| **Join key** | `payload.variants[].inventory_item_id` | ✅ the only way to join to `inventory_levels` |
| Tracking flag | `payload.variants[].inventory_management` | `'shopify'` \| `null` → untracked variants must be excluded from stockout maths |
| Oversell policy | `payload.variants[].inventory_policy` | `'deny'` \| `'continue'` |
| Weight / shipping | `payload.variants[].weight`, `.requires_shipping` | available, low value here |
| Product title | `payload.title` | |
| Category | `payload.product_type` | ✅ Row 5 "Category" column |
| Vendor | `payload.vendor` | useful extra filter |
| Status | `payload.status` | `active`/`draft`/`archived` |
| Image | `payload.image.src` / `payload.images[].src` | ✅ thumbnail; reuse `productImageUrl()` |

### B.2 Location level — `sync_records` where `module='inventory'`

Written by the existing sync. Row shape:

```
record_id = "{location_id}:{inventory_item_id}"
payload   = { inventory_item_id, location_id, available, updated_at, admin_graphql_api_id }
```

✅ Real per-location `available` quantity and a real `updated_at`.

### B.3 Location **metadata** — ⚠️ **NOT PERSISTED (gap)**

`ShopifyRestSyncSource.locationIds()` (`packages/sync/src/shopify-source.ts:112`)
calls `/locations.json?limit=250` but **only extracts `id`** and throws away
`name`, `address`, `active`, `legacy`. There is no `locations` sync module and
no table.

Impact: we can show *"Location 71234567"* but not *"Warehouse — Brooklyn"*.

Two options for Phase 2 (both small):

* **Option L1 (recommended, minimal):** in `fetchInventory()`, emit the location
  records into the same `'inventory'` page with `record_id = "location:{id}"`
  and a `record_kind: 'location'` marker. Zero schema change, zero new module,
  zero change to `/sync/all`. Readers filter on the prefix.
* **Option L2:** add a 9th `SYNC_MODULES` entry `'locations'`. Cleaner
  semantically but changes the sync-all loop, the dashboard's 8-module progress
  strip, and several tests. More blast radius than the feature deserves.

### B.4 Sales history for velocity — two sources, with an important nuance

| Source | Grain | Usable for |
| --- | --- | --- |
| `analytics_product_sales_daily` (`day, product_id, units_sold, gross_revenue`) | **product**-level, daily | product-level velocity, top seller, dead stock at product grain |
| `sync_records module='orders'` → `payload.line_items[]` (`variant_id`, `product_id`, `quantity`, `price`) | **variant**-level, per order | ✅ **variant-level velocity, days of cover, and co-purchase pairs** |

⚠️ **Correction to the brief:** `analytics_product_sales_daily` is a daily
aggregate keyed by `product_id` only. It **cannot** produce bundle /
co-purchase pairs (co-occurrence needs order-level baskets) and it cannot give
variant-level cover. Both must come from order `line_items`. `orders.ts`
already reads exactly these rows, so the pattern is proven.

### B.5 ⚠️ CRITICAL data-volume finding

PR #26's own notes record that this merchant has **two real order rows**. Every
velocity-derived feature (days of cover, dead stock, reorder point, overstock,
turnover, predictive restocking, seasonality, bundles) is therefore going to
return **"insufficient data"** for this store right now, honestly and by
design. The `orders.ts` precedent already guards this with a
`sufficientData = orders.length >= 5` gate and an `insufficient_data` payload.

**Design consequence:** the page must be *useful with zero sales history*. That
is why Rows 1, 2, 5 (SKUs, units, low stock, out of stock, value, health,
distribution, table) are built purely from `inventory_quantity` and are
guaranteed to render real numbers for all 18 products immediately. Velocity
features degrade to an explicit, non-fake `insufficient_data` state. **No
estimated or placeholder velocity anywhere.**

---

## C) Current sync module status

| Question | Answer |
| --- | --- |
| Is the inventory sync module implemented? | ✅ Yes — `ShopifyRestSyncSource.fetchInventory()` |
| Does it fetch `/inventory_levels.json`? | ✅ Yes, paginated via `Link: rel="next"` `page_info` |
| Does it fetch `/locations.json`? | ✅ Yes, but only to harvest ids (see B.3) |
| Where is data stored? | ✅ `sync_records` with `module='inventory'`, RLS-isolated by `store_id` |
| Does the "Sync inventory" button work backend-side? | ✅ Yes |
| Any silent failures? | ✅ **Yes — four** (below) |

**Silent failure 1 — the read path (primary bug).** Sync succeeds, nothing
re-reads it, page still empty. Fix = the new endpoint + page.

**Silent failure 2 — no locations, no error.** If `/locations.json` returns
`{ locations: [] }`, `fetchInventory` returns `{ records: [], nextCursor: null }`
→ pages 1, records 0, checkpoint complete, green toast, zero rows. Should be
surfaced as a coverage note, not a success.

**Silent failure 3 — the 50-location cap.** `locationIds.slice(0, 50)` silently
drops locations 51+. Harmless for this merchant; must be documented.

**Silent failure 4 — untracked variants.** Variants with
`inventory_management: null` never appear in `inventory_levels` at all. Without
excluding them, "out of stock" counts will be wrong. They must be classified as
**"Not tracked"**, not as "Out of stock".

**Not a silent failure:** a 403/401 from Shopify *is* converted to a clear
`DEPENDENCY_ERROR` ("Reinstall the app so it can request the required access
scopes") and reaches the merchant as an error toast.

---

## C.2 Scopes

| Scope | Declared where | Verdict |
| --- | --- | --- |
| `read_products` | `.env.example:13`, `app-store-assets.ts:23` default | ✅ |
| `read_inventory` | `.env.example:13`, `app-store-assets.ts:23` default | ✅ declared |
| `read_locations` | `.env.example:13`, `app-store-assets.ts:23` default | ✅ declared |

⚠️ One caveat: `docs/app-store/shopify.app.toml.template` still hardcodes only
`scopes = "read_products,read_orders,read_customers"`. The *generated* toml from
env is correct, but the checked-in template is stale. Also, **granted** scopes
are fixed at install time — if this store was installed before the inventory
scopes were added, inventory sync will 403 until reinstall. Recommend verifying
via the existing `GET /sync/status` + one manual `POST /sync {module:'inventory'}`
before Phase 2 UI work is judged. No new scopes are required by this proposal.

---

## D) Historical inventory data — recommendation

**Confirmed:** Shopify exposes **no** historical inventory endpoint. The Admin
API (REST *and* GraphQL) returns only the current state; Shopify support's own
guidance is to listen to `inventory_levels/update` and maintain your own
ledger. Any "stock over time" chart therefore requires us to record history.

| Option | Effort | Verdict |
| --- | --- | --- |
| (a) Nightly cron → snapshot table | needs a per-store scheduler the worker does not have today (`apps/worker/src/main.ts` runs a generic hourly tick with no store enumeration) | ⚠️ more infra than it looks |
| (b) Skip historical charts | zero | acceptable fallback, but drops an approved Row 4 |
| (c) Delta-only from webhooks | `inventory_levels/update` is already in `SHOPIFY_WEBHOOK_TOPICS`, but no handler is registered and webhook delivery is not guaranteed | ⚠️ future, not now |

### ✅ Recommendation — **(a′) snapshot on sync completion**

Add one migration:

```sql
CREATE TABLE inventory_snapshots_daily (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day date NOT NULL,
  total_units integer NOT NULL,
  total_value numeric(20,4),
  currency text,
  sku_count integer NOT NULL,
  in_stock_count integer NOT NULL,
  low_stock_count integer NOT NULL,
  out_of_stock_count integer NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, day)   -- last write of a day wins; idempotent re-sync
);
-- + ENABLE ROW LEVEL SECURITY + tenant_isolation policy, matching 0005
```

Written from `PostgresSyncSink.complete(storeId, 'inventory')`, which already
exists as the "run once after all pages persisted" hook and is currently a
no-op for every module except `orders`. **No cron, no worker changes, no new
scheduler.** History accrues from the day Phase 2 ships.

Row 4 then renders honestly: with `< 2` snapshot days it shows *"Stock history
starts building from your first sync — check back tomorrow"*, never a fabricated
back-fill. Day/Week/Month/Quarter/Year toggles bucket whatever real days exist.

Delta-based history (c) stays on the roadmap as a later enhancement once a
webhook handler exists; it is explicitly **out of scope for Phase 2**.

---

## E) Multi-location handling

1. Detect at query time: `SELECT COUNT(DISTINCT payload->>'location_id')` over
   `sync_records module='inventory'`.
2. **Single location (expected for this merchant):** the Location column and the
   location filter are **not rendered at all**. No empty column, no "N/A".
3. **Multiple locations:** default view is the **aggregate** (sum of `available`
   across locations per variant); a `Location: All ▾` selector in the toolbar
   filters to one location; the detail drawer always shows the per-location
   breakdown table.
4. Location **names** require Option L1 from §B.3. Until then, and if a name is
   ever missing, the UI shows the raw location id rather than inventing a label.
5. The response always carries `locations: []` + `multiLocation: boolean` so the
   frontend never has to guess.

---

## F) Mapping table — reference design → real data

| Reference feature | Real data? | Real alternative / decision |
| --- | --- | --- |
| Total Items in Stock | ✅ | Σ `variants[].inventory_quantity` over tracked variants |
| Total SKUs | ✅ | count of variants (tracked + untracked, labelled) |
| Low Stock Alerts | ✅ | count where `0 < qty < threshold` (default 10, configurable) |
| Items Out of Stock | ✅ | count where `qty <= 0` **and** `inventory_management = 'shopify'` |
| Inventory Overview list | ✅ | real variant table from catalog + levels |
| Total inventory value | ✅ | Σ `qty × variant.price`; currency from most recent order, else units-only |
| Min / Avg / Max stock | ✅ | computed from current per-variant quantities |
| Inventory Health Score | ✅ | new real formula (§J.7), replaces the misleading store gauge |
| Reorder point | ✅ | derived (§J.2); merchant-configurable lead time later |
| Analytic view chart (stock over time) | ⚠️ | requires `inventory_snapshots_daily` (§D); honest "building history" state until then |
| Heatmap (monthly) | ⚠️ | same dependency — **defer past Phase 2** |
| Inventory history (item detail) | ⚠️ | Phase 2 shows real `inventory_levels.updated_at` "last changed" per location; a true movement ledger needs webhooks |
| Recent Activities | ⚠️ | best real proxy = variants ordered by `updated_at` desc from `inventory_levels`; label it "Recently updated", not "Movements" |
| Recent Movements (deltas) | ❌ Phase 2 | needs the snapshot/webhook ledger — **defer** |
| Map view | ❌ | REMOVE |
| Buyer info + chat/call | ❌ | REMOVE |
| Suppliers | ❌ | REMOVE |
| Warehouse / Retail / Fulfillment breakdown | ❌ | REMOVE — Shopify has locations, not categories |
| Purchase order creation | ❌ | REMOVE |
| Barcode scanning | ❌ | REMOVE |

---

## G) Proposed layout with plan gating

All sections dark-theme, using existing `--card`, `--border-soft`, `--blue`,
`--green`, `--amber`, `--red`, `--purple` tokens. Responsive breakpoints match
`orders.css` / `customers.css` (4→2→1 column collapse at 1100px / 640px).

**Row 1 — KPI cards (all plans, always real)**
`Total SKUs` · `Total Units in Stock` · `Low Stock Alerts` · `Out of Stock`
Each with a real sub-line (e.g. "across 18 products", "below 10 units").

**Row 2 — Health + analytics (all plans)**
Left: **Inventory Health Score** gauge (real formula §J.7, grade A+…D).
Middle: **Stock Distribution** donut — Healthy / Low / Out / Not tracked.
Right: **Inventory Value** + top 5 items by value.

**Row 3 — AI Inventory Intelligence (collapsible, plan-gated)**
* All plans: Top Selling Item · Items Needing Attention · Inventory Health Grade
* Growth+ 🔒: Dead Stock Detector · Reorder Recommendations · Stock Turnover ·
  Overstock Alerts · AI Natural-Language Suggestion
* Commander 🔒: Predictive Restocking · Seasonal Trends · Auto-Reorder
  Suggestions · Custom AI Queries · Bundle Recommendations

Locked tiles reuse the existing masked `PlanLockedFeature` card (blurred
skeleton + lock + "Upgrade to Growth/Commander to unlock"), rendered
**individually per feature** — that is the refinement PR #30/#31 made to
Customers, and we adopt it from day one rather than one big locked block.

**Row 4 — Inventory Analytics Chart (Growth+ 🔒)**
Line/bar of `total_units` (and value) over time from `inventory_snapshots_daily`,
Day/Week/Month/Quarter/Year toggle, honest "history is building" empty state.

**Row 5 — Inventory Table (all plans)**
☐ (bulk = Growth+) · thumbnail · product + variant + SKU · category ·
stock level (green/amber/red) · location (multi-location only) ·
days of cover (Growth+ 🔒) · value · status badge · ⋯ actions.
Server-side search, filters (status / category / vendor / location), sort,
pagination — the exact `filterOrders`/`parseOrderFilters` pattern.

**Row 6 — Recently Updated (all plans, optional)**
Real `inventory_levels.updated_at` ordering. Renders only when ≥1 row has a
usable timestamp. Labelled "Recently updated" — no fake deltas.

**Jargon removal:** every `F2`/`F4` string is confined to the one placeholder
line `App.tsx:458`, which is deleted wholesale. Verified by grep that no other
inventory-facing string contains a phase code.

---

## H) New components needed

`apps/web/src/inventory.tsx`
* `InventoryWorkspace` (top-level, owns fetch/filter state)
* `InventoryStatsGrid` → `InventoryStatCard`
* `InventoryHealthCard` (gauge)
* `StockDistributionChart` (recharts `PieChart`)
* `InventoryValueCard` (+ top-value list)
* `AIInventoryInsightsCard` (collapsible) → `InventoryInsightSlot`, `CommanderCapability`
* `InventoryAnalyticsChart` (recharts `AreaChart`/`BarChart` + period toggle)
* `InventoryToolbar` (search, dropdowns, export, location selector)
* `InventoryTable` → `InventoryRow`
* `StockLevelBadge`, `InventoryThumbnail` (mirrors `ProductThumbnail`)
* `InventoryDetailDrawer` (variant detail + per-location breakdown)
* `RecentlyUpdatedTable`
* `InventoryEmptyState`, `InventorySkeleton`, `InventoryErrorState`

**Reused as-is, not re-implemented:** `PlanLockedFeature` (exported from
`apps/web/src/orders.tsx`), `PageLayout`, `HealthGauge` pattern, recharts,
`lucide-react`, `productImageUrl()` from `products-model.ts`.

`apps/web/src/inventory-model.ts` — types mirroring the API contract + pure
helpers (`stockTone`, `insightByFeature`, `lockedInsightByFeature`,
`inventoryMoney`, `daysOfCoverLabel`) with unit tests, same as
`orders-model.ts` / `customers-model.ts`.

`apps/web/src/inventory.css` — imported from `main.tsx`.

**Wiring (the part that must not be missed):**
1. `App.tsx` — delete `InventoryPage` (line 458), import `InventoryWorkspace`,
   replace the router branch at line 410.
2. `apps/web/src/api.ts` — 5 new client functions.
3. `apps/web/src/main.tsx` — `import './inventory.css'`.
4. `apps/api/src/web-app.ts` — add `'/inventory'` to `API_PATH_PREFIXES`.
5. `apps/web/vite.config.ts` — add `'/inventory': 'http://127.0.0.1:3000'`.

Untouched: Jarvis, sidebar, dashboard, products, orders, customers, billing,
entitlement definitions.

---

## I) Backend endpoints required

New files `apps/api/src/inventory.ts` (domain + repository + filters),
`apps/api/src/inventory-insights.ts` (plan-gated intelligence),
`apps/api/src/inventory-routes.ts` (Express). Constructed in `f8-bootstrap.ts`,
mounted in `app.ts` behind `if (dependencies.inventory)`.
All reads go through `withTenantContext(executor, storeId, …)`.

### `GET /inventory`
Query: `storeId` (required), `q`, `status=in_stock|low|out|untracked`,
`category`, `vendor`, `locationId`, `sort=name|stock|value|category|updated`,
`direction`, `page`, `limit` (≤100, default 20), `lowStockThreshold` (default 10).

```jsonc
{ "ok": true, "data": {
  "plan": "trial",
  "items": [{
    "variantId": "44…", "productId": "84…", "inventoryItemId": "49…",
    "title": "Commander Pilot Mug", "variantTitle": "Default Title",
    "sku": "MUG-01", "category": "Drinkware", "vendor": "ProfitPilot",
    "imageUrl": "https://cdn.shopify.com/…",
    "price": 24.0, "currency": "USD",
    "quantity": 6, "tracked": true, "inventoryPolicy": "deny",
    "status": "low",                       // in_stock | low | out | untracked
    "value": 144.0,
    "locations": [{ "locationId": "71…", "locationName": null, "available": 6,
                    "updatedAt": "2026-08-15T10:02:11Z" }],
    "daysOfCover": null,                   // null when locked OR insufficient data
    "daysOfCoverState": "locked"           // available | insufficient_data | locked
  }],
  "stats": { "totalSkus": 24, "trackedSkus": 22, "totalUnits": 318,
             "lowStockCount": 3, "outOfStockCount": 1, "untrackedCount": 2,
             "totalValue": 7420.0, "currency": "USD",
             "minStock": 0, "avgStock": 14.5, "maxStock": 96 },
  "distribution": { "healthy": 18, "low": 3, "out": 1, "untracked": 2 },
  "tabCounts": { "all": 24, "in_stock": 18, "low": 3, "out": 1, "untracked": 2 },
  "locations": [{ "id": "71…", "name": null, "active": true }],
  "multiLocation": false,
  "coverage": { "inventorySyncCompleted": true, "lastSyncedAt": "…",
                "levelRowCount": 22, "quantitySource": "inventory_levels",
                "explanation": "…" },
  "pagination": { "page": 1, "limit": 20, "total": 24, "pages": 2 }
}, "meta": { "requestId": "…" } }
```

`quantitySource` is `"inventory_levels"` when level rows joined, or
`"variant_inventory_quantity"` when falling back to the catalog field — the
merchant is told which, never silently mixed.

### `GET /inventory/:variantId`
Variant detail: full per-location breakdown, price/value, policy, tracking,
`updatedAt` per location, and (Growth+) velocity + cover. `404 NOT_FOUND` when
absent. Registered **after** `/inventory/insights` and `/inventory/locations` so
those literals are never parsed as a variant id (the ordering bug #26 called out
explicitly).

### `GET /inventory/insights`
Query: `storeId`, optional `feature`.

```jsonc
{ "ok": true, "data": {
  "plan": "growth", "planLabel": "Growth", "planBadge": "Growth insights unlocked",
  "skuCount": 24, "orderCount": 2, "sufficientData": false,
  "available": [ { "feature": "top_selling_item", "name": "Top Selling Item",
                   "data": { "status": "available", "variantId": "…", "title": "…",
                             "unitsSold": 3, "windowDays": 90 } },
                 { "feature": "dead_stock", "name": "Dead Stock Detector",
                   "data": { "status": "insufficient_data", "minimumOrders": 5,
                             "message": "Dead stock detection needs more order history." } } ],
  "locked": [ { "locked": true, "feature": "predictive_restocking",
                "name": "Predictive Restocking", "required_plan": "commander" } ],
  "usage": { "feature": "inventory_ai_insights_day", "used": 3, "limit": 20,
             "remaining": 17, "limitReached": false },
  "cached": false
} }
```

Requesting a locked `feature` explicitly → `403` with
`details: { locked: true, feature, required_plan }` (the
`OrderInsightLockedError` shape).

### `POST /inventory/insights/query` — Commander only
Body `{ storeId, question }` (≤500 chars). Same envelope as above with a single
`custom_ai_queries` entry. `403` for Growth and below, **before** any data is
read or any token is spent.

### `GET /inventory/locations`
`{ locations: [{ id, name, active, itemCount, totalUnits }], multiLocation }`.
Returns `[]` cleanly when metadata is not yet persisted.

### `GET /inventory/history` — Growth+ 🔒
Query: `storeId`, `period=day|week|month|quarter|year`.
`{ points: [{ day, totalUnits, totalValue, outOfStockCount }], currency, source: "inventory_snapshots_daily", daysTracked: 1, sufficientHistory: false }`.
`403` below Growth.

---

## J) AI insight deterministic logic

Shared definitions, all from real rows only:

```
qty(v)             = variant on-hand (Σ inventory_levels.available, else inventory_quantity)
tracked(v)         = v.inventory_management === 'shopify'
price(v)           = Number(v.price)  (null → excluded from value maths)
value(v)           = qty(v) * price(v)
soldUnits(v, D)    = Σ line_items.quantity for v.id over non-cancelled,
                     non-refunded orders in the last D days   [sync_records module='orders']
velocity(v, D)     = soldUnits(v, D) / D            // units/day
LEAD_TIME_DAYS     = 14 (constant in Phase 2; per-product override is future work)
MIN_ORDERS         = 5   // shared sufficiency gate, mirrors orders.ts
MIN_WINDOW_DAYS    = 30  // need at least this much order history for velocity
LOW_STOCK_DEFAULT  = 10
```

Every formula below returns `{ status: 'insufficient_data', … }` — never a
guess — when `orderCount < MIN_ORDERS` or the order window is shorter than
`MIN_WINDOW_DAYS`.

**J.1 Dead Stock Detector** (Growth+)
`dead(v, D) = tracked(v) && qty(v) > 0 && soldUnits(v, D) === 0`, for
`D ∈ {30, 60, 90}` (only windows fully covered by real order history are
reported). Output per bucket: item list, unit count, `Σ value(v)` = cash tied
up, and `daysSinceLastSale` from the newest matching line item (`null` if the
item has never sold, reported as *"no recorded sale in the synced window"* —
not as "never sold ever").

**J.2 Reorder Recommendations** (Growth+)
```
reorderPoint(v)   = velocity(v,30) * LEAD_TIME_DAYS
needsReorder(v)   = tracked(v) && velocity(v,30) > 0 && qty(v) <= reorderPoint(v)
suggestedQty(v)   = ceil(velocity(v,30) * (LEAD_TIME_DAYS + 30)) - qty(v)   // to a 30-day buffer
urgency(v)        = qty(v) <= 0 ? 'critical'
                  : daysOfCover(v) <= LEAD_TIME_DAYS/2 ? 'high' : 'medium'
```
Every recommendation carries its evidence (`velocity`, `qty`, `leadTimeDays`) so
it is auditable, and states that lead time is the 14-day default.

**J.3 Overstock Alerts** (Growth+)
`overstocked(v) = tracked(v) && velocity(v,90) > 0 && qty(v) > velocity(v,90) * 90`
Report `excessUnits = qty(v) - ceil(velocity*90)` and
`excessValue = excessUnits * price(v)`.
Items with `velocity === 0` are **not** flagged as overstock — they are dead
stock (J.1); double-counting them would inflate the "attention" number.

**J.4 Days of Cover** (Growth+)
```
daysOfCover(v) = velocity(v,30) > 0 ? qty(v) / velocity(v,30) : null
```
`null` renders as "—" with tooltip "needs sales history", never ∞ and never 0.

**J.5 Stock Turnover** (Growth+)
`turnover = soldUnits(all,90) / avg(qty over the snapshot window)`, annualised
`× (365/90)`. Requires ≥2 real snapshot days; otherwise uses current qty as the
denominator and **labels the result "point-in-time estimate"** with its inputs
shown.

**J.6 Predictive Restocking** (Commander) — transparent heuristic, not a black box
```
trend(v)      = velocity(v,30) - velocity(v,90)            // accelerating if > 0
adjVelocity(v)= max(0.0001, velocity(v,30) + clamp(trend(v), -0.5*v30, +0.5*v30))
daysToZero(v) = qty(v) / adjVelocity(v)
reorderBy(v)  = today + max(0, daysToZero(v) - LEAD_TIME_DAYS) days
confidence    = 'high'   when ≥90d history and ≥10 sales for v
              | 'medium' when ≥60d and ≥5
              | 'low'    otherwise  (still shown, clearly labelled)
```
The trend clamp keeps a single spike from producing an absurd date. Output
always names the method (`velocity_trend_heuristic`) — same honesty contract as
the Customers `cadence_aov_heuristic` LTV.

**J.7 Inventory Health Score** (all plans) — replaces the misleading 100/100
```
tracked = variants where tracked(v)
stockCoverage = % of tracked with qty > 0                        weight 0.40
lowStockRatio = 100 - (% of tracked that are low but non-zero)   weight 0.20
deadStockRatio= 100 - (% of tracked flagged dead at 90d)         weight 0.20  ← skipped if insufficient data
coverAdequacy = % of tracked with daysOfCover >= LEAD_TIME_DAYS  weight 0.20  ← skipped if insufficient data
score = round(Σ(available component × weight) / Σ(available weights))
grade = ≥90 A+ | ≥80 A | ≥70 B | ≥60 C | else D
```
Weights renormalise over only the components that have real data (the pattern
already used by `packages/ai/src/health.ts`), and the response lists which
components were included. With zero order history the score is honestly built
from stock coverage + low-stock ratio alone and says so — it can never read
"100/100" off unrelated revenue data again.

**J.8 Bundle Recommendations** (Commander) — ⚠️ corrected source
Co-occurrence must come from **order baskets**, not
`analytics_product_sales_daily` (a per-product daily aggregate with no basket
information).
```
for each order in sync_records module='orders' (non-cancelled):
  for each unordered pair (a,b) of distinct product_ids in line_items:
     pairCount[(a,b)] += 1
support(a,b)    = pairCount[(a,b)] / totalOrders
confidence(a→b) = pairCount[(a,b)] / orderCount(a)
lift(a,b)       = support(a,b) / (support(a) * support(b))
```
Emit pairs with `pairCount >= 3` **and** `lift > 1`, ranked by lift, and only
where both products still have `qty > 0`. Below that threshold: `insufficient_data`.
With 2 orders this correctly returns nothing rather than a fake bundle.

**J.9 Seasonal Trend Detection** (Commander) — flagged limitation
Requires ≥12 months of order history (year-over-year month comparison). Compute
`monthsOfHistory` from the oldest real order; when `< 12` return
`{ status: 'insufficient_data', monthsAvailable: n, monthsRequired: 12 }`. This
store will show that state for the foreseeable future — the card is honest
about *why*, and it is not silently hidden.

**J.10 AI Natural-Language Suggestion** (Growth+) / **Custom Queries** (Commander)
Reuses the existing `OpenRouterClient` free-model chain from `f8-bootstrap.ts`.
Identical safety contract to `orders.ts`:
* A `groundedFacts()` array of aggregate-only `{ key, label, value, source }`
  (total SKUs, units, low/out counts, total value, top item units, dead-stock
  count/value, reorder count) — never per-customer or PII data.
* `validateLanguageResponse(text, facts, 0)` rejects any number not present in
  the facts.
* Failure → `{ status: 'unavailable', message: '…deterministic insights remain
  available.' }`. Never a fabricated fallback.
* Token cost recorded through the same `f7.ai.costs.record(...)` hook.
* **No new AI provider, no new model config.**

---

## K) Plan gating enforcement approach

Straight reuse of the #26/#29 pattern, enforced on the **backend**:

1. `INVENTORY_INSIGHTS` definition table with `{ feature, name, minimumPlan }`.
2. `const plan = (await billing.get(storeId))?.plan ?? 'trial'`.
3. `planAtLeast(plan, definition.minimumPlan)` from `@profitpilot/ai` splits
   available vs locked **before any row is read or any calculation runs** —
   locked features cost nothing to compute and leak nothing.
4. Locked features return metadata only:
   `{ locked: true, feature, name, required_plan: 'growth' | 'commander' }`.
5. An explicitly requested locked feature throws
   `InventoryInsightLockedError → 403 { locked, feature, required_plan }`.
6. Every lock is audited into the existing `billing_audit` table as
   `'inventory.insight.locked'` (mirrors `orders.insight.locked` /
   `customers.insight.locked`). **No new audit table.**
7. Daily AI limits via the existing `billing_usage` table with a new feature key
   `inventory_ai_insights_day` — Trial 0 / Start 0 / Growth 20 / Commander
   unlimited, using the same atomic conditional-`UPDATE … RETURNING` consume so
   two concurrent requests cannot exceed the cap. **No billing/plan/entitlement
   definitions are modified.**
8. 5-minute in-memory cache keyed by `storeId:plan:feature:question`; the cache
   is checked **after** entitlement + audit, so a cached hit can never bypass a
   lock.
9. Frontend is presentation-only: masked `PlanLockedFeature` cards driven by the
   server's `locked[]` array, each click routing to the existing Billing page.
   Hiding is never the enforcement mechanism.

Gating matrix as approved in the brief, with two notes:
* `Days of Cover` is Growth+, so `/inventory` returns
  `daysOfCoverState: 'locked'` (not a number) for Trial/Start.
* `Bulk actions` are Growth+; since Phase 2 ships **no write actions**, "bulk"
  means bulk **export/CSV of selection** only. Anything that would write to
  Shopify is out of scope.

---

## L) Data gaps flagged as out of scope

| Item | Reason |
| --- | --- |
| Physical warehouse map | Over-engineering; no source data |
| Supplier management | Not in Shopify |
| Buyer profiles / chat / call | Not applicable to a Shopify store |
| Purchase-order creation | Shopify/ERP territory |
| Barcode scanning | Mobile-native feature |
| Warehouse / Retail / Fulfillment categorisation | Shopify has locations only, with no category field |
| Real-time inventory push | Needs an `inventory_levels/update` webhook handler — future |
| True movement ledger (increments/decrements) | No Shopify history API; needs the webhook ledger — future |
| Monthly heatmap | Depends on ≥1 year of snapshot history we do not have |
| Cost of goods / margin on inventory value | `inventory_item.cost` needs a separate REST call per item; not synced today |
| Per-product custom lead times | Needs merchant settings UI — future |
| Any inventory **write** back to Shopify | Read-only app posture; explicitly excluded |
| Location metadata beyond id/name/active | Only what `/locations.json` returns |

---

## M) Estimated complexity

| Work item | Size |
| --- | --- |
| Route wiring (`API_PATH_PREFIXES`, Vite proxy, `app.ts`, `f8-bootstrap.ts`) | **S** |
| `inventory.ts` — repository, variant↔level join, normalisation, filters, sort, pagination, stats | **M** |
| Location metadata persistence (Option L1) | **S** |
| `inventory-insights.ts` — 13 features, gating, usage, audit, cache, OpenRouter | **L** |
| `inventory_snapshots_daily` migration + `sink.complete()` write + `/inventory/history` | **M** |
| `inventory-model.ts` + `inventory.tsx` + `inventory.css` (14 components) | **L** |
| Remove placeholder, replace router branch, purge F2/F4 jargon | **S** |
| Tests (repository, join, gating per tier, lock metadata, audit, usage, cache, formulas, filters, UI empty/locked states) | **M–L** |
| **Total** | **L** |

Comparable to PR #26 (≈1,600 lines) — this is slightly larger because of the
snapshot table and the variant↔level join.

---

## N) Suggested implementation approach

**Recommendation: two PRs, not one.**

**PR-A — "Fix the empty Inventory page" (M, ships the merchant value fast)**
* Route wiring (both lines), `GET /inventory`, `GET /inventory/:variantId`,
  `GET /inventory/locations`, location metadata persistence
* Rows 1, 2, 5, 6 + detail drawer + toolbar + export
* Free-tier insights (Top Selling Item, Items Needing Attention, Health Grade)
  and the real Inventory Health Score
* Delete the placeholder; remove all F2/F4 jargon
* Locked placeholders rendered for every Growth/Commander feature so the plan
  story is visible from day one
* **Outcome: the page stops being empty and shows real data for all 18 products
  immediately, with zero dependence on order history.**

**PR-B — "Inventory intelligence & history" (L)**
* `inventory-insights.ts` with all Growth/Commander features, usage limits,
  lock auditing, OpenRouter grounding
* `inventory_snapshots_daily` migration + `sink.complete()` + `/inventory/history`
* Row 3 fully live + Row 4 analytics chart

Rationale: PR-A is the bug fix and is independently shippable and reviewable;
PR-B is a feature layer whose value is currently limited by this store's 2-order
history. Splitting also keeps each diff near the size of #26, which reviewed
cleanly, instead of doubling it.

If you prefer a single PR to match #26/#29 exactly, that is workable — say the
word and I will merge the two scopes.

---

## Open questions before Phase 2

1. **Split into PR-A / PR-B, or one PR?** (recommendation: split)
2. **Low-stock threshold** — hardcode 10 for Phase 2, or expose it as a toolbar
   control now? (recommendation: default 10, toolbar control, no persistence yet)
3. **Location metadata** — Option L1 (piggyback on the inventory module,
   minimal) or L2 (a 9th sync module, cleaner)? (recommendation: L1)
4. **Reorder lead time** — accept the fixed 14-day default for Phase 2?
5. **Scope verification** — can you confirm the live install granted
   `read_inventory` + `read_locations`, or should PR-A include a small
   diagnostic surfaced in the coverage banner when inventory sync returns zero
   rows?
6. **Velocity grain** — variant-level from order line items (more precise,
   recommended) vs product-level from `analytics_product_sales_daily`
   (cheaper)? (recommendation: variant-level, with product-level as fallback)
