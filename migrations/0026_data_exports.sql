-- Data Exports — durable export history and monthly plan metering.
--
-- The Exports page previously had no memory: a merchant could not see what
-- they had already downloaded, and nothing enforced the per-plan monthly
-- allowance across restarts. This migration adds one tenant-scoped table that
-- records every real export a store generates. It is the single source for:
--
--   * "Exports this month: 2/3" on the plan banner (COUNT over the period)
--   * "Last exported" on each export card (MAX(created_at) per dataset)
--   * the Export History list (recent rows, newest first)
--
-- Only successful exports are recorded, and only from the real writers — a
-- blocked (402) or failed export never lands here, so the counters cannot
-- drift away from what the merchant actually received.

CREATE TABLE IF NOT EXISTS export_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  dataset text NOT NULL CHECK (dataset IN ('orders','catalog','audit','revenue')),
  format text NOT NULL CHECK (format IN ('CSV','XLSX','PDF')),
  filename text NOT NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  byte_size integer NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  plan text NOT NULL,
  period_start date NOT NULL,
  range_start date,
  range_end date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Monthly quota counting and the history list share this index.
CREATE INDEX IF NOT EXISTS export_history_store_period
  ON export_history (store_id, period_start, created_at DESC);

-- "Last exported" lookups per dataset.
CREATE INDEX IF NOT EXISTS export_history_store_dataset
  ON export_history (store_id, dataset, created_at DESC);

ALTER TABLE export_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY export_history_tenant_isolation ON export_history
  USING (store_id::text = current_setting('app.store_id', true))
  WITH CHECK (store_id::text = current_setting('app.store_id', true));
