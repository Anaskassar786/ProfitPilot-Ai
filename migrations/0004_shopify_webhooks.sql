-- F1: encrypted Shopify token storage and replay-safe webhook receipt ledger.
CREATE TABLE IF NOT EXISTS shopify_tokens (
  shop_domain text PRIMARY KEY,
  encrypted_access_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

ALTER TABLE shopify_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY shopify_tokens_tenant_isolation ON shopify_tokens
  USING (shop_domain = current_setting('app.shop_domain', true));

CREATE TABLE IF NOT EXISTS webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  webhook_id text NOT NULL,
  topic text NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  failed_at timestamptz,
  UNIQUE (store_id, webhook_id)
);

ALTER TABLE webhook_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_receipts_tenant_isolation ON webhook_receipts
  USING (store_id::text = current_setting('app.store_id', true));
