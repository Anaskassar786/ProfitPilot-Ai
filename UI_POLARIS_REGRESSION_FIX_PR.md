# fix(ui): repair Polaris locked cards, double filter labels, and broken template text

## Summary

After the Polaris migration, the shared `Button` shim (`polaris-ui.tsx`) flattened **every** button's children into a Polaris `icon` + string label. That destroyed composite controls app-wide:

- Filter tabs rendered the label twice and mashed the count into it: `All Items All Items27`, `All Orders All Orders11`, `New New9`.
- Locked AI feature cards became one concatenated text run: `Dead Stock DetectorUpgrade to unlock`, `Peak Order TimesUpgrade to unlock`.
- Automation template cards collapsed into title soup: `Start planSales & GrowthAbandoned Checkout RecoveryWait before sending…`.
- Sidebar/topbar composites (`workspace-switcher`, `command-trigger`, `top-search`, `profile-button`, `nav-item`, …) lost their content structure **and** their CSS classes (the shim also drops `className`).
- The shared `UpgradePlanButton` was squeezed into a 28–30px icon-only pill by `> button { width: 28px }` header-action rules.

**Root cause:** the `Button` shim's `nodeText()`/`firstElement()` logic is only valid for simple icon + short-label buttons. This PR adds a `RichButton` (built on Polaris' `UnstyledButton`, so it stays Polaris-native: real `<button>`, keyboard accessible, no text flattening) and moves every composite control onto it. Frontend-only — no billing, entitlement, plan-limit, or data changes.

## Changes

### Shared layer
- **`polaris-ui.tsx`** — new `RichButton`: renders Polaris `UnstyledButton`, passes `children` + `className` + ARIA/data attributes straight through. Simple buttons keep using `Button` (icon + text, Polaris chrome).
- **`UpgradePlanButton.tsx`** — label always visible (`Upgrade Plan`); output wrapped in a classed `.upgrade-plan-button-wrap` so header-action rows can never collapse it; `className` prop now actually applies.

### Inventory
- Filter tabs render one label + one count badge (`All Items` + `27`), active state styled via `.active` class (which now reaches the DOM).
- Stock Intelligence / Stock Insights locked cards (`PlanLockedFeature`) get a readable shell: lock icon, feature name, tagline, and an explicit `Upgrade` pill — no concatenated text.
- Header `UpgradePlanButton` no longer cramped.

### Orders
- `OrderTabs` single label + count (`All Orders` + `11`, `New` + `9`, …).
- Locked AI insights (`Peak Order Times`, `Repeat Customers`, …) and Commander capability locks are proper cards (2–4/2/1 responsive grid), with horizontal icon + text + CTA layout in the Commander row.

### Customers
- AI retention locked insights now render in a comfortable 2-column grid (1 column on small phones); VIP intelligence card shows `AI VIP customers` / `Upgrade to unlock` / `Upgrade` cleanly separated.

### Automation
- Featured/popular template cards restored to full hierarchy: icon + plan badge → category → title (`headingSm`) → description (muted body) → impact copy; footer keeps `Quick setup · N steps` + aligned `Set Up` / `Upgrade Plan` CTAs with their custom classes applied.
- Status filter tabs (`All` + count, `Active` + count, …) no longer double-render.
- Workflow card name/body buttons, create-modal mode cards, plan-banner CTAs all render their real content.

### App-wide
- Same composite-button fix applied to the sidebar/topbar (brand lockup, workspace switcher, command/search triggers, nav items, notification badge, profile button, help link) — restoring active states and layout.
- Recommendations status tabs (`ALL`, `EXECUTED`, …) fixed the same way.
- Light-theme overrides for locked-card text/CTA contrast added.
- New regression test `polaris-ui-regression.test.tsx` pins the DOM contracts (no duplicated labels, no concatenated lock text, template card hierarchy).

## Verification

- `pnpm build` ✅
- `pnpm typecheck` ✅
- `vitest`: no new failures; 12 previously failing UI tests now pass (e.g. `orders-ui` locked-metadata render, `customers-ui` premium-section locks, `inventory-insights-ui` locked CTAs, `automation-ui` template card copy), plus 5 new regression tests.
- SSR/DOM checks confirm the exact structures:
  - Tabs: `<button class="active" role="tab" aria-selected="true"><span>All Items</span><strong>27</strong></button>`
  - Locked card: separate `strong` (name), `small` (tagline), `.plan-locked-cta` (Upgrade) nodes — no `NameUpgrade` runs.
  - Template card: `.template-card-top` (icon + plan badge), `.template-category`, `h3.template-name`, `p.template-description`, footer `Set Up`/`Upgrade Plan` buttons.

> Note on screenshots: the app renders inside the Shopify embedded admin behind OAuth, which this sandbox cannot open headlessly. The before/after is documented at the DOM level above; every changed region is covered by the existing functional UI suites.

## Rules respected

- Frontend only; no billing/entitlement/plan-limit/logic changes; counts unchanged (still real backend numbers).
- Polaris components/tokens kept (`UnstyledButton` is Polaris; `Button` shim untouched for simple buttons); the pre-Polaris sidebar design system is not re-introduced.
- Locked features remain visible (blurred teaser + clear upgrade CTA), never hidden.
- Accessibility: real `<button>`s, `aria-label`/`aria-selected`/`role` preserved, focus-visible outlines.
