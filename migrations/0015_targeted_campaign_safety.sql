-- Customer-targeted email safety: durable template/fingerprint linkage and honest outcomes.
ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES campaign_templates(id) ON DELETE RESTRICT;
ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS idempotency_fingerprint text;
ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS campaign_sends_store_job ON campaign_sends (store_id, job_id);
CREATE INDEX IF NOT EXISTS campaign_sends_store_recipient ON campaign_sends (store_id, recipient_key);

-- Existing rows predate customer-targeted sending. New targeted rows always set
-- both values; retaining nullable columns keeps this migration backwards-safe.
