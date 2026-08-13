-- F2: resumable sync checkpoints, normalized sync records, and four pre-aggregated metric tables.
CREATE TABLE IF NOT EXISTS sync_records (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  module text NOT NULL,
  record_id text NOT NULL,
  payload jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, module, record_id)
);

CREATE INDEX IF NOT EXISTS sync_records_store_module ON sync_records (store_id, module);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  module text NOT NULL,
  cursor text,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, module)
);

CREATE TABLE IF NOT EXISTS analytics_revenue_daily (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day date NOT NULL,
  gross_revenue numeric(20, 4) NOT NULL,
  discounts numeric(20, 4) NOT NULL DEFAULT 0,
  order_count integer NOT NULL,
  PRIMARY KEY (store_id, day)
);

CREATE TABLE IF NOT EXISTS analytics_orders_daily (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day date NOT NULL,
  order_count integer NOT NULL,
  fulfilled_count integer NOT NULL DEFAULT 0,
  cancelled_count integer NOT NULL DEFAULT 0,
  average_order_value numeric(20, 4) NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, day)
);

CREATE TABLE IF NOT EXISTS analytics_product_sales_daily (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day date NOT NULL,
  product_id text NOT NULL,
  units_sold integer NOT NULL,
  gross_revenue numeric(20, 4) NOT NULL,
  PRIMARY KEY (store_id, day, product_id)
);

CREATE TABLE IF NOT EXISTS analytics_customer_cohorts_daily (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  cohort_day date NOT NULL,
  activity_day date NOT NULL,
  customer_count integer NOT NULL,
  gross_revenue numeric(20, 4) NOT NULL,
  PRIMARY KEY (store_id, cohort_day, activity_day)
);

CREATE TABLE IF NOT EXISTS catalog_products (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  payload jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, product_id)
);

CREATE INDEX IF NOT EXISTS analytics_revenue_daily_store_day ON analytics_revenue_daily (store_id, day);
CREATE INDEX IF NOT EXISTS analytics_orders_daily_store_day ON analytics_orders_daily (store_id, day);
CREATE INDEX IF NOT EXISTS analytics_product_sales_daily_store_day ON analytics_product_sales_daily (store_id, day);
CREATE INDEX IF NOT EXISTS analytics_customer_cohorts_daily_store_day ON analytics_customer_cohorts_daily (store_id, activity_day);

ALTER TABLE sync_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_revenue_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_orders_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_product_sales_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_customer_cohorts_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_records_tenant_isolation ON sync_records USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY sync_checkpoints_tenant_isolation ON sync_checkpoints USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY analytics_revenue_daily_tenant_isolation ON analytics_revenue_daily USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY analytics_orders_daily_tenant_isolation ON analytics_orders_daily USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY analytics_product_sales_daily_tenant_isolation ON analytics_product_sales_daily USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY analytics_customer_cohorts_daily_tenant_isolation ON analytics_customer_cohorts_daily USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY catalog_products_tenant_isolation ON catalog_products USING (store_id::text = current_setting('app.store_id', true));
