# AI Command — conversation value and real-data hardening

## What changed

- Replaced the sparse post-send state with five persistent sections:
  - contextual **Continue exploring** suggestions;
  - four **Quick insights** cards;
  - an eight-item **Popular commands** grid;
  - a deterministic daily **AI tip**;
  - the existing real seven-day usage activity.
- Enhancements remain visible while a command is thinking, so the conversation surface no longer collapses into empty space.
- Added `GET /ai-command/suggestions` and `GET /store/quick-insights`.
- Quick insights query the existing production analytics, inventory, and health tool runtimes. Missing data is represented as `null` and rendered as “No data yet” / sync guidance; no merchant metric has a display fallback.
- Added current-versus-previous order counts to the analytics runtime.
- Added a 30-second client timeout and server-side disconnect signal. A cancelled stream is not saved and does not consume command quota once cancellation is observed.
- Cancel now leaves an explicit cancelled message in the local conversation.
- Enforced the 2,000-character limit in both the textarea and API. The API rejects oversized commands rather than silently truncating them.
- Removed the non-functional attachment control.

## Existing real-data paths verified

- Daily and weekly command counts: `ai_command_usage` via `getUsage` / `listUsage`.
- Actions: `ai_command_usage.actions_executed`.
- Recent conversations: `ai_command_conversations`.
- Saved commands: `ai_command_saved_commands`.
- Time saved: explicitly labelled estimate, calculated as real weekly commands × 3 minutes.
- Usage chart: real `ai_command_usage` rows; absent days are zero.
- Revenue/orders: `analytics_revenue_daily` / analytics snapshots.
- Inventory: synced inventory repository.
- Store health: calculated from synced analytics and inventory.

## Verification

- Production workspace build passed for all 19 projects.
- AI Command focused suites pass (API, service, model, UI, enhancements): 55 tests.
- Full suite result: 2,479/2,480 pass. The sole unrelated pre-existing Command Center fixture mismatch expects 7 Inventory Agent insights while its fixture currently renders 5; AI Command changes do not touch that module.
