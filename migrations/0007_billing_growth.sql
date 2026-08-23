-- F5: billing state, charges, trials, gifts, entitlements, ROI, and growth funnel.
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  shop_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  state text NOT NULL,
  plan text NOT NULL,
  interval text,
  current_period_end timestamptz,
  version integer NOT NULL DEFAULT 0,
  price_locked_at timestamptz,
  grandfathered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_charges (
  id text PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  plan text NOT NULL,
  interval text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz
);

CREATE TABLE IF NOT EXISTS trials (
  shop_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  state text NOT NULL
);

CREATE TABLE IF NOT EXISTS gift_codes (
  code text PRIMARY KEY,
  max_uses integer NOT NULL,
  uses integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  duration_days integer NOT NULL DEFAULT 3,
  access_level text NOT NULL DEFAULT 'commander'
);

CREATE TABLE IF NOT EXISTS gift_redemptions (
  shop_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  code text NOT NULL REFERENCES gift_codes(code),
  redeemed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_usage (
  shop_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  feature text NOT NULL,
  period_start date NOT NULL,
  used bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, feature, period_start)
);

CREATE TABLE IF NOT EXISTS billing_funnel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, milestone)
);

CREATE TABLE IF NOT EXISTS billing_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  actor text NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Gift codes are NOT seeded here: real codes are configuration, not source.
-- The API seeds env-configured codes at boot (GIFT_CODE_SEQUENCE_1/2 via
-- PostgresTrialGiftStore.seedDefaultCodes), so no secrets live in the repo.

ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_subscriptions_tenant_isolation ON billing_subscriptions USING (shop_id::text = current_setting('app.store_id', true));
CREATE POLICY billing_charges_tenant_isolation ON billing_charges USING (shop_id::text = current_setting('app.store_id', true));
CREATE POLICY trials_tenant_isolation ON trials USING (shop_id::text = current_setting('app.store_id', true));
CREATE POLICY gift_redemptions_tenant_isolation ON gift_redemptions USING (shop_id::text = current_setting('app.store_id', true));
CREATE POLICY billing_usage_tenant_isolation ON billing_usage USING (shop_id::text = current_setting('app.store_id', true));
CREATE POLICY billing_funnel_events_tenant_isolation ON billing_funnel_events USING (shop_id::text = current_setting('app.store_id', true));
CREATE POLICY billing_audit_tenant_isolation ON billing_audit USING (shop_id::text = current_setting('app.store_id', true));
