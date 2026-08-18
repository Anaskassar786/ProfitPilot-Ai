# AI Command

AI Command replaces Copilot as the merchant command surface. One command can query every module and, on Commander, preview then execute safe actions.

## What merchants can do

- Ask questions about customers, products, orders, inventory, analytics, recommendations, and store health.
- Receive structured tables grounded in live Shopify sync data.
- On Commander: preview emails, tags, discounts, recommendation approvals, workflow triggers, notifications, and reports.
- Approve, cancel, or undo reversible actions within 30 seconds.
- Save frequent commands and reopen conversation history.

Nothing is invented. If a backend call fails, AI Command reports the failure with the real error.

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

If the command model is unavailable, AI Command still answers from deterministic tool results. It never fills gaps with invented numbers.

## Campaigns

The Campaigns page is removed from navigation. Campaign tables, email templates, suppression, and tracking stay in the database for automation and future use. Old campaign URLs redirect to AI Command.
