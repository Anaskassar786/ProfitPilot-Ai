# AI Command — Final Production Audit

**Date:** 2026-08-19

**Scope:** AI Command page, command engine, plan behavior, read tools, Commander actions, action safety, API routes, persistence, usage, settings, and UI controls.

## Result

AI Command now passes the complete repository test suite and the focused AI Command sweep:

- **Full repository:** 204 test files, **2,566 tests passed**, 0 failed
- **Focused AI Command/Command Center:** 8 test files, **103 tests passed**, 0 failed
- **Monorepo typecheck:** passed for all 19 workspace projects
- **Production build:** passed for all 19 workspace projects
- `git diff --check`: passed

## Primary reported defect — fixed

### Before

`Help me increase sales` contained the word `sales`. The intent router selected `get_analytics` first, then skipped the growth branch because a tool had already been selected. The result was effectively the same revenue response the merchant had just received.

### Now

Growth intent is resolved before generic sales analytics. The following variants are covered:

- `Help me increase sales`
- `Help me increasing sale`
- `Show growth opportunities`
- `How can I grow revenue?`

A growth request now queries four grounded signals:

1. Analytics
2. Pending recommendations
3. Store health
4. Inventory risk

The response is a dedicated `growth_plan`, with live signal cards, prioritized next steps, source attribution, and no repeated revenue-only answer.

## Plan behavior

| Plan | Growth result | Store-changing actions |
|---|---|---|
| Trial | Grounded insight-only plan | Blocked |
| Start | Grounded insight-only plan | Blocked |
| Growth | Grounded insight-only plan | Blocked |
| Commander | Grounded, action-ready plan | Preview → explicit approval → verified result |

Commander growth responses expose safe action choices such as preparing a VIP email, a bounded discount, or a pending recommendation approval. Nothing executes from the growth question itself. A separate preview is always shown and explicit merchant approval is still mandatory.

`AI_COMMAND_ACTIONS_ENABLED=false` is now a real global kill switch. Commander users see “temporarily unavailable,” not a false upgrade message.

## Safety and consistency fixes

- Empty recipient/customer/workflow/recommendation targets no longer produce an Approve button.
- Approval is a database compare-and-set from `PENDING` to `EXECUTING`; double clicks execute once.
- Cancellation is an atomic pending-state transition.
- Undo atomically consumes the rollback window; concurrent rollback requests execute once.
- Command quota is reserved atomically, preventing concurrent requests from exceeding Trial/Start/Growth limits.
- Cancelled information requests release their reserved quota.
- Action state is persisted even if the SSE client disconnects after a preview or execution has already been durably created.
- Successful/partial actions count exactly once; cancel is not misreported as an executed action.
- Direct Approve/Cancel/Undo API calls append a result to conversation history and settle the old preview state.
- A failed tenant-scoped database operation is no longer retried outside its transaction, preventing duplicate writes and tenant-scope weakening.
- Unsupported numerical claims are no longer returned with a misleading “removed” notice.
- Synced ISO currency is used for revenue/AOV. If currency is unavailable or mixed, the UI says so instead of silently assuming USD.
- The discarded OpenRouter request was removed from the production command path. It added latency and a failure point while its output and tool calls were never used.

## Read-tool fixes

- “Best customers” now resolves semantically and sorts real spend/order data.
- Inactive/churn, repeat, new-buyer, and explicit remembered-customer requests are handled distinctly.
- Best-selling and underperforming products are ranked from `analytics_product_sales_daily`, joined to the real catalog.
- Highest-value/recent/today order requests use semantic filters and sorting.
- Analytics current/prior windows are exact and non-overlapping; `1d` means today versus yesterday.
- Growth references respect the configured memory switch and Growth’s 24-hour memory window.

## UI/button audit

Verified and/or fixed:

- New Chat
- History open/close
- Settings open/close
- Composer send and Enter/Shift+Enter behavior
- Suggestions and category tabs
- Quick commands and all welcome/template/follow-up cards
- Approve
- **Edit** (was a dead button; now cancels the old preview and returns the originating command to the composer)
- Cancel
- Undo countdown/action
- Copy/share/regenerate
- Helpful/not-helpful feedback (now persisted; previously toast-only)
- Save command (now saves the merchant command, not the assistant’s answer)
- Run/delete saved command
- Open/archive/delete/clear history
- Growth/Commander conversation export
- Upgrade Plan CTAs
- Showcase carousel controls
- Response style, thinking animation, quick commands, suggestions, conversation references, and action notification settings

The UI now honors all preference toggles. Archived conversations are hidden from the active list and are read-only. Async delete/archive/settings/export failures are caught and shown as user-facing errors instead of unhandled promises.

## API endpoint sweep

The focused HTTP test exercises successful and invalid paths without a 500 for:

- Chat JSON and SSE
- Conversation list/get/delete/archive/export
- Message feedback
- Action list/get/approve/cancel/rollback
- Saved command list/create/execute/delete
- Usage and usage history
- Preferences get/patch
- Quick commands
- Suggestions
- Quick insights

Expected validation, limit, not-found, conflict, and upgrade outcomes use typed 4xx responses. Storage/dependency failures use typed 503 responses.

## Additional regression hardening

The AI Command Center functional fixture previously assumed seven recommendations would always remain on the same UTC day. It failed during early UTC hours. The assertion now derives the real UTC-today count, removing the time-of-day flake without changing production behavior.

## Final verification commands

```bash
corepack pnpm test -- --reporter=dot
corepack pnpm typecheck
corepack pnpm build
```

All passed on this branch.
