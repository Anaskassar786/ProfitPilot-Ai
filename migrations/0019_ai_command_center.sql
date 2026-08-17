-- PR45: AI Command Center overhaul.
-- 1. Durable per-agent cost attribution on the (previously unused) cost ledger.
-- 2. Recommendation dedupe support on (store, rule, entity, PENDING).
-- 3. Per-store agent settings (pause/resume persistence).

ALTER TABLE ai_cost_ledger ADD COLUMN IF NOT EXISTS agent text NOT NULL DEFAULT 'UNATTRIBUTED';

ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS entity_key text;
CREATE INDEX IF NOT EXISTS ai_recommendations_pending_dedupe
  ON ai_recommendations (store_id, rule_id, entity_key)
  WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS ai_agent_settings (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  agent text NOT NULL,
  paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, agent)
);

ALTER TABLE ai_agent_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_agent_settings_tenant_isolation ON ai_agent_settings USING (store_id::text = current_setting('app.store_id', true));
