-- Managed-install tenant registration must also work for application roles that
-- do not own the stores table and are therefore subject to row-level security.
-- Both contexts are server-controlled and transaction-local:
--   app.store_id    for normal tenant reads/writes
--   app.shop_domain for the signed Shopify app-load registration/upsert
DROP POLICY IF EXISTS stores_tenant_isolation ON stores;

CREATE POLICY stores_tenant_isolation ON stores
  USING (
    id::text = NULLIF(current_setting('app.store_id', true), '')
    OR shop_domain = NULLIF(current_setting('app.shop_domain', true), '')
  )
  WITH CHECK (
    id::text = NULLIF(current_setting('app.store_id', true), '')
    OR shop_domain = NULLIF(current_setting('app.shop_domain', true), '')
  );
