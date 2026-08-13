-- F4: deterministic decisions, immutable evidence, execution ledger, calibration, attribution, and AI cost.
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  agent text NOT NULL,
  rule_id text NOT NULL,
  status text NOT NULL,
  version integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_evidence_packs (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  rule_id text NOT NULL,
  rule_version text NOT NULL,
  sha256 text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_executions (
  id text PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  status text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ai_calibration_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  agent text NOT NULL,
  recommendation_id uuid REFERENCES ai_recommendations(id) ON DELETE SET NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_cost_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day date NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL,
  completion_tokens integer NOT NULL,
  micro_dollars bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_attribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  action_id text NOT NULL,
  order_id text NOT NULL,
  method text NOT NULL,
  revenue numeric(20, 4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, order_id)
);

CREATE INDEX IF NOT EXISTS ai_recommendations_store_status ON ai_recommendations (store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_cost_ledger_store_day ON ai_cost_ledger (store_id, day);

ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_evidence_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_calibration_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_cost_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_attribution_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_recommendations_tenant_isolation ON ai_recommendations USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY ai_evidence_packs_tenant_isolation ON ai_evidence_packs USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY ai_executions_tenant_isolation ON ai_executions USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY ai_calibration_samples_tenant_isolation ON ai_calibration_samples USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY ai_cost_ledger_tenant_isolation ON ai_cost_ledger USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY ai_attribution_events_tenant_isolation ON ai_attribution_events USING (store_id::text = current_setting('app.store_id', true));
