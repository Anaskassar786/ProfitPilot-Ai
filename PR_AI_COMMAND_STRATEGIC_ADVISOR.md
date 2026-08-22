# feat(ai): transform AI Command into dynamic strategic advisor with human-readable UI

## Summary

Overhauls the AI Command chat (`/ai-command` & `/command`) from a robotic
metric-dumper into an expert e-commerce growth consultant and action engine.
Every answer is grounded in the store's live data, but now it synthesises that
data into advice, prioritised recommendations, executive takeaways, step-by-step
guidance, and clean enterprise-SaaS attribution — instead of bare numbers and
raw database labels.

## 1. 🛑 Eliminated raw developer/database labels (UI clean-up)

- New `humanizeSource()` / `humanizeSources()` (single source of truth in
  `packages/ai/src/command.ts`, mirrored in the web model) maps every internal
  data-feed identifier to a polished merchant-facing badge:
  - `analytics_revenue_daily` → **📊 Live Analytics Sync**
  - `sync_records.customers` → **👥 Verified Customer Data**
  - `sync_records.orders` → **🧾 Verified Order Data**
  - `catalog_products + analytics_product_sales_daily` → **📦 Inventory & Sales History**
  - `inventory_levels` / `variant_inventory_quantity` → **📦 Inventory & Sales History**
  - `ai_recommendations` → **💡 AI Growth Recommendations**
  - `analytics + inventory` → **✨ Verified Store Data**
  - `automation_workflows` → **⚙️ Automation Engine**
- `apps/api/src/ai-command-runtime.ts` no longer emits any raw table name — every
  `ok()` call now returns a clean badge, and the dynamic inventory
  `quantitySource` is funnelled through `humanizeSource`.
- The chat renderer (`apps/web/src/ai-command.tsx`) renders a new `SourceBadge`
  chip (with a verified-data shield icon) instead of `Source: analytics_revenue_daily`.
- Verified: zero occurrences of `analytics_revenue_daily` / `sync_records` / etc.
  in any chat output (covered by tests).

## 2. 🧠 Dynamic intent-based response engine

The system prompt (`buildSystemPrompt`) is rewritten to an expert consultant
persona that classifies every question into one of four intents:

- **INTENT A — Strategic / advisory** (`"How can I increase profit?"`,
  `"mai profit kaise increase kro"`): `formatGrowthAnswer` was rebuilt to produce
  a cross-workspace situational read + **3 specific, data-backed recommendations**
  (dead stock, at-risk customers, low/out-of-stock, repeat rate, revenue
  direction, pending recs), each with a real number and a one-click CTA.
  Growth intent detection now covers `profit`/`margin` and romanised Hindi.
- **INTENT B — Performance summary / trend** (`"Summarize this week"`,
  `"Show revenue trend for last 6 months"`): analytics answers now end on a
  **Key takeaway** + **Next logical step** and carry `trend` / `keyTakeaway` /
  `nextStep` for the UI callout. Summary/trend queries route to analytics-led
  answers.
- **INTENT C — Instructional / how-to** (`"How do I set up an automated email?"`,
  `"What can PatternAI do?"`): new `detectInstructionalIntent` +
  `formatInstructionalAnswer` deliver numbered, plan-aware steps with
  **navigation CTAs** (e.g. *Go to Automation gallery* → `/automation`).
- **INTENT D — Action commands**: preserved preview→approve flow (Commander) and
  the *Upgrade Plan* path (other tiers).

## 3. 💬 Natural, expert tone + 🔗 cross-workspace intelligence

- Persona/tone guidance added to the prompt (AOV, LTV, retention, CAC, stock
  cover; Markdown formatting; no canned repeats).
- Growth queries now pull analytics + customers + inventory + products +
  recommendations + health and synthesise them (e.g. *"$44,730 across 11 orders
  …, but 2 of 8 customers are at risk of churning and 6 variants are low-stock"*).

## UI surfaces (`ai-command.tsx` + `ai-command.css`)

- `SourceBadge` attribution chip.
- Growth **recommendation cards** (numbered title + detail + CTA).
- Analytics **takeaway callout** (up/down/flat accent).
- **Instructional how-to card** with numbered steps + navigation/command CTAs.
- Navigation plumbed `App → AiCommandPage → AiCommandWorkspace → MessageBubble`.

## Testing

- Added 8 new tests in `packages/ai/src/command.test.ts` covering source
  humanization, the 3-recommendation growth plan (no raw labels), instructional
  detection + rendering, growth-vs-instructional routing, and the INTENT B
  takeaway. **51/51** command tests pass; **374/374** AI package tests pass.
- `apps/api/src/ai-command-runtime.test.ts` (3) and the broader command/runtime
  surface remain green. Web typecheck and full workspace build pass.
- No new test regressions: the only failing tests in the repo are pre-existing
  (Polaris `AppProvider` environment issues in a handful of web tests, and one
  pre-existing SSE streaming test) — confirmed identical on the base branch.

## Files changed

- `packages/ai/src/command.ts` — system prompt, intent detection, growth plan,
  instructional answers, source humanization, analytics takeaway.
- `packages/ai/src/command.test.ts` — new + updated coverage.
- `apps/api/src/ai-command-runtime.ts` — clean badge sources.
- `apps/web/src/ai-command.tsx` — SourceBadge, recommendation cards, takeaway
  callout, instructional card, navigation plumbing.
- `apps/web/src/ai-command-model.ts` — `humanizeSource`.
- `apps/web/src/ai-command-page.tsx`, `apps/web/src/App.tsx` — navigation wiring.
- `apps/web/src/ai-command.css` — new component styles (theme-scoped).
