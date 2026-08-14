-- F9: persisted global maintenance mode, per-merchant emergency flags, and launch audit history.
CREATE TABLE IF NOT EXISTS platform_controls (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  maintenance_enabled boolean NOT NULL DEFAULT false,
  maintenance_message text NOT NULL DEFAULT 'ProfitPilot is temporarily under maintenance.',
  version integer NOT NULL DEFAULT 0,
  updated_by text NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_controls (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS merchant_controls (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  ai_enabled boolean NOT NULL DEFAULT true,
  automation_enabled boolean NOT NULL DEFAULT true,
  suspended boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0,
  updated_by text NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS launch_control_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  action text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launch_control_audit_store_time ON launch_control_audit (store_id, created_at DESC);
ALTER TABLE merchant_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE launch_control_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_controls_tenant_isolation ON merchant_controls USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY launch_control_audit_tenant_isolation ON launch_control_audit USING (store_id::text = current_setting('app.store_id', true) OR store_id IS NULL);
