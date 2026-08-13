-- F6: workflows, campaigns, compliant sends, tracking, merchant email, exports, and support threads.
CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  version integer NOT NULL,
  definition_hash text NOT NULL,
  definition jsonb NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id, version)
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status text NOT NULL,
  current_node_id text,
  resume_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  key text PRIMARY KEY,
  run_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  status text NOT NULL,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_templates (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  variables jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  active_variant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_sends (
  job_id text PRIMARY KEY,
  campaign_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  recipient_key text NOT NULL,
  status text NOT NULL,
  provider_message_id text,
  sent_at timestamptz,
  UNIQUE (store_id, campaign_id, recipient_key)
);

CREATE TABLE IF NOT EXISTS suppression_ledger (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  recipient_key text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, recipient_key)
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  message_id text NOT NULL,
  kind text NOT NULL,
  target text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchant_email_configs (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  merchant_email text NOT NULL,
  from_name text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  verification_sent_at timestamptz,
  verified_at timestamptz
);

CREATE TABLE IF NOT EXISTS exports (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  format text NOT NULL,
  status text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  filename text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  subject text NOT NULL,
  priority text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_thread_messages (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  author text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppression_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_email_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_thread_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflows_tenant_isolation ON workflows USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY workflow_runs_tenant_isolation ON workflow_runs USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY workflow_steps_tenant_isolation ON workflow_steps USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY campaign_templates_tenant_isolation ON campaign_templates USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY campaigns_tenant_isolation ON campaigns USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY campaign_sends_tenant_isolation ON campaign_sends USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY suppression_ledger_tenant_isolation ON suppression_ledger USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY tracking_events_tenant_isolation ON tracking_events USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY merchant_email_configs_tenant_isolation ON merchant_email_configs USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY exports_tenant_isolation ON exports USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY support_tickets_tenant_isolation ON support_tickets USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY support_thread_messages_tenant_isolation ON support_thread_messages USING (store_id::text = current_setting('app.store_id', true));
