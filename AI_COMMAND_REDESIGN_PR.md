# AI Command — Ultra-Professional Redesign

> The most important module of ProfitPilot AI, rebuilt from a basic demo into a
> premium, enterprise-grade command center — with a perfect light theme, a
> strict store-only scope, and zero fake data.

## Summary

This PR transforms **AI Command** into an ultra-professional assistant that
merchants feel they are paying premium for. It touches **only AI Command**
(`apps/web/src/ai-command*`, `apps/api/src/ai-command-*`, `packages/ai/src/command.ts`).
No other module was changed.

### What changed

**1. Complete visual redesign (both themes)**
- Full-height, elegant chat container with refined dark palette (`#0F0F0F` base,
  `#1A1A1A` panels, purple `#8B5CF6` accent) and a rebuilt **light theme**
  (`#FFFFFF` / `#FAFAFA`, visible `#E5E7EB` borders, `#7C3AED` accent) that is no
  longer pastel or washed-out.
- Premium welcome screen with an AI glow icon, a categorized capability showcase
  (Store Analytics, Customer Insights, Inventory, Recommendations, Store Actions),
  popular-question chips, and a plan-status footer.
- Message bubbles with elegant avatars, subtle timestamps, smooth rise-in
  animation, hover copy/regenerate/feedback actions, and 12px+ typography.
- Prominent composer with a focused input, character counter, keyboard hints,
  a gradient send button, and **categorized tab-style quick commands**
  (Analytics / Customers / Products / Growth / Actions).
- Persistent **plan status bar** (plan, commands used, actions locked/unlocked)
  with `Upgrade Plan` CTA.
- Rich data display: revenue/orders/AOV metric cards with period-over-period
  change, a store-health ring gauge, and a polished data table for lists.
- Animated thinking/loading state with a step list and streaming partial text.

**2. Store-only scope (critical)**
- New `detectOffTopic()` gate in `packages/ai/src/command.ts` runs before any
  tool call and politely refuses off-topic questions (weather, poems, coding,
  politics, health, legal, "are you ChatGPT?", etc.), redirecting to store help.
- `STORE_SCOPE_GUIDANCE` added to the system prompt so the LLM path (when
  configured) enforces the same boundary.
- Store questions that mention Shopify/store/customers/products/etc. are always
  kept in scope (e.g. "help me code a Shopify theme" is not treated as general
  coding).

**3. Honesty invariants preserved & extended**
- All responses continue to come from real Shopify tool results; no fabricated
  numbers, no fake success. The new "Your activity" panel reports **real**
  command/action/conversation/saved counts — nothing estimated.

**4. Plan gating unchanged & enforced**
- Trial/Start/Growth stay info-only; actions remain Commander-only with the
  existing preview → approve flow. All CTAs say **"Upgrade Plan"** (never a
  named tier).

## Files changed

| File | Change |
| --- | --- |
| `packages/ai/src/command.ts` | Store-scope gate (`detectOffTopic`, `renderOffTopicResponse`, `STORE_SCOPE_GUIDANCE`), `offtopic` content type, system-prompt scope rules |
| `packages/ai/src/command.test.ts` | Tests for off-topic detection, refusal rendering, and service-boundary refusal |
| `apps/web/src/ai-command.tsx` | Full component redesign: welcome, plan bar, message bubbles, rich data, quick commands, activity panel |
| `apps/web/src/ai-command.css` | Full theme-adaptive CSS rewrite (dark + light) |
| `apps/web/src/ai-command-model.ts` | `offtopic` content type + quick-command category helper |
| `apps/web/ai-command-preview.html` | Standalone dark/light visual preview (not shipped in the bundle) |

## Testing

- Full suite: **172 files / 1868 tests pass**, including the 23 AI Command
  service tests, UI snapshot tests, and API route tests.
- `typecheck` passes for all packages.
- Existing strings preserved (`Welcome to AI Command`, `One command controls
  everything`, `Type your command`, `Upgrade Plan`) so no regressions in the
  UI contract.

## Manual verification

Open `apps/web/ai-command-preview.html` (or the included live preview) to see
the welcome screen and an example exchange in **both** dark and light themes.

## Out of scope (intentionally untouched)

AI Command Center, Recommendations, Automation, Store Coach, AI Executive,
Insights Hub, and every other module.
