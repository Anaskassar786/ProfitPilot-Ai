-- Historical inventory snapshots.
--
-- Written by PostgresSyncSink.complete() when an inventory sync finishes, so
-- the stock-history chart and seasonal analysis are built from real observed
-- levels rather than a back-filled estimate. There is no cron and no worker
-- change: one row per variant/location per calendar day, upserted so repeated
-- syncs on the same day converge on the latest observation.
CREATE TABLE IF NOT EXISTS inventory_snapshots_daily (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  variant_id text NOT NULL,
  -- '' means "no per-location breakdown was returned by Shopify"; the row then
  -- carries the variant-level quantity instead of a location level.
  location_id text NOT NULL DEFAULT '',
  product_id text NOT NULL,
  quantity integer NOT NULL,
  -- NULL when Shopify returned no variant price: value is never invented.
  value numeric(20, 4),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, snapshot_date, variant_id, location_id)
);

CREATE INDEX IF NOT EXISTS inventory_snapshots_daily_store_date
  ON inventory_snapshots_daily (store_id, snapshot_date);

ALTER TABLE inventory_snapshots_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_snapshots_daily_tenant_isolation ON inventory_snapshots_daily;
CREATE POLICY inventory_snapshots_daily_tenant_isolation ON inventory_snapshots_daily
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
