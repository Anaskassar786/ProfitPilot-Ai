# PR #38 Comprehensive Cleanup — Investigation Report
**Date:** 2026-08-16 UTC
**Branch:** arena/01a00b58-profitpilot-ai (based on main 6774eae1)
**Scope:** Dashboard (Issues 1.1-1.5), Products (NO CHANGES), Orders (3.1-3.3), Customers (4.1-4.5), Inventory (5.1-5.7), Analytics (6.1-6.15), Global UI Patterns (Fix 1-5), Typography/Spacing/Light Theme Rebuild (Part C)
**Status:** INVESTIGATION ONLY — zero code changes made

---

## 1. Executive Summary

PR #38 is **large but technically feasible as a single PR** (~14-18 prod files changed, ~7 CSS, ~8 TSX, 2-3 models) if organized into 8-10 logical commits. The highest risk is Part C (complete light theme rebuild) which touches almost every CSS file because current implementation uses hard-coded dark rgba gradients instead of CSS variables.

**Critical findings:**
- **Light theme is unusable** — only 7 CSS variables are overridden in `.light-mode`, while 80% of component backgrounds are hard-coded `rgba(8,13,24,.36)` / `linear-gradient(145deg,rgba(26,29,39,.94)...)`. Text #111827 on dark bg = invisible. Products page confirmed broken per task.
- **Typography is 7-11px** in most places (7px labels, 8px body, 9px inputs) vs premium SaaS standard 14-15px body. Only KPI big numbers (24-26px) are okay. Explains “users lean in”.
- **Upgrade CTAs centralized**: `UpgradePlanButton.tsx` renders "Trial · Upgrade" (Zap + small label + arrow). One file fix fixes Orders, Customers, Inventory, and part of Analytics. `PlanLockedFeature` in `orders.tsx` centrally renders "Upgrade to Growth/Commander to unlock" — one string change fixes 15+ locked cards app-wide, except overridden description props in Customers drawer.
- **Greeting shows store URL** because `context.shop` is shopDomain from `stores` table only (no shop name). No `shop.name` fetched anywhere — DB table `stores` only has `id, shop_domain`. Need derived friendly name (strip .myshopify.com, Title Case) or new backend GraphQL shop query.
- **Sync All cards permanent** — state `syncProgress` in `App.tsx` set on success but never cleared. Needs timer 3-4s auto-dismiss + fade.
- **Dashboard Recent Activity cannot show customer names** with current data: `buildRecentOrders()` uses analytics aggregates (`orderCount` label), not real orders. Need new fetch of last 5 real orders via `fetchOrders`.
- **Analytics KPIs buggy** — Total Customers shows "—" because `totalCustomers` relies on `cohortCustomerTotal(snapshot.customerCohorts)` OR `customerStats.identified` but API's `totalCustomers` may be null when only cohorts present. Also sparklines meaningless flat lines when <2 points.

---

## 2. File Inventory — Every file that WILL be modified

### Dashboard (1.1-1.5)
- `apps/web/src/App.tsx` — Lines 130-210 sync logic, 432 greeting title `Good morning, ${context.shop}`, 441-449 DashboardPage wrapper, SyncAllProgress component 447+.
- `apps/web/src/dashboard.tsx` — Main file:
  - Store Summary: `ai-summary-card` (314-336), `generateSummary()` plain text.
  - By Category Pie: `CategoryPieChart` (220-290), `CATEGORY_COLORS`, `pie-container`.
  - Recent Activity: `OrderRow` (520-560), `buildRecentOrders()`, `orders-list`.
  - Period toggles, calendar.
- `apps/web/src/dashboard.css` — Only 2 light overrides (`.light-mode .dash-card`, `.period-toggle-group`). Needs spacing & typography bump + light rebuild + timeline/pie/summary redesign.
- `apps/web/src/dashboard-utils.ts` — `generateSummary()` returns bold markdown ** not rendered, `aggregateByCategory()`, `buildRecentOrders()`, `densePeriodKeys()` etc.
- `apps/web/src/model.ts` — Preserved but contains `formatMoney`, `storeHealthView` helpers. Could add `formatStoreDisplayName()`.

### Orders (3.1-3.3) — NO TOUCH: Sync button, tabs, KPI, table, search, filters, date, export, pagination, Jarvis
- `apps/web/src/orders.tsx` — 
  - 3.1 badge: line 189 `<UpgradePlanButton plan={result.plan} />` + `.orders-insights-head-actions`
  - 3.2 icon: 184 `<Sparkles size={18}/>` in `.ai-insights-icon`, also CommanderCapability icons.
  - 3.3 locked: `PlanLockedFeature` (217-223) tagline `Upgrade to ${titleCase(requiredPlan)} to unlock`
- `apps/web/src/orders.css` — `.orders-insights`, `.orders-insights-header`, `.ai-insights-icon`, `.plan-locked-feature`, `.orders-plan-badge`
- `apps/web/src/orders-model.ts` — types, no UI but reference for lockedInsight.

### Customers (4.1-4.5) — DO NOT TOUCH: Total Customers KPI, Top Spender, Sync/Export, Search, Tabs, Table columns, Activity badges, Synced history bar, Pagination, Jarvis
- `apps/web/src/customers.tsx` —
  - 4.1 AI VIP locked: `CustomerStatsGrid` 131
  - 4.2 badge: `AICustomerInsightsCard` header 160 `UpgradePlanButton`
  - 4.3 6 locked: `CustomerPremiumIntelligence` (222-230) with descriptions "Upgrade to Growth..."
  - 4.4 dropdown alignment: `CustomersToolbar` (276-294) `.customers-toolbar-actions`, `CustomSelect`
  - 4.5 inline Growth badges: `CustomerRow` 181 `<button className="customer-inline-lock">Growth</button>` and `CustomerEmailAction` 197.
- `apps/web/src/customers.css` — `.customers-heading-actions`, `.customer-stats-grid`, `.customer-ai-heading-actions`, `.customers-toolbar`, `.customers-sort`, `.customer-inline-lock`, `.customer-bulk-bar`, table responsive
- `apps/web/src/customers-model.ts` — segment feature list
- `apps/web/src/CustomSelect.tsx` — shared dark listbox used for sort (Newest Customer)
- `apps/web/src/upgrade-overrides.css` — overrides width for selects (needs expansion)

### Inventory (5.1-5.7) — DO NOT TOUCH: Category/Vendor/Location filters, Search, Tabs, Table, Stock badges, Stock Distribution donut, Jarvis
- `apps/web/src/inventory.tsx` —
  - 5.1: `InventoryStatsGrid` 136 label Total SKUs, hint Average X per tracked SKU
  - 5.2: `InventoryHealthCard` 137-176
  - 5.3: `InventoryValueSummary` 179-222
  - 5.4: `BasicInsightsCard` 294 header Sparkles + UpgradePlanButton
  - 5.5: `AIInventoryInsightsCard` imported
  - 5.6: locked via `PlanLockedFeature`, `LockedSlot`, `DaysOfCoverCell` 445
  - 5.7: `InventoryToolbar` 383-410 sort control
- `apps/web/src/inventory.css` — `.inventory-stats-grid`, `.inventory-overview-grid`, `.inventory-health-card`, `.inventory-value-card`, `.inventory-insights`, `.inventory-ai-card`, `.inventory-toolbar`, `.inventory-sort-control` — massive redesign needed
- `apps/web/src/inventory-insights.tsx` —
  - 5.4/5.5 headers: `InsightsHeader` 78 Sparkles
  - 5.6 locked 8 cards: DeadStock, Reorder, Overstock, StockTurnover, PredictiveRestocking, SeasonalTrends, AutoReorder, DaysOfCover via `InsightSlot`
- `apps/web/src/inventory-insights-model.ts` — `TEXT`, messages, `usageLabel`
- `apps/web/src/inventory-model.ts` — `daysOfCoverLabel()` returns "Growth" when locked, `formatUnits`, `quantityLabel`

### Analytics (6.1-6.15) — DO NOT TOUCH: Working chart data itself, custom date range, overall page structure/section order
- `apps/web/src/analytics.tsx` — Single file 372 lines but contains all widgets:
  - 6.1 sparklines: `KpiCard` 24-45, `AnalyticsHero`
  - 6.2 Total Customers: uses `analyticsKpis()`, but bug in model; `formatKpi`
  - 6.3 Conversion + Repeat: `analyticsKpis()` returns null value for those
  - 6.4 Revenue Momentum tooltip: `RevenueTooltip` 193-204 shows duplicate values (revenue twice)
  - 6.5 VALUE × VOLUME: `OrdersAOVCorrelation` eyebrow prop 97
  - 6.6 AOV explanation: same component needs subtitle tooltip
  - 6.7 Sales by Channel/Category empty: `SalesByChannel`, `CategoryDistribution`, `RichEmpty`
  - 6.8 AI Business Intelligence: `AIIntelligence` 103 — contains "PROFITPILOT INTELLIGENCE LAYER", "0/7 days learned", "Confidence: BUILDING", jargon
  - 6.9 Cohort locked: `CohortAnalysis` uses `LockedWidget`
  - 6.10 Top Products empty: `ProductPerformance`
  - 6.11 Product Insights locked: inside ProductPerformance `LockedInline`
  - 6.12 jargon labels: Widget eyebrow props: "WEEKLY RHYTHM", "SHOPPING RHYTHM", "PROFITPILOT INTELLIGENCE LAYER", "PERFORMANCE COMMAND CENTER", "REVENUE DEEP DIVE", "ATTRIBUTION", "REVENUE MIX", "RETENTION ENGINE", "MARKET MAP", "REVENUE LEADERS", "AI MERCHANDISING", "JOURNEY ANALYTICS", "EXECUTIVE LENS", "COMMANDER COPILOT" etc
  - 6.13 empty state text: `RichEmpty`, `EducationalState` messages like "Order-level timestamps", "Opportunity engine listening"
  - 6.14 Conversion Funnel locked: `ConversionFunnel`
  - 6.15 Executive Brief + Commander Copilot locked: in AIIntelligence + `CustomAIQuery`
- `apps/web/src/analytics.css` — 23k lines, heavily dark: `.analytics-kpi {background: linear-gradient(145deg,rgba(17,25,40,.93)...}`, `.analytics-widget {border: rgba(148,163,184,.13)}`, `.ai-intelligence {radial-gradient(...)}`, `.channel-list`, `.category-layout` etc. All need light overrides.
- `apps/web/src/analytics-model.ts` — `analyticsKpis()`, `periodTrend()`, `normalization`, `Kpi` type
- `apps/web/src/safe-date.ts` — keep intact (date normalization)

### Global / Shared
- `apps/web/src/UpgradePlanButton.tsx` — **Central**: 11 lines, renders `${label} · Upgrade`. Fix here fixes Global Fix 1.
- `apps/web/src/orders.tsx` `PlanLockedFeature` — **Central** for Global Fix 2.
- `apps/web/src/App.tsx` sync module cards + toast + topbar/theme toggle
- `apps/web/src/CustomSelect.tsx` — sort dropdowns, light theme dropdown background needs fix
- `apps/web/src/styles.css` — 986 lines, root tokens + light overrides + all shared components (buttons, cards, tables, sidebars, chart skeletons, product cards, etc.)
- `apps/web/src/upgrade-overrides.css` — small width overrides, needs expansion for typography
- `apps/web/src/main.tsx` — CSS import order (determines cascade for light mode)
- `apps/web/src/JarvisOrb.tsx` + `jarvis-orb.css` — **MUST NOT TOUCH** — confirm its canvas is theme-independent (hard-coded rgba, verified).

### Design Token / Theme / Config
- `apps/web/src/styles.css` — primary token file.
- `packages/ui/src/tokens.ts` — dead code (colors, spacing scale unused). Should be synced or removed.
- `apps/web/index.html` — check font loading (Inter). Should ensure font weights loaded.
- `apps/web/vite.config.ts` — no theme config, but host config needed for preview.
- `apps/api/src/session-routes.ts` + `packages/db/src/stores.ts` — only shop_domain, no shop name.

### Test files needing updates (not prod but awareness)
- `apps/web/src/orders-ui.test.ts` (expects Upgrade to Growth)
- `apps/web/src/customers-ui.test.ts` (2 expects)
- `apps/web/src/inventory-ui.test.ts` (expects Upgrade to Growth)
- `apps/web/src/inventory-insights-ui.test.ts` (2 expects)
- `apps/web/src/analytics-ui.test.ts` (jargon labels)
- `apps/web/src/analytics-date-resilience.test.ts`
- `apps/web/src/dashboard-utils.test.ts`

**Total production files to modify: ~16**
- TSX: App.tsx, dashboard.tsx, orders.tsx, customers.tsx, inventory.tsx, inventory-insights.tsx, analytics.tsx, UpgradePlanButton.tsx, CustomSelect.tsx = 9
- CSS: styles.css, dashboard.css, orders.css, customers.css, inventory.css, analytics.css, upgrade-overrides.css = 7
- Model: inventory-model.ts, customers.tsx descriptions, analytics-model.ts (minor) = 3
- Config: maybe vite.config.ts not needed.

---

## 3. Current State Analysis

### Theming
- `:root` dark tokens ok. Light override `.app-shell.light-mode` only 8 variables.
- Hard-coded dark backgrounds everywhere:
  - `styles.css`: `.card` gradient `linear-gradient(145deg,rgba(26,29,39,.94)...)` should be `var(--card)` light override already exists but gradient still used via `.light-mode .card {background: white}` only in 2 places, but many components bypass `.card` and use `rgba(8,13,24,.36)`, `rgba(9,13,22,.34)`, `rgba(15,23,42,.55)` directly.
  - `orders.css`: `.orders-tabs` bg `rgba(9,13,22,.34)`, `.orders-basic-card` `rgba(8,13,24,.36)`, `.orders-insights` gradient dark.
  - `customers.css`: `th {background: rgba(8,13,24,.2)}`, `td {border: var(--border-soft)}` but card bg `linear-gradient(145deg,rgba(26,29,39,.96)...`
  - `inventory.css`: similar.
  - `analytics.css`: `.analytics-kpi` `linear-gradient(145deg,rgba(17,25,40,.93),rgba(7,12,23,.88))` + border `rgba(148,163,184,.13)` — stays dark in light mode.
- Chart libraries: Recharts `TEXT_COLOR #9CA3AF` static dark gray that becomes invisible on white; `GRID_COLOR rgba(107,114,128,.12)` too light on light bg? Actually okay. But bar colors `BAR_COLOR #3B82F6` okay both themes. Needs theme-aware adaption via CSS var or prop.
- Icons inherit currentColor, but containers have hard-coded colors like `.ai-insights-icon` #C4B5FD border rgba.

### Typography & Spacing
- Ad-hoc:
  - Page title: clamp(25px,2.5vw,32px) 800 weight - okay, preserve.
  - Section h3: 13-14px
  - Card kicker: 7-8px mono uppercase letter-spacing .07-.14em
  - Body: 7-10px (customers small 7px, orders p 7px, inventory small 7px, metric-label 10px, orders-search input 9px)
  - Table cells: 8px
  - Small captions: 6-7px
  - KPI numbers: 24-26px (keep)
- Line heights: 1.4-1.65 generally.
- Spacing: card padding 12-18px (should be 20-24), section gaps 12-14px (should be 20-24), table row heights 58px ( okay but could be 64 ), sidebar spacing tight.

### Locked Card Texts
- Central in `PlanLockedFeature`: `Upgrade to ${titleCase(requiredPlan)} to unlock` + optional description prop.
- Overridden descriptions in Customers drawer: "Upgrade to Growth to unlock purchase patterns..." etc.
- Inline badges: `customers.tsx` CustomerRow -> "Growth", `inventory.tsx` DaysOfCoverCell -> "Growth" + "Upgrade to calculate", `analytics.tsx` LockedWidget -> "Unlock with {plan}", LockedInline -> "See upgrade".
- Replace all with "Upgrade" or "Upgrade to unlock" + tooltip explaining billing page has details.

### Trial Upgrade Badges
- `UpgradePlanButton.tsx` single source: renders Trial/Start/Growth + Upgrade + Zap + ArrowUpRight. Overlap occurs because flex with Zap (12px) + small label + Arrow 12px inside 30px height container + parent `.orders-insights-head-actions` gap 8px with collapse button 30px — visual confusion between dropdown arrow and button.
- Analytics has separate `plan-pill` showing "{plan} intelligence" — needs removal/replacement.

### AI Section Icons
- Dashboard Store Summary: Sparkles purple.
- Orders AI Insights: Sparkles 18px inside gradient box.
- Customers AI: Bot.
- Inventory Stock Insights: Sparkles.
- Inventory Stock Intelligence: Sparkles.
- Analytics AI Business Intelligence: Brain (already brain, okay) but inner cards: LineChart, AlertTriangle, Lightbulb, Wand2 — repetitive star not but growth opportunities uses Lightbulb (okay). Spec wants page-specific: Dashboard → sparkles alternative (maybe Lightbulb or Stars alternative), Orders → package/bag/target, Customers → users/heart, Inventory → warehouse/box, Analytics → brain/trending chart.

---

## 4. Deep Dive per Task Section

### Part A1 Dashboard

**1.1 Greeting**
- Where rendered: `App.tsx` PageLayout title prop (page-header h1) line 432.
- Fetched: `workspaceContext` parses shop from URL query, then fetchSessionContext via `/session/context` which reads `stores` table shop_domain. No shop.name.
- Is proper store display name available? No. Shopify `shop.name` not stored, no endpoint. Would need new API call: Shopify Admin API `GET /admin/api/2025-10/shop.json` or GraphQL `query { shop { name } }`. Could add backend.
- Recommended clean professional gender-neutral: "Good morning" alone OR "Good morning, Merchant" OR derived friendly name: `formatShopName('commander-pilot.myshopify.com') => 'Commander Pilot'` (strip suffix, replace - with space, Title Case). Also could show "Good morning" as title, and store domain as subtitle small, or in topbar workspace switcher badge (already shows). Avoid URL in title completely. Keep eyebrow "Store intelligence" but title should not contain URL.

**1.2 Sync All success cards**
- Rendered: `SyncAllProgress` in App.tsx 447, styled in `styles.css` `.sync-all-progress` grid 4-col, `.sync-module` with status succeeded/failed/syncing.
- State: `syncProgress` useState readonly array, set on success/failure, never cleared. Toast auto-dismiss 3600ms, but cards stay.
- Sync completion: `requestSyncAll` returns `result.modules` with status. Should trigger timer after any result.
- Fix: In App.tsx after setting syncProgress, start timeout 3500ms to set `syncProgress` empty array (or with fading). Add CSS `@keyframes fadeOut` + class `.dismissing` opacity transition. Toast too already. Ensure "Shopify data plane ready" bar is `.sync-banner` independent — confirmed it should stay (status indicator not sync result).
- Files: `App.tsx` add `useEffect` watching syncProgress to auto-dismiss, `styles.css` animation.

**1.3 Store Summary**
- Location: `dashboard.tsx` ai-summary-card.
- Current plain text: `generateSummary` returns concatenated sentences like "$8K in 30 days..." but raw markdown.
- Redesign needs: icons, growth indicators, structured highlights, AI-generated feel.
- Data available: revenue30d, prevRevenue30d, orders, catalogCount, health, categoryData, recentOrders summary. Could parse summary into structured bullets.
- Proposed: 3 highlight pills with icons (Revenue, Orders, Top product), each with growth badge, plus paragraph. Use gradient border, sparkle alternative icon.
- Files: `dashboard.tsx` (rewrite ai-summary-card body), `dashboard.css` new classes `.ai-summary-highlights`, `.summary-insight-row`, plus typography bump.

**1.4 By Category pie**
- Location: `dashboard.tsx` CategoryPieChart.
- Looks empty/boring because: default Recharts legend bottom, no center total, single color, no hover.
- Enhancements: center total (custom overlay showing total revenue), side legend with percentages + values (custom component mapping data with color dots, % calc), better colors (keep CATEGORY_COLORS but ensure light variant), hover effects (Cell stroke, activeIndex state), Top category highlight (badge "Top"), better empty/sparse state (currently single-category-ring special but could improve).
- Implementation: Use `activeIndex` state + `onMouseEnter` on Pie, custom Legend component, overlay div absolute centered showing total.
- Files: `dashboard.tsx` rewrite CategoryPieChart, `dashboard.css` add `.pie-center-total`, `.pie-side-legend`.

**1.5 Recent Activity**
- Location: `dashboard.tsx` orders-card + OrderRow.
- Currently plain order list: orderId, customer=orderCount, amount, status, date. No customer names, no product preview.
- Redesign timeline-style: vertical line with dots, customer name visible or Guest, product preview, better status badges, cleaner hierarchy.
- Challenge: No customer names in analytics. Need real orders fetch. Recommend inside `DashboardLayout` useEffect to fetch `fetchOrders(storeId, {limit:5, sort:date})` when storeId present, else fallback to current analytics method. Then render timeline with avatar initials, customer name from `order.customer.name`, product first title, amount, status.
- Files: `dashboard.tsx` (add orders fetch hook), `dashboard-utils.ts` maybe new helper, `dashboard.css` timeline styles.

### Part A3 Orders

**3.1 Trial·Upgrade badge overlapping**
- File `UpgradePlanButton.tsx` whole. Fix: remove Trial text, clean single "Upgrade" or "Upgrade Plan" button. Change to: `<button class="upgrade-plan-cta"><ArrowUpRight/> Upgrade</button>` or with Zap. Remove `<small>{label}</small> ·`. Fix visual confusion: ensure button and collapse chevron not overlapping — increase gap, use distinct styling (primary ghost vs icon).
- CSS: `.orders-insights-head-actions` gap, `.upgrade-plan-cta` styling.

**3.2 Star icon**
- Change `Sparkles` to page-appropriate: Orders → `Package` or `ShoppingBag` or `Target`. Recommend `Package` (box) or `ShoppingBag` header.
- File `orders.tsx` line 184.

**3.3 Locked cards text**
- `PlanLockedFeature` change tagline from `Upgrade to ${titleCase(plan)} to unlock` to `Upgrade` or `Upgrade to unlock`.
- Also ensure `aria-label` updated.

### Part A4 Customers

**4.1 AI VIP Customers**
- File `customers.tsx` CustomerStatsGrid line 131.

**4.2 AI Retention Insights badge**
- Same as 3.1.

**4.3 All 6 locked**
- `premium_segments`, `retention_suggestion`, `purchase_patterns`, `predicted_next_order`, `predictive_ltv`, `auto_retention_workflows` + `custom_ai_queries`.
- All via lockedCustomerInsight + PlanLockedFeature.

**4.4 Newest Customer dropdown alignment**
- `CustomersToolbar` sort dropdown uses CustomSelect value sort=newest, label "Newest customer" long text near CSV export button compact-export. Alignment issue: sort width min 118px max 180px but label "Newest customer" truncates? Actually upgrade-overrides.css already widens `.customers-sort .custom-select-trigger>strong` max-width 110px ellipsis. But button still misaligned near CSV. Fix: ensure toolbar flex wrap, gap, min-width, align-items center, export button same height (34px). Check responsive.
- Files: `customers.css` `.customers-toolbar`, `.customers-toolbar-actions`, `upgrade-overrides.css`.

**4.5 Inline Growth locks**
- `CustomerRow` behavior and action columns: currently `<button class="customer-inline-lock"><LockKeyhole/> Growth</button>` and similar. Change to consistent locked style: just lock icon with "Upgrade" tooltip, no plan names.
- Implement tooltip via `title="Upgrade to unlock"` or custom tooltip div.

### Part A5 Inventory

**5.1 Total SKUs → Total Products**
- `InventoryStatsGrid` label.
- Subtitle "Average X per tracked SKU" → product/item.
- File `inventory.tsx` 136-139.

**5.2 Inventory Health modern**
- Current: compact gauge 104px, components list with bar, score + grade. Looks dated.
- Modern: bigger circular gauge with gradient, better animated progress bars, grade letter prominent colored badge, cleaner Needs attention text ("0 · Needs attention" weird), icons for each metric row, match Order Health quality.
- Data: health.components has label, score, detail, weight. Could add icons mapping per key.
- Files: `inventory.tsx` rewrite InventoryHealthCard, `inventory.css`.

**5.3 Inventory Value modern**
- Current shows total value + topValueItems list title/variant/quantity/value.
- Modern: product thumbnails in list (need imageUrl), percentage of total (value/totalValue*100), distribution bars (width %), better formatting, hover effects.
- Need to join topValueItems with items that have imageUrl? TopValueItems type lacks image. Could enhance API or use InventoryRowItem imageUrl by matching variantId.
- Files: `inventory.tsx` InventoryValueSummary, `inventory.css`.

**5.4 Stock Insights star + badge**
- Same as Orders: replace Sparkles with inventory icon (Boxes, Layers, Warehouse) and badge cleanup.

**5.5 Stock Intelligence same**

**5.6 All locked cards**
- 8 features: dead_stock, reorder_recommendations, overstock_alerts, stock_turnover, predictive_restocking, seasonal_trends, auto_reorder, days_of_cover, stock_history, custom_ai_queries, ai_suggestion.
- Via InsightSlot + PlanLockedFeature.

**5.7 Sort dropdown**
- Confusing Sort ▼ / Name ↑. Fix: single dropdown "Sort: Name" with clear direction toggle, consistent with other pages.

### Part A6 Analytics (most extensive)

**6.1 KPI sparklines meaningless straight lines**
- Cause: `analyticsKpis()` sparkline = last 28 revenue rows raw values, but when data sparse (e.g., 5 customers but revenue only few days), line appears straight. Need better empty: if <3 points, show guided placeholder (like dotted) or "Building data" with progress bar, not fake line. Also need meaningful mini charts: maybe use area + gradient, not just straight.
- Files: `analytics.tsx` KpiCard, `analytics-model.ts` spark logic.

**6.2 Total Customers KPI shows — even when 5 exist**
- Bug: `analyticsKpis` totalCustomers = `insights?.totalCustomers` OR `customerStats.identified`. `totalCustomers` from API is `cohortCustomerTotal(snapshot.customerCohorts)` ?? `customerStats.identified`. If snapshot.customerCohorts empty but orders contain customers, totalCustomers may be null. However API `customerMetrics` counts distinct customer.id from orders. That should give identified. But `insights` may be null when loading, causing KPI shows —. Or cache? Need trace: AnalyticsPage refresh loads insights via `fetchAnalyticsInsights`, sets insights state. KPIs memoized from snapshot + insights.totalCustomers. If insights null or totalCustomers null, KPI value null → shows —. Should fallback to snapshot? Or count orders distinct customers.
- Fix: in `analyticsKpis()`, ensure totalCustomers fallback to orders distinct? But spec says fix calculation to show real count. Simplest: if totalCustomers null, try snapshot orders? But snapshot doesn't have customer count. Better: count customerCohorts distinct? Actually analytics-insights.ts already does `cohortCustomerTotal` OR `customerStats.identified`. If snapshot.customerCohorts empty and orders table empty (but Customers page has 5), then analytics snapshot may not have customerCohorts yet because sync of customerCohorts requires productSales? Need check. Recommend ensure API returns `totalCustomers` from customers table count if available, not just cohorts. Or frontend fallback: when insights null, fetch customers count via `fetchCustomers`? Simpler frontend fix: if kpi value null but customerStats exists, use that.
- File: `analytics-model.ts` + maybe `analytics-insights.ts` backend.

**6.3 Conversion + Repeat — shows —, needs honest empty states**
- Currently KPI returns null value + detail "Connect Shopify Analytics for sessions" etc. But UI shows "—" and detail, not clear reason. Need honest empty state with visual progress and clear reason "Requires Shopify Analytics" or similar.
- File `analytics.tsx` KpiCard rendering for format percent with null value shows —, but detail already says "Connect Shopify Analytics". Need improve visual: maybe icon + tooltip.
- Also backend: conversion rate always null because sessions data not collected.

**6.4 Revenue Momentum tooltip duplicate**
- `RevenueTooltip` component line 193 shows `payload` rows filtered but each row has revenue twice? In ComposedChart data includes revenue, previous, forecast, upper. Tooltip currently shows array includes bar revenue + line revenue duplicate. Shows revenue: $4,580 twice + Current: $4,580. Need clean tooltip: Date, Revenue once, vs Previous $X if applicable, AI Forecast $X.
- Fix: Deduplicate in RevenueTooltip — filter by unique name, prefer "Current" over bar.

**6.5 VALUE × VOLUME jargon**
- Remove technical category label above Orders & AOV chart. Just clean title.
- Widget eyebrow prop "VALUE × VOLUME" in `OrdersAOVCorrelation` line 97.

**6.6 AOV explanation**
- Add tooltip/subtitle explaining "Average Order Value = revenue ÷ orders"
- Add info icon with tooltip in widget header.

**6.7 Sales by Channel + Category empty states**
- Clearer explanation why empty. If requires more data, show visual progress. If plan-gated, proper upgrade CTA.
- Currently `RichEmpty` shows generic message with progress 0, goal "Sync order source data". Could improve with actionable steps.

**6.8 AI Business Intelligence major simplification**
- Remove "Trial Intelligence" badge → clean Upgrade button. Currently `plan-pill` shows "{plan} intelligence". Should be replaced with `UpgradePlanButton` or simple "Upgrade".
- "0/7 days learned" → user-friendly "AI is learning your patterns" + visual progress bar. Currently `forecast-card` h3 shows `${salesHistoryDays} / 7 days learned`. Needs rewrite.
- "Confidence: BUILDING" → clarify or hide. Currently footer shows Confidence: BUILDING/HIGH/MEDIUM.
- Remove jargon: "engine is listening", "evidence-based", "grounded metrics", "scope-aware".
- Files: `analytics.tsx` AIIntelligence, `analytics-model.ts` forecast messages.

**6.9 Cohort locked Unlock with Growth → Upgrade**
- `CohortAnalysis` uses `LockedWidget` which button says `Unlock with {plan}`. Change to Upgrade.

**6.10 Top Products empty state**
- Show actual products even with minimal data OR better educational preview. Currently `RichEmpty` when no products. Could show from catalog even with 0 sales.

**6.11 Product Insights locked See upgrade → Upgrade**

**6.12 Remove ALL jargon category labels**
- List: WEEKLY RHYTHM, SHOPPING RHYTHM, PROFITPILOT INTELLIGENCE LAYER, PERFORMANCE COMMAND CENTER, REVENUE DEEP DIVE, ATTRIBUTION, REVENUE MIX, RETENTION ENGINE, MARKET MAP, REVENUE LEADERS, AI MERCHANDISING, JOURNEY ANALYTICS, EXECUTIVE LENS, COMMANDER COPILOT, etc.
- Replace with simple direct titles OR remove entirely.
- Widget eyebrow prop usage across file — change eyebrow to simpler or remove component header small element.

**6.13 Simplify empty state text**
- Remove jargon like "Order-level timestamps", "scope-aware", "opportunity engine listening", "hourly demand needs timestamps".
- In `TemporalPatterns`, `RichEmpty` messages contain that jargon.

**6.14 Conversion Funnel locked Unlock with Growth → Upgrade**

**6.15 Executive Brief + Commander Copilot locked Unlock with Commander → Upgrade; simplify descriptions**

---

## Part B — Global Patterns

**Global Fix 1: Upgrade CTA Badge Cleanup**
- File `UpgradePlanButton.tsx`: remove Trial text. Current renders Zap + small label + · Upgrade + ArrowUpRight. Proposal: single button "Upgrade" or "Upgrade Plan" with consistent styling (primary gradient blue/purple, rounded 8px, 14px font) — fix overlap: ensure parent container gap, button min-width, no wrapping.
- Also analytics `plan-pill` needs removal.

**Global Fix 2: Locked Element Text**
- Central fix in `orders.tsx` PlanLockedFeature: tagline → "Upgrade" or "Upgrade to unlock".
- Also fix overrides: `customers.tsx` descriptions (2), `analytics.tsx` LockedWidget button `Unlock with {plan}` → "Upgrade", LockedInline "See upgrade" → "Upgrade".
- Inline badges: Customers table + Inventory DaysOfCoverCell.

**Global Fix 3: AI Section Icons**
- Replace repetitive Sparkles:
  - Dashboard → maybe `Lightbulb` or `Stars` alternative or `Sparkles` with different color (but spec says sparkles alternative). Use `WandSparkles` or `Bot`? Actually Jarvis orb separate identity, so AI Insights icon should NOT be Jarvis but could be `Lightbulb`.
  - Orders → `Package` / `ShoppingBag` / `Target` — recommend `ShoppingBag`.
  - Customers → `Users` / `Heart` — recommend `Users`.
  - Inventory → `Boxes` / `Warehouse` variant — recommend `Boxes`.
  - Analytics → `Brain` / trending chart — already Brain, but could be `LineChart`.
- Ensure `ai-insights-icon` styled containers still distinct.
- Preserve Jarvis orb — NEVER TOUCH. Its colors #A7E2FF etc, size 48/80, position fixed right 29 bottom 25, animations idle/listening etc. Ensure CSS not overridden.

**Global Fix 4: Remove Technical Jargon**
- Search terms across codebase:
  - "Intelligence Layer" → in `analytics.tsx` 103 + CSS comments
  - "Weekly/Shopping Rhythm" → analytics.tsx 112
  - "0/7 days learned" → analytics.tsx 103 forecast-card
  - "Evidence-based" → forecast message from API + analytics.tsx 103
  - "Scope-aware" → `ConversionFunnel` eyebrow message
  - "Grounded metrics" → executive-card footer "Grounded only in verified store metrics"
  - "Opportunity engine listening" → EducationalState title
  - "Confidence: BUILDING" → forecast-card footer
  - Category headers already listed 6.12
- Replace with merchant language: "AI is learning...", "Based on your sales", "Your data", etc.

**Global Fix 5: Empty State Language**
- All `RichEmpty` and `EducationalState` messages need simplification, actionable, visual progress bars where applicable, no jargon.

---

## Part C — Typography, Spacing & Light Theme Rebuild (MOST IMPORTANT)

### Current Problems Verified

**Dark Theme too small:**
- Observed font sizes: kicker 7-8px, body 8-9px, table 8px, search input 9px, small 6-7px. KPI numbers 20-26px ok. Everything else cramped.
- Line-height tight 1.4.
- Card padding 12-18px, gaps 11-14px.
- Needs scale up.

**Light Theme invisible:**
- Hard-coded dark backgrounds keep dark; light variables only partially override.
- Example broken:
  - `.orders-tabs` bg rgba(9,13,22,.34) dark on white background? text #6B7280 on dark bg? contrast fails.
  - `.orders-basic-card` bg rgba(8,13,24,.36) — dark card on white page but text #111827 on dark card? Actually text color var(--text) becomes #111827 dark, background dark rgba => invisible? Need white bg for card but has dark gradient overlay.
  - `.customers-table th` bg rgba(8,13,24,.2) — dark header on light page.
  - `.analytics-kpi` gradient dark.
  - `.product-stat-card` radial-gradient white .035 on dark card, but light override `.light-mode .card {background:white}` maybe partially works but inner gradients still dark? Actually product card background defined in styles.css .product-stat-card::after pseudo with rgba dark? That will remain.
  - Chart colors: dark grid, tooltip bg #09101e dark, would be invisible on light? Tooltip bg dark would still show but low contrast.
  - Hover states `rgba(59,130,246,.035)` works both but needs check.
- Products page confirmed broken per task — `.products-redesign` cards use hard-coded dark gradients.

### Design Token Audit

- Where colors defined? `styles.css` :root variables + hard-coded rgba everywhere else. `packages/ui/tokens.ts` unused.
- Both dark/light themes properly configured? No — light only partial.
- Text colors using tokens? Some use `var(--text-secondary)` but many use hard-coded #C4B5FD etc.
- Card backgrounds, borders, shadows theme-aware? No, mostly hard-coded.
- Chart libraries adapt to theme? No, static colors.
- Icons change color per theme? Some use currentColor, many hard-coded.
- Hover states work in both? Partially.

### Typography Scale Audit

- Define current sizes (measured):
  - Page eyebrow 8px mono uppercase
  - Page title 25-32px clamp
  - Card header h3 14px
  - Kicker 8px mono
  - Metric icon 32px box, value 26px, label 10px, growth label 7px
  - Table th 7px mono uppercase, td 9px
  - Search input 9px, placeholder tertiary
  - Button 10px, small 7-8px
  - Empty state strong 11-13px, p 8px
- Line heights 1.4-1.65
- Font weights 600-800
- No defined scale.

### Spacing Audit

- Card padding: dashboard 18-20px, three-col-row tight 14-16px, orders toolbar 14-16px, customers toolbar 13-15px, inventory toolbar 14-16px.
- Section gaps: dashboard-modern gap 12px, analytics page gap 16px, products-redesign gap 14px.
- Table row heights 58px (th 37px), compact.
- Sidebar spacing: brand-row margin 20px, nav-group margin 17px, version-card padding 12px.

### Light Theme Audit

- Which components broken? All except topbar/sidebar (those have light overrides). Specifically: all `.card`, `.dash-card`, `.orders-basic-card`, `.customers-table`, `.inventory-table`, `.analytics-kpi`, `.analytics-widget`, `.product-stat-card`, `.product-row`, `.sync-module`, etc.
- Hard-coded dark colors preventing light: `rgba(8,13,24,.36)`, `rgba(26,29,39,.94)`, `rgba(15,23,42,.93)`, etc.
- Missing light CSS variables: need --card-background-light, --border-light, --surface-hover-light, etc.
- Charts: dashboard bar chart uses `BAR_EMPTY_COLOR #6B7280` invisible on light? Should be lighter gray. Tooltip `recharts-tooltip-custom` uses var(--card) which becomes white in light -> ok but border var(--border) becomes #E5E7EB light gray good.
- Hover states: many use rgba dark.

### What Needs to Happen (Recommended Approach)

**Typography Scale Upgrade (Professional SaaS Standard):**
- Body: min 14-15px (currently 8-10)
- Labels: min 12-13px (currently 7-8)
- Small captions: 12px min (currently 6-7)
- Section titles: 16-18px (currently 13-14) — keep but bump.
- Page titles: 28-36px mostly fine (keep)
- KPI numbers: keep 24-28
- Line-height 1.5-1.6
- Letter-spacing consistent: -0.02em for headings, 0.04em for small caps maybe.

Implementation: Create CSS variables for type scale:
```
--text-xs: 12px
--text-sm: 13px
--text-base: 14px
--text-lg: 16px
--text-xl: 18px
--text-2xl: 24px
--text-3xl: 28px
```
Update all font-size usages across CSS files to use tokens.

**Spacing Increase:**
- Card internal padding: 20-24px (currently 12-18)
- Section breathing: gap 20-24px (currently 12-14)
- Table row comfort: height 64px, padding 16px
- Sidebar spacing: increase nav-item min-height 38-40px, padding 12px

Add spacing scale vars: `--space-xs: 4px, sm 8px, md 12px, lg 16px, xl 20px, 2xl 24px, 3xl 32px`.

**Light Theme Complete Rebuild:**
- Proper contrast WCAG AA minimum: text #111827 on #FFFFFF = 16:1 good, secondary #6B7280 on white = 4.5:1 ok, tertiary #9CA3AF on white = only 2.5:1 fails — need darker tertiary for light: #6B7280 secondary, #9CA3AF is actually border but used as tertiary? Light tertiary should be #6B7280? Actually need #4B5563 for better.
- Card backgrounds white with subtle shadows: `box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06)` plus border `1px solid #E5E7EB`.
- Remove all hard-coded rgba dark backgrounds, replace with `var(--card)` and `var(--card-hover)` etc.
- Icon colors adapt: use `color: var(--text-secondary)` with `background: var(--card-hover)` etc.
- Chart colors adjust: grid light #E5E7EB, text #6B7280, tooltip bg white with border, bar colors same but maybe slightly darker for light.
- Hover states both themes: use `rgba(59,130,246,.08)` works both.
- Test EVERY component in light mode.

**Design Token System:**
- Consistent CSS variables for both themes (add light vars for every color used).
- Proper color palette: Define semantic tokens: --bg-primary, --bg-secondary, --bg-surface, --bg-hover, --border-default, --border-soft, --text-primary, --text-secondary, --text-tertiary, --accent-blue, --accent-green etc.
- Elevation/shadow system: --shadow-xs/sm/md/lg, --shadow-glow preserved for dark only.
- Ensure entire app uses tokens, not hard-coded.

**Preserve Jarvis Orb:**
- Its CSS is isolated `jarvis-orb.css`, canvas rendering explicit rgba, not using vars. Ensure light-mode selectors do NOT target `[class*="jarvis"]`.

---

## 5. Risk Assessment

- **Charts fragile**: Recharts uses inline styles and hardcoded colors. Theme switching may break if tooltip background not contrasted. Risk Medium. Mitigate by CSS variable for chart colors + testing.
- **Hard-coded values**: Grep shows ~300 instances of `rgba(8,13,24`, `rgba(15,23,42`, `rgba(26,29,39`. Refactoring all to variables is large, risk missing some leads to half-broken light components. Mitigate by global search replace + manual review.
- **Products page must NOT be touched**: But its CSS lives in same `styles.css` (product-* classes 300+ lines). When we modify generic `.card` background, product cards may change unintentionally (allowed? spec says Products page NO CHANGES — skip completely. Means we must NOT modify product-specific styles nor its structure. But global card token change would affect product cards. Interpretation: Do not modify Products page functionality/UI intentionally, but fixing light theme for entire app may affect product cards background (which is necessary to make light theme usable). This is ambiguous — need clarification: does "NO CHANGES" mean zero visual change in dark theme, or zero code change? Safer to interpret as no redesign/feature changes, but light theme fix must apply to product cards too to make them visible. So we will update generic card backgrounds but keep product layout identical.
- **Testing coverage gaps**: Unit tests cover locked text expectations (will fail after fix) — 6 test files. E2E/manual theme testing not automated. Need manual checklist.
- **Dependency between fixes**: Typography scale up affects spacing — cards may overflow. Must test responsive breakpoints (1180px, 820px, 640px etc). Sort dropdown layout fix depends on typography.
- **Greeting fix**: If we only do frontend derived name, "Good morning, Commander Pilot" from domain may still be slightly URL-ish but acceptable. If merchant expects real shop name (Shopify shop.name), we need backend migration + API fetch which is out-of-scope for cleanup PR.
- **Sync All auto-dismiss**: Risk of clearing progress before user sees failure. Should only auto-dismiss after success OR after 5 sec if failed with option to keep? Proposal: auto-dismiss 4 sec after all succeeded, 6 sec after any failed, with fade.
- **Recent Activity customer names**: Fetching real orders adds extra API call on Dashboard entry, may increase latency. Should cache, limit.
- **Analytics KPI bug**: Fixing Total Customers may require backend change (analytics-insights returns totalCustomers). If backend not returning, frontend fallback to fetching customers count may be needed.

---

## 6. Recommended Fix Strategy for PR #38

**Confirm single PR?** Yes, feasible as single PR #38 if organized into ~10 commits, but large (estimated 2,500-3,500 lines changed across CSS+TSX). Alternative split recommendation: Split into 2 PRs — PR #38a Typography+Light Theme Rebuild (critical, touches all CSS), PR #38b Page-specific cleanups (Dashboard, Orders, Customers, Inventory, Analytics, global locks). However task says single comprehensive PR #38 unless strong technical reason to split. Light theme rebuild is strong reason to split because it touches every file and risks conflicts, but we can still do single PR with clearly separated commits: Commit 1 tokens + typography scale, Commit 2 light theme rebuild, Commit 3 Dashboard, Commit 4 Orders, Commit 5 Customers, Commit 6 Inventory, Commit 7 Analytics, Commit 8 Global locks/badges/icons/jargon, Commit 9 Final polish + test updates. This keeps reviewable.

**Priority order:**
1. Global Fix 1+2 (UpgradePlanButton + PlanLockedFeature) — P0, small, fixes all pages badge/lock text, unblocks other cleanups.
2. Typography & Spacing Scale (Part C) — P0 highest merchant impact. Define new CSS variables for font sizes, bump base sizes, increase card padding/gaps. Test dark only first.
3. Light Theme Complete Rebuild — P0, dependent on #2. Replace hard-coded dark rgba with variables, add extensive `.light-mode` overrides for each component file. Ensure WCAG AA.
4. Dashboard fixes (1.1 greeting, 1.2 sync auto-dismiss, 1.3-1.5 redesign) — P1.
5. Orders (3.1-3.3) — P1 small.
6. Customers (4.1-4.5) — P1 medium.
7. Inventory (5.1-5.7) — P1 large (health/value redesign).
8. Analytics (6.1-6.15) — P1 largest, includes jargon removal, KPI fixes, tooltip, empty states.
9. Global Fix 3+4+5 (icons, jargon, empty language) — can be done alongside each page but final sweep.
10. Test updates + manual QA.

**Dependencies:**
- Light theme depends on typography/spacing tokens defined first.
- Dashboard Recent Activity fetch depends on storeId available (already).
- Analytics KPI fix depends on understanding backend totalCustomers — may need backend fix in same PR or separate backend PR.

**Estimated Complexity:**
- Global Upgrade badges/locks: Low (2 files, 30min)
- Typography/Spacing: Medium (7 CSS files, needs scale definition, 4-6h)
- Light Theme Rebuild: High (7 CSS + 1 styles.css, 300+ hard-coded colors, need audit, 8-12h)
- Dashboard: Medium-High (3 components redesign, need new fetch logic, 4-6h)
- Orders: Low (2 files, 1h)
- Customers: Medium (alignment + inline badges + 6 locked, 3-4h)
- Inventory: High (3 cards redesign + 8 locked + sort, 5-7h)
- Analytics: Very High (15 issues, jargon sweep, tooltip, KPI, sparklines, empty states, 8-10h)
- Testing + polish: Medium (2-3h)

Total estimated: 35-50 hours dev + QA.

---

## 7. Testing Plan

**Unit tests needing update:**
- `apps/web/src/orders-ui.test.ts`: expects "Upgrade to Growth to unlock" → update to "Upgrade" or "Upgrade to unlock"
- `apps/web/src/customers-ui.test.ts`: same
- `apps/web/src/inventory-ui.test.ts`: same
- `apps/web/src/inventory-insights-ui.test.ts`: same (2 expects)
- `apps/web/src/analytics-ui.test.ts`: expects WEEKLY RHYTHM, SHOPPING RHYTHM, PROFITPILOT INTELLIGENCE LAYER etc — update to new simple titles or remove checks.
- `apps/web/src/dashboard-utils.test.ts`: summary generation may change structure.
- `apps/web/src/analytics-date-resilience.test.ts`: ensure date parsing still works.

**New tests to write:**
- `UpgradePlanButton` renders "Upgrade" only (no Trial)
- `PlanLockedFeature` renders "Upgrade"
- `DashboardLayout` greeting does NOT contain ".myshopify.com"
- `SyncAllProgress` auto-dismiss timer (jest fake timers)
- `InventoryStatsGrid` label "Total Products" not "Total SKUs"
- `analyticsKpis` totalCustomers fallback
- Light theme contrast: maybe axe-core accessibility test already exists `accessibility.test.ts` — extend to check light mode.

**Manual Verification Checklist (every page both themes):**
- [ ] Dashboard dark: greeting no URL, KPI cards still working, Revenue Overview toggle weekly/monthly/yearly/range still works, Daily Revenue calendar heatmap works, Store Health Performance Score unchanged, Store Summary redesigned with icons/growth, By Category pie center total + side legend + hover, Recent Activity timeline with customer names/guest + product preview + status badges.
- [ ] Dashboard light: all above visible, contrast WCAG AA, no invisible text, charts readable, tooltips white bg, hover states work.
- [ ] Sync All: click Sync All → 8 cards appear with checkmarks → auto-dismiss 3-4s fade → toast shows same duration → "Shopify data plane ready" bar stays.
- [ ] Products page: NO CHANGES dark/light visual? In dark same as before, light now visible (if light fix applied, is that considered change? Verify with product owner).
- [ ] Orders: Trial badge removed, clean Upgrade button, no overlap, package/bag icon not star, locked cards say Upgrade only, Sync Orders button still works, tabs, KPI, table, search, filters, export, pagination still work.
- [ ] Customers: AI VIP card Upgrade only, Retention Insights badge clean, 6 locked cards Upgrade only, Newest Customer dropdown aligned near CSV export, inline Growth badges changed to lock+Upgrade tooltip, Total Customers KPI etc preserved.
- [ ] Inventory: Total Products label, subtitle SKU replace, Health card modern gauge gradient, grade badge prominent, Needs attention clean, icons per metric, Value card thumbnails/percentage/bars/hover, Stock Insights star→inventory icon + badge clean, Stock Intelligence same, 8 locked cards Upgrade only, Sort dropdown single "Sort: Name" + direction toggle clean, filters/search/tabs/table/stock badges/distribution donut still work.
- [ ] Analytics: KPI sparklines meaningful with better empty, Total Customers shows real count (5), Conversion/Repeat honest empty "Requires Shopify Analytics", Revenue Momentum tooltip clean (Date, Revenue once, vs Previous, AI Forecast), VALUE×VOLUME removed, AOV tooltip explains formula, Sales by Channel/Category empty clearer with progress or upgrade CTA, AI BI simplified (no Trial Intelligence, "AI is learning" + progress bar, Confidence clarified/hidden, no jargon), Cohort locked Upgrade, Top Products empty educational, Product Insights locked Upgrade, all jargon labels removed (WEEKLY RHYTHM etc), empty state text simple actionable.
- [ ] Global: every Upgrade CTA says Upgrade only, page icons specific, no ✧+ star repetitive, no Intelligence Layer etc jargon, empty states simple actionable.
- [ ] Typography: body 14-15px min, labels 12-13px, captions 12px min, titles 16-18px, line-height 1.5-1.6, letter-spacing consistent, card padding 20-24px, section gaps 20-24px, table rows 64px comfortable, sidebar spacing increased, all pages feel premium not cramped.
- [ ] Light theme: EVERY component visible, contrast WCAG AA, card white with shadow/border, icon colors adapt, chart colors adjust, hover states work both themes, Jarvis orb same colors/size/position/animation in both themes.
- [ ] Jarvis orb: preserved (colors, size 48px FAB, position fixed right 29 bottom 25, animation idle→listening→thinking etc).
- [ ] Sidebar, top nav, working charts (Revenue Overview, Daily Revenue calendar, Stock Distribution donut, custom date range) preserved functionality.

**Theme toggle testing:**
- Toggle dark→light→dark 10 times, no flicker, no leftover dark backgrounds.
- Check every page in both themes (Dashboard, Products, Orders, Customers, Inventory, Analytics, Command Center, Recommendations, etc — even those not in scope ensure no regression).
- Check responsive: 1440px, 1180px, 900px, 720px, 640px, 420px.

---

## 8. Preservation Guarantee

Confirm understanding DO NOT TOUCH:

- **Products page** — entire page no changes. Code location `apps/web/src/products.tsx` + `products-model.ts` + `styles.css` product-* classes. We will not modify its layout, table, metrics calculation, sorting, filtering, performance gauge logic. Exception: global light theme token change may affect its background to make it visible (necessary to fix light theme broken). If strict zero change required, we would need to isolate product CSS from global card overrides — but that would leave light theme broken for Products. Needs clarification (see Questions).
- **Jarvis orb** — `JarvisOrb.tsx`, `jarvis-orb.css`, and its wrapper `.jarvis-orb-wrap` in `styles.css`. Preserve colors #A7E2FF etc gradient, size 48px/80px FAB, position fixed right 29 bottom 25, animation profile speed/pulse/brightness per state, particle count 92, tilt -.28, etc. Never modify regardless of theme.
- **Working charts**: Revenue Overview (RevenueBarChart in dashboard.tsx), Daily Revenue calendar heatmap (CompactCalendar), Stock Distribution donut (StockDistributionChart in inventory.tsx), custom date range (AnalyticsHeader period toggle custom range popover). Their data flow and functionality preserved; only styling/typography for readability and light theme may adjust.
- **KPI cards working**: Dashboard Revenue, Orders, AOV, Catalog Products (kpi-row) — keep data calculation, growth logic, icons, only typography bump allowed.
- **Store Health / Performance Score**: `HealthGaugeWidget`, `storeHealthView()` logic preserved.
- **Table structures where working**: Orders table, Customers table, Inventory table — preserve columns, sorting, pagination logic; only label text changes (SKUs→Products) and sort dropdown layout cleanup allowed.
- **Sidebar navigation**: `navGroups` in App.tsx, collapse logic, workspace-switcher, mobile backdrop — preserve.
- **Sync buttons functionality**: `syncAll()` and `sync(module)` logic preserved; only auto-dismiss behavior added (visibility state cleared after timer, not functionality).

---

## 9. Design System Recommendations

### Type Scale (Proposed)
- `--font-sans: Inter, ...` (keep)
- `--font-mono: ...` (keep)
- Scale:
  - `--text-2xs: 11px` (minimum for kicker dots maybe)
  - `--text-xs: 12px` (captions, badges)
  - `--text-sm: 13px` (labels, small body)
  - `--text-base: 14px` (body, inputs, table cells)
  - `--text-md: 15px` (body large)
  - `--text-lg: 16px` (section titles)
  - `--text-xl: 18px` (card titles)
  - `--text-2xl: 24px` (KPI values)
  - `--text-3xl: 28px` (page titles)
  - `--text-4xl: 32px` (hero)
- Line-height: `--leading-tight 1.2`, `--leading-normal 1.5`, `--leading-relaxed 1.6`
- Letter-spacing: `--tracking-tight -0.02em`, `--tracking-normal 0`, `--tracking-wide 0.04em`, `--tracking-wider 0.08em` for mono uppercase.
- Font weights: 400 normal, 500 medium, 600 semibold, 700 bold, 800 extrabold for numbers.

### Color Palette (Both Themes)

Dark (keep existing but document):
- Background: #0F1117
- Card: #1A1D27, Card Hover #22262F
- Border: #2A2E38, Border Soft rgba(120,133,157,.16)
- Text: #F9FAFB primary, #9CA3AF secondary, #6B7280 tertiary
- Accents: Blue #3B82F6 / #72A7FF bright, Green #10B981, Amber #F59E0B, Red #EF4444, Profit #FBBF24, Purple #9B7CF6, Cyan #57C6E9

Light (complete rebuild):
- Background: #FAFAFA or #F8FAFC (slightly blue gray)
- Card: #FFFFFF
- Card Hover: #F3F5F8
- Border: #E5E7EB, Border Soft rgba(17,24,39,.08) or rgba(44,62,89,.12)
- Text: #111827 primary, #4B5563 secondary (darker than #6B7280 for AA), #6B7280 tertiary? Actually tertiary should be #6B7280 but need 4.5:1? #6B7280 on white is 4.5:1 passing AA for normal? Check: #6B7280 contrast 4.6:1 passes. #9CA3AF fails (2.5:1) — avoid for text, use only for disabled/border.
- Accents same but maybe slightly darker for light: blue #2563EB more saturated.
- Profit gold #D97706 darker for light theme readability.

### Spacing Scale
- `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`, `--space-10: 40px`, `--space-12: 48px`
- Card padding: 20px → 24px desktop, 16px mobile.
- Section gap: 20-24px (was 12-14)
- Table cell padding: 12px 16px (was 10-11px 12px)
- Table row height: 64px min.
- Sidebar: nav-item min-height 40px, gap 8px.

### Shadow / Elevation
- Dark: keep existing --shadow-sm/md/lg with black 0.5-0.7 opacity, plus glow.
- Light: --shadow-sm: 0 1px 2px rgba(17,24,39,.06), --shadow-md: 0 4px 6px rgba(17,24,39,.07), --shadow-lg: 0 10px 15px rgba(17,24,39,.08)
- Elevation for cards: border 1px solid var(--border) + shadow-sm.

### Component Consistency
- Buttons: min-height 36-40px (was 34px small), font 13-14px, gap 8px, border-radius 8px.
- Badges: padding 4px 8px, border-radius 999px, font 11-12px mono uppercase, letter-spacing .04em.
- Cards: border-radius 12-16px, padding 20-24px.
- Inputs: height 36-40px, font 14px, border-radius 8px.
- Tooltips: bg var(--card) inverted? dark bg #171A23 for dark, white for light with border + shadow-md, font 12-13px, padding 8-12px.

---

## 10. Questions / Ambiguities

1. **Products page NO CHANGES**: Does light theme rebuild count as change to Products? Products page light theme is currently unusable (invisible). If we must leave it exactly as is, light theme will remain broken for Products, violating Part C requirement "Test EVERY component in light mode" and "No component should look broken". Clarify: Are we allowed to fix Products card backgrounds to make light theme visible while keeping layout/functionality identical? Or must we strictly not touch any product-related CSS even if light broken?

2. **Greeting store name**: Do we have permission to add backend endpoint to fetch Shopify `shop.name` (requires Shopify API call with token) and store in DB? Or should PR #38 be frontend-only derived name (e.g., "Commander Pilot" from domain) to remove URL? Long-term, real shop name would be more professional.

3. **Recent Activity customer names**: Analytics aggregates lack customer PII by design. To show customer names we need to call `fetchOrders` for last 5 orders. Is extra API call on Dashboard acceptable? Should we add prop `recentOrders` to DashboardPage from App's `fetchOrders` or fetch inside DashboardLayout? Also privacy: Customer names are PII, is it allowed to show on Dashboard Recent Activity? Probably yes (Orders page already shows).

4. **Store Summary redesign data**: Current summary is plain text from `generateSummary()` which uses totalRevenue, orders, discounts etc. For professional redesign with icons/growth indicators, should we reuse existing KPI growth calculations (`calculateGrowth`) or need new backend insights? Keep frontend only?

5. **Inventory Value thumbnails**: Type `TopValueItem` lacks imageUrl. To add thumbnails, need to enrich API or join with `InventoryRowItem` which has imageUrl. Should we modify backend to include imageUrl in topValueItems, or frontend join via variantId? Frontend join is okay but may miss some.

6. **Analytics Total Customers bug**: Should fix be backend (`analytics-insights.ts` should count from customers table, not just cohorts) or frontend fallback? Backend fix may be separate PR. For PR #38, implement frontend defensive fallback (if totalCustomers null, fetchCustomers count) OR fix backend in same PR (requires API change). Which approach?

7. **Jargon removal scope**: Some jargon comes from API messages (e.g., forecast message "Preparing your first evidence-based forecast." is from backend). Should we also update backend messages to remove jargon in same PR, or frontend replace with user-friendly copy? Task says app-wide search and simplify, implies backend too.

8. **Upgrade CTA wording**: Spec says just "Upgrade" or "Upgrade to unlock". Should we use "Upgrade" everywhere for consistency, or "Upgrade Plan" for badge and "Upgrade to unlock" for locked cards? Need final copy decision.

9. **Light theme implementation**: Should we use CSS `prefers-color-scheme` media query as well, or only via `.light-mode` class toggle? Currently only class toggle via state. Keep class toggle? Also need to persist theme preference (localStorage)?

10. **Single PR risk**: Given size, do reviewers prefer single PR #38 with 10 commits or split into 2 PRs (theme+typography vs page cleanups)? Task says single unless strong reason — we identified strong reason (light theme touches all files) but can still be single with clear commits. Confirm preferred approach.

11. **Testing coverage**: Existing vitest tests expect old strings. Should we update tests in same PR #38 or separate? Updating tests in same PR is necessary to keep CI green.

---

## 11. Final Deliverable Checklist for PR #38 Implementation (future)

When implementation starts, ensure:

- [ ] File-level changes listed above covered.
- [ ] No Products page functional change (only light visibility if allowed).
- [ ] Jarvis orb untouched (verify via visual diff).
- [ ] All locked texts say "Upgrade".
- [ ] No Trial text anywhere.
- [ ] No jargon labels.
- [ ] Typography scaled up (body 14-15px min).
- [ ] Spacing increased.
- [ ] Light theme WCAG AA contrast, every component visible both themes.
- [ ] Sync All cards auto-dismiss 3-4s fade.
- [ ] Greeting no URL, professional gender-neutral.
- [ ] Store Summary redesign with icons/growth.
- [ ] By Category pie center total + side legend + hover + Top highlight.
- [ ] Recent Activity timeline with customer names/guest + product preview + badges.
- [ ] All pages pass manual checklist (both themes).
- [ ] Tests updated.

---

## Appendix — Key Code References (for implementer)

- Greeting: `apps/web/src/App.tsx:432`
- Sync progress: `App.tsx:150-210, 447-460`, `styles.css: .sync-all-progress`
- Store Summary: `dashboard.tsx:314-336`, `dashboard-utils.ts: generateSummary()`
- Pie: `dashboard.tsx: CategoryPieChart ~250 lines`, `dashboard.css: .pie-container`
- Recent Activity: `dashboard.tsx: OrderRow ~530`, `dashboard-utils.ts: buildRecentOrders()`
- Upgrade badge: `UpgradePlanButton.tsx:2-5`
- Locked: `orders.tsx: PlanLockedFeature 217-223`, `customers.tsx: CustomerRow 181`, `inventory.tsx: DaysOfCoverCell 445`, `analytics.tsx: LockedWidget 121, LockedInline 122`
- Analytics KPIs: `analytics-model.ts: analyticsKpis() ~60-120`, `analytics.tsx: KpiCard 30-50, RevenueTooltip 193, OrdersAOVCorrelation eyebrow 97, AIIntelligence 103, TemporalPatterns 112, ConversionFunnel 114`
- Theme tokens: `styles.css: :root 1-51, .light-mode 51`, all other CSS files hard-coded rgba search `grep -R "rgba(8,13,24" apps/web/src/*.css`
- Products forbidden: `products.tsx` entire file.

---

**End of Investigation Report — Ready for review before PR #38 implementation.**
