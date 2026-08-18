# PR #51 — AI Command Complete Build

## Summary

Redesigns Copilot into **AI Command**, a professional command center for natural-language store questions and Commander-only approved actions. Removes Campaigns from the sidebar and routes while preserving campaign data and backend email infrastructure.

## Why

The previous Copilot surface was a closed 10-intent Q&A box with no actions, weak contrast, and no plan enforcement. Merchants needed one place to query every module and execute safe work without fake success.

## What changed

- New schema (`0021_ai_command.sql`): conversations, actions, saved commands, usage, preferences, RLS.
- `@profitpilot/ai` command engine: plan limits, blocked-action policy, deterministic tools, approval + 30s undo, honest results.
- API under `/ai-command/*` with SSE chat streaming.
- Frontend extracted to `ai-command.tsx` / model / hooks / CSS (dark + light, 12px+ type).
- Sidebar: Campaigns removed, Copilot renamed to AI Command with AI + NEW badges.
- Old `/campaigns` and Copilot hashes redirect to AI Command.

## Safety

- Zero fake success. Partial email sends report exact backend counts.
- Merchant approval required before any write.
- Upgrade CTAs always say “Upgrade Plan”.
- Destructive actions (delete, refund, bulk price/inventory, billing, settings) are refused with a manual-page alternative.
- Jarvis orb is untouched. No voice in this PR.

## Test plan

- `corepack pnpm test` — command engine, API routes, UI model/welcome state, migrations.
- Trial 10/day 402, Growth write → upgrade, Commander preview → approve → partial failure.
- Dark + light readability on empty state, tables, action preview.
- Campaigns no longer in sidebar; campaign tables still exist.

## Out of scope

AI Command Center (PR45), Automation, Recommendations, Store Coach, AI Executive, Insights Hub, Jarvis voice.
