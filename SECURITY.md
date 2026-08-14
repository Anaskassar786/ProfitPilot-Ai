# ProfitPilot security practices

## Tenant and identity

- Production tenant routes require a verified access JWT and active rotating session.
- Store context must match the authenticated session; query/body tenant spoofing is rejected.
- PostgreSQL tenant tables use RLS policies and bound query parameters.
- Admin writes require an expiring step-up session and produce audit events.

## Requests

- Strict CORS allow-list; no wildcard credentials.
- CSP, HSTS in production, frame denial, referrer policy, and content-type hardening.
- 100 KB JSON body limit and endpoint-specific rate limits.
- Cookie-authenticated unsafe requests require a CSRF double-submit token.
- Request logs redact authorization, credentials, tokens, email, phone, address, and customer fields.
- Internal errors never expose stack traces or raw provider messages.

## AI and automation

- Direct customer PII is minimized before AI context construction.
- Jarvis and F4 language output is checked for unsupported numbers and restricted PII.
- Copilot uses a closed intent grammar and deterministic numeric slots.
- Risky actions require explicit approval/voice repeat-confirmation and idempotent ledgers.
- Merchant flags can selectively disable AI, automation, or an entire merchant.

## Operations

- Maintenance mode blocks ordinary merchant traffic but never blocks health, readiness, webhook, or admin paths.
- Failed and dead-letter jobs are inspected and retried through step-up protected admin operations.
- Sentry is optional; when configured it groups by exception identity, carries release/environment tags, and includes store context.
- Rotate secrets through the deployment secret manager and revoke old sessions after rotation.
