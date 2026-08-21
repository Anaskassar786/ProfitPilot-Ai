-- P0: app/uninstalled webhook handler — immediate token revocation & store status update
-- Required for Shopify App Store compliance (public apps must handle uninstall immediately)

-- Add status column to stores for uninstall tracking
ALTER TABLE stores ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS uninstalled_at timestamptz;
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_status_check;
ALTER TABLE stores ADD CONSTRAINT stores_status_check CHECK (status IN ('ACTIVE', 'UNINSTALLED'));

-- Update the RLS policy to allow access to uninstalled stores for audit/reconciliation
DROP POLICY IF EXISTS stores_tenant_isolation_uninstall ON stores;
CREATE POLICY stores_tenant_isolation_uninstall ON stores
  USING (
    id::text = current_setting('app.store_id', true)
    OR current_setting('app.store_id', true) = 'system'
  );

-- Index for efficient uninstall queries
CREATE INDEX IF NOT EXISTS stores_status_idx ON stores (status) WHERE status = 'UNINSTALLED';
CREATE INDEX IF NOT EXISTS stores_uninstalled_at_idx ON stores (uninstalled_at) WHERE uninstalled_at IS NOT NULL;
