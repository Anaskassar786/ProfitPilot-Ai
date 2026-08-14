# F9 operations runbooks

## Backup and restore drill

1. Create a timestamped Railway PostgreSQL backup and record the migration head from `schema_migrations`.
2. Restore into an isolated database with production secrets excluded.
3. Run the API with `RUN_MIGRATIONS=false`, verify RLS, `/ready`, report download, and a read-only Copilot query.
4. Run a non-production restore of Redis/Upstash queue data and inspect queued/failed/dead-letter jobs.
5. Record duration, missing objects, and owner sign-off. Never restore customer data into a developer laptop.

## Incident response

1. Page the on-call and open an incident timeline.
2. Use F9 Admin Ops to enable maintenance mode; `/live`, `/ready`, `/shopify/webhooks`, and admin remain available.
3. Suspend only affected merchants when possible; disable AI or automation selectively before global shutdown.
4. Capture Sentry event IDs, release, store scope, queue status, and relevant audit records. Do not paste secrets or customer PII into the incident channel.
5. Revoke suspicious Shopify sessions, JWT refresh families, API keys, or SMTP/R2 credentials.
6. Restore service gradually, verify `/ready`, replay safe jobs, and publish a post-incident review.

## Release process

1. Review the branch diff and migration SQL.
2. Run build, typecheck, all tests, coverage, security, load, and Axe gates.
3. Deploy API and worker from the same release commit.
4. Run migrations under the startup lock; verify migration head.
5. Smoke-test a development store, billing test charge, sync, Jarvis, Copilot, report generation/download, and admin controls.
6. Promote web, update Shopify Partner URLs, and retain the rollback commit.

## Troubleshooting

- **503 from `/ready`:** inspect the named check. Database means connection/SSL; Redis means Upstash URL/token; AI means OpenRouter key/availability; Shopify means health shop/token or OAuth state.
- **Maintenance response:** an admin may disable it with the current version; never bypass it by deleting rows.
- **AI unavailable:** Jarvis returns an honest unavailable response; inspect OpenRouter status and cost cap before rotating keys.
- **Report R2 failure:** verify canonical or `CLOUDFLARE_R2_*` aliases, bucket permissions, endpoint, and system clock for signatures.
- **Email unavailable:** verify SMTP settings and merchant-email verification. Report status remains explicit.
- **Job stuck:** inspect queue, failed, and dead-letter views; retry only after understanding the error and idempotency key.
- **Worker not ready:** check port 3100, process logs, and `lastTickAt`; restart only after preserving failed-job evidence.

## Environment rotation

1. Add the new secret to Railway without deleting the old value.
2. Deploy and verify health/readiness and a signed request.
3. Rotate/revoke the old credential at its provider.
4. Revoke old sessions where JWT/Shopify identity changed.
5. Remove the old Railway secret after the verification window and record the rotation owner/date.
