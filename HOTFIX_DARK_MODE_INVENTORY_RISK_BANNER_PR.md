# PR: fix(analytics): fix dark mode contrast on inventory risk warning and audit tracking state

**Date:** 2026-08-22 · **Scope:** Analytics "Inventory Risk" widget (frontend CSS + widget state audit) — no billing, no GDPR, no schema changes.

## Root cause

1. **White box in dark mode.** The "Inventory tracking is disabled" warning on
   the Analytics → Inventory Risk card renders a Polaris `<Banner>` inside the
   dark stock-out card. The embedded app runs Polaris with its **default light
   tokens** (the `AppProvider` never enables a dark theme), so the banner
   resolves:
   - `--p-color-bg-surface` → **pure white `#FFFFFF`** on the banner root
     (`Polaris-Banner`),
   - a solid amber `--p-color-bg-fill-warning` title strip,
   - an **uncolored content area** that then inherits the app's near-white
     `:root` text color (`rgb(249, 250, 251)`) — a white box with white text.
2. **Logic audit.** The "tracking disabled" state only checked
   `trackedSkus === 0`. A store can carry real stock data — inventory level
   rows in `sync_records` or variant `inventory_quantity` — while no variant
   payload happens to include `inventory_management`; those stores were wrongly
   blocked behind the warning instead of seeing the Out-of-stock / Low-stock /
   Healthy SKUs grid.

## What changed

### 1. Theme-aware warning banner — never a white box (`apps/web/src/analytics.css`, `apps/web/src/analytics.tsx`)

- Kept the native Polaris `<Banner tone="warning">` and themed it explicitly
  per mode (the repo-wide pattern used by `automation.css`):
  - **Dark mode:** dark translucent caution surface
    (`rgba(251, 191, 36, 0.12)` over the dark card) with high-contrast light
    text — amber title (`rgb(253, 230, 138)`), light-grey body
    (`rgb(226, 232, 240)`), amber icon. The white `Polaris-Banner` root,
    the Polaris bevel pseudo-element, and the light-token drop shadow are
    neutralised (`background-color: transparent`, `box-shadow: none`,
    `::before { box-shadow: none }`).
  - **Light mode:** soft amber/yellow surface
    (`var(--p-color-bg-surface-caution, rgb(255, 248, 219))` — tokenized with
    a hard fallback) with crisp dark text.
- Banner copy now carries the exact guidance: *Enable 'Track quantity' in your
  Shopify admin → Products to unlock stock-out risk analytics.*

### 2. Audited "Inventory tracking is disabled" condition (`apps/web/src/analytics-widgets-model.ts`)

The warning now only triggers when **all three** hold:

- the synced catalog has SKUs (`totalSkus > 0`),
- **100 %** of them are untracked (`trackedSkus === 0`),
- **and Shopify delivered no live stock signal**: no inventory level rows in
  `sync_records` (`coverage.levelRowCount === 0`) and no variant-level
  `inventory_quantity` on the payload.

`coverage.levelRowCount` is computed server-side from the **full** dataset
(`apps/api/src/inventory.ts`), so it stays reliable even though the Analytics
page only fetches 50 rows. A store with synced levels — even when every variant
payload lacks `inventory_management` — now renders the real metrics grid
(Out of stock / Low stock / Healthy SKUs) instead of the warning.

`apps/api/src/analytics-insights.ts` was reviewed and requires **no change**: it
contains no inventory-tracking state (revenue/order insights only); the
tracking signal already flows from `sync_records` through the inventory
repository (`coverage.levelRowCount`, `quantitySource`) into the widget model.

## Tests (`apps/web/src/analytics-widgets.test.tsx`)

- New `stockRisk` cases: synced level rows → grid (no warning); variant
  `inventory_quantity` → grid (no warning); empty variant quantity + no levels
  → warning stays.
- New render case: store with `levelRowCount > 0` renders the metrics grid and
  **never** renders `risk-untracked-empty` / "Inventory tracking is disabled".
- Existing all-untracked warning contract unchanged (banner copy, no fake zero
  grid, no upsell CTA).

## Verification

- `pnpm build` — ✅ (web: 2017 modules transformed)
- `pnpm typecheck` (all 20 workspace projects) — ✅ clean
- `pnpm vitest run` analytics + inventory + polaris-ui-regression suites —
  ✅ 114/114 pass (new tests included)
- Full-suite failures (32 unrelated files: patternai/support/automation/
  recommendations, etc.) are **pre-existing** — reproduced identically on the
  pristine `751496d` tree.
