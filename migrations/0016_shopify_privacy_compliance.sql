-- Mandatory Shopify privacy webhooks: retain a minimal, tenant-scoped audit of
-- data requests and redactions without duplicating customer PII.
CREATE TABLE IF NOT EXISTS privacy_compliance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  webhook_id text NOT NULL,
  topic text NOT NULL CHECK (topic IN ('customers/data_request', 'customers/redact')),
  shopify_customer_id text,
  status text NOT NULL CHECK (status IN ('RECEIVED', 'COMPLETED')),
  received_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (store_id, webhook_id)
);

CREATE INDEX IF NOT EXISTS privacy_compliance_requests_due_idx
  ON privacy_compliance_requests (store_id, status, due_at);

ALTER TABLE privacy_compliance_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_compliance_requests_tenant_isolation ON privacy_compliance_requests;
CREATE POLICY privacy_compliance_requests_tenant_isolation ON privacy_compliance_requests
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));

-- Webhook ingestion is tenant-scoped too; explicit WITH CHECK keeps inserts
-- working for application roles that do not bypass RLS.
DROP POLICY IF EXISTS webhook_receipts_tenant_isolation ON webhook_receipts;
CREATE POLICY webhook_receipts_tenant_isolation ON webhook_receipts
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
DROP POLICY IF EXISTS webhook_audit_events_tenant_isolation ON webhook_audit_events;
CREATE POLICY webhook_audit_events_tenant_isolation ON webhook_audit_events
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
