# Automation reference

## Plans

| Plan | Workflow limit | AI nodes |
|---|---:|---:|
| Trial (14 days) | 2 | No |
| Start | 5 | No |
| Growth | 20 | No |
| Commander | Unlimited | Yes |

Expired trials and inactive subscriptions receive HTTP 402 with upgrade context. UI upgrade actions always use the generic label **Upgrade Plan** or **Upgrade Subscription**.

## Nodes

### Triggers

Manual, five-field cron with IANA timezone, and Shopify webhook events for orders, customers, products, inventory levels, and checkouts.

### Conditions

If/else and filter nodes support equals, not-equals, greater-than, less-than, contains, exists, and bounded range comparisons.

### Production actions

- Consent-aware email through the existing verified Brevo/SMTP campaign service.
- Add/remove Shopify customer tags idempotently.
- Create Shopify percentage discounts from 1% through 50% with a required usage limit.
- Persist an in-app merchant notification.
- Adjust Shopify inventory by no more than 1,000 units when scope is available.
- Wait from zero through 30 days and resume on the scheduler tick.

SMS is not an available workflow node.

## Default safety policy

- 50 nodes maximum.
- 100 actions per workflow per day.
- 100 email recipients per run.
- 1–50% discount range.
- 1,000-unit inventory adjustment bound.
- 30-day maximum wait.
- 30-second node timeout.
- Three run attempts by default.
- 24-hour approval expiry.
- PII redaction in persisted step input/output.
- Run output retention target: 30 days (purge should run as an operational database maintenance task).

## Approvals

Low-risk tag, notification, wait, and bounded inventory actions may execute automatically according to policy. Single-recipient email is medium risk. Bulk email and discount creation are high risk. Approval records bind store, workflow, published version hash, run, node, and payload hash; duplicate decisions cannot be applied.

## API

All endpoints require tenant context and use the standard `{ ok, data, meta }` envelope.

- `GET/POST /automation/workflows`
- `GET/PATCH/DELETE /automation/workflows/:id`
- `POST /automation/workflows/:id/activate|pause|resume|clone|validate|run|test|rollback`
- `GET /automation/workflows/:id/versions`
- `GET /automation/workflows/:id/runs`
- `GET /automation/runs/:runId`
- `POST /automation/runs/:runId/retry|cancel`
- `GET /automation/templates`
- `POST /automation/templates/:templateId/install`
- `GET /automation/usage`
- `GET /automation/summary`
- `GET /automation/approvals`
- `POST /automation/approvals/:id/approve|reject`

List filters support status, category, name/description search, sort/direction, cursor, and a maximum page size of 50.

## Migration

`0018_professional_automation.sql` adds merchant metadata and corrects workflow status persistence. It also introduces immutable versions, durable execution/step records, approvals, merchant notifications, indexes, constraints, and tenant RLS write checks.
