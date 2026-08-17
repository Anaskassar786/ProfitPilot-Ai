# PR #47 — Professional Automation Hub

## Summary

Replaces the UUID-driven Automation prototype with a tenant-safe, plan-aware workflow hub and a real React Flow editor. Workflows now have merchant-facing metadata, immutable published versions, durable run and step records, approvals, scheduled and Shopify webhook triggers, dry runs, safety caps, and real action adapters.

## Highlights

- Extracted Automation from `App.tsx` into dedicated page, model, API, hooks, editor, card, template, run-history, approval, and stylesheet modules.
- Added React Flow canvas with drag/drop, connections, zoom/pan, minimap, node configuration, validation, save, test, and publish controls.
- Added human-readable names, descriptions, categories, tags, audit metadata, status, activation hash, run counters, trigger summary, and node count.
- Fixed active status/hash loss and made all PostgreSQL workflow operations tenant-scoped.
- Added durable workflow versions, runs, steps, approvals, and merchant notifications in migration `0018`.
- Added manual runs, dry runs, scheduled triggers, Shopify webhook matching, wait resumption, cancellation, retry, run history, summaries, and approval decisions.
- Added real adapters for consent-aware email, Shopify customer tags, bounded Shopify discounts, internal notifications, and bounded inventory updates.
- Added 15 installable templates with generic upgrade CTAs and Commander-gated AI templates.
- Enforced Trial 2 / Start 5 / Growth 20 / Commander unlimited workflow limits with HTTP 402 upgrade context.
- Added RBAC checks through persisted member roles and `automation:read` / `automation:write` permissions.
- Removed SMS from every workflow node catalog and template.

## Safety

- Maximum 50 nodes per workflow.
- Acyclic and fully connected graph validation.
- Wait cap of 30 days.
- Discount range of 1–50% with required usage limit.
- Email cap of 100 recipients per run.
- Inventory adjustment cap of 1,000 units.
- Payload-bound, idempotent approvals with 24-hour expiry.
- PII redaction for persisted run input/output.
- Published definitions are hash-addressed and runs reference the exact version.

## Database migration

Run `0018_professional_automation.sql` before deploying the new API. The migration is additive for existing workflow records and backfills a neutral `Untitled workflow` name only for legacy records that predate merchant-facing names.

## Validation

- Workspace production build passes.
- Automation API and domain tests pass.
- Full suite: 1,260 tests; migration/topic expectation tests updated for migration 0018 and two new Shopify customer webhook topics.
