# AI Command

AI Command replaces Copilot as the merchant command surface. One command can query every module and, on Commander, preview then execute safe actions.

## What merchants can do

- Ask questions about customers, products, orders, inventory, analytics, recommendations, and store health.
- Ask for growth help and receive a distinct multi-signal growth plan built from analytics, recommendations, health, and inventory (never a repeated revenue response).
- Receive structured tables grounded in live Shopify sync data.
- On Trial, Start, and Growth: receive insight-only growth next steps.
- On Commander: use action-ready growth controls to preview emails, tags, discounts, recommendation approvals, workflow triggers, notifications, and reports.
- Approve, edit, cancel, or undo reversible actions within 30 seconds. Action results are appended to the conversation and duplicate approval clicks are rejected atomically.
- Save frequent commands, export eligible conversations, archive history, and persist helpful/not-helpful feedback.
- Configure response style, quick commands, suggestions, thinking animation, conversation references, and action-completion notifications.

Nothing is invented. Empty action targets never get an Approve button. If a backend call fails, AI Command reports the failure with the real error. `AI_COMMAND_ACTIONS_ENABLED=false` is a production kill switch that disables action mode even for Commander without misrepresenting the merchant's plan.

## Plans

| Capability | Trial | Start | Growth | Commander |
|---|---|---|---|---|
| Commands / day | 10 | 50 | 200 | Unlimited |
| Data queries | All | All | All | All |
| Action execution | No | No | No | Yes, after approval |
| Memory | Session | Session | 24 hours | Unlimited (90-day cleanup) |
| Saved commands | 3 | 10 | 25 | Unlimited |
| History | 7 days | 30 days | 90 days | Unlimited |
| Export conversations | No | No | Yes | Yes |
| 30-second undo | n/a | n/a | n/a | Reversible actions |

Upgrade CTAs always say **Upgrade Plan**. They never name a specific paid tier.

## Safety

Blocked even for Commander:

- Delete customers, products, orders, or store data
- Process refunds
- Bulk price or inventory changes
- Billing / payment access
- App or store configuration

Reversible with 30-second undo: customer tags, discount deactivation, notifications.

Not reversible: email send, recommendation approval, workflow trigger.

## Tools

Read tools (all plans): `search_customers`, `search_products`, `search_orders`, `get_analytics`, `get_recommendations`, `get_inventory_status`, `get_store_health`.

Write tools (Commander + approval): `send_email`, `tag_customers`, `create_discount`, `approve_recommendation`, `trigger_workflow`, `send_notification`, `generate_report`.

Discount caps: max 50% off, max 1000 uses, minimum 1-day expiry.

Email send requires a verified merchant sender and a live SMTP (Brevo) response. Partial failures are reported as `sent X of Y`.

## API

- `POST /ai-command/chat` — optional `stream: true` SSE
- `GET /ai-command/conversations`
- `GET /ai-command/conversations/:id`
- `DELETE /ai-command/conversations/:id`
- `POST /ai-command/conversations/:id/archive`
- `GET /ai-command/conversations/:id/export`
- `POST /ai-command/conversations/:id/messages/:messageId/feedback`
- `POST /ai-command/actions/:id/approve|cancel|rollback`
- `GET /ai-command/actions`
- `GET|POST|DELETE /ai-command/saved`
- `GET /ai-command/usage` and `/usage/history`
- `GET|PATCH /ai-command/preferences`
- `GET /ai-command/quick-commands`

## Environment

```
AI_COMMAND_ENABLED=true
AI_COMMAND_API_KEY=
AI_COMMAND_MODEL_PRIMARY=cohere/north-mini-code:free
AI_COMMAND_MODEL_FALLBACK=nvidia/nemotron-3-nano-omni:free
AI_COMMAND_ACTIONS_ENABLED=true
```

The production command path is deterministic and answers directly from tool results. Provider configuration is reserved for a future metered narration layer; AI Command does not make a discarded/unmetered model call before answering. It never fills gaps with invented numbers.

## Campaigns

The Campaigns page is removed from navigation. Campaign tables, email templates, suppression, and tracking stay in the database for automation and future use. Old campaign URLs redirect to AI Command.
