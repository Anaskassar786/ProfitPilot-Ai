-- PR47: merchant-facing workflows, immutable versions, durable runs, approvals, schedules, and notifications.
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS name text;
UPDATE workflows SET name = 'Untitled workflow' WHERE name IS NULL OR btrim(name) = '';
ALTER TABLE workflows ALTER COLUMN name SET NOT NULL;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'Operations';
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT 'merchant';
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS updated_by text NOT NULL DEFAULT 'merchant';
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS last_run_at timestamptz;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS success_count integer NOT NULL DEFAULT 0 CHECK (success_count >= 0);
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0);
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS trigger_summary text NOT NULL DEFAULT 'Manual';
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS node_count integer NOT NULL DEFAULT 0 CHECK (node_count BETWEEN 0 AND 50);
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS next_run_at timestamptz;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS overlap_policy text NOT NULL DEFAULT 'SKIP' CHECK (overlap_policy IN ('SKIP', 'QUEUE', 'PARALLEL'));
ALTER TABLE workflows DROP CONSTRAINT IF EXISTS workflows_status_check;
ALTER TABLE workflows ADD CONSTRAINT workflows_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'));
CREATE INDEX IF NOT EXISTS workflows_store_status_updated_idx ON workflows(store_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS workflows_store_next_run_idx ON workflows(store_id, next_run_at) WHERE status = 'ACTIVE' AND enabled;

CREATE TABLE IF NOT EXISTS workflow_versions (
  workflow_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  definition_hash text NOT NULL,
  definition jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (store_id, workflow_id, version),
  UNIQUE (store_id, workflow_id, definition_hash)
);

ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS version integer;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS definition_hash text;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS trigger_event_id text;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}';
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10);
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_status_check;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_status_check CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'WAITING', 'APPROVAL_REQUIRED'));
CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_webhook_dedupe_idx ON workflow_runs(store_id, trigger_event_id, workflow_id) WHERE trigger_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workflow_runs_store_workflow_created_idx ON workflow_runs(store_id, workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_runs_resumable_idx ON workflow_runs(resume_at) WHERE status = 'WAITING';
CREATE INDEX IF NOT EXISTS workflow_runs_retry_idx ON workflow_runs(next_attempt_at) WHERE status = 'QUEUED';

ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS sequence integer NOT NULL DEFAULT 0;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS input jsonb NOT NULL DEFAULT '{}';
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1;
ALTER TABLE workflow_steps DROP CONSTRAINT IF EXISTS workflow_steps_status_check;
ALTER TABLE workflow_steps ADD CONSTRAINT workflow_steps_status_check CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'WAITING', 'APPROVAL_REQUIRED'));
CREATE INDEX IF NOT EXISTS workflow_steps_run_sequence_idx ON workflow_steps(store_id, run_id, sequence);

CREATE TABLE IF NOT EXISTS workflow_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL,
  workflow_name text NOT NULL,
  run_id uuid NOT NULL,
  node_id text NOT NULL,
  version integer NOT NULL,
  definition_hash text NOT NULL,
  action_type text NOT NULL,
  action_payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  preview text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text,
  decision_reason text,
  UNIQUE (store_id, run_id, node_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS workflow_approvals_pending_idx ON workflow_approvals(store_id, expires_at) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS merchant_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  workflow_id uuid,
  run_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchant_notifications_store_created_idx ON merchant_notifications(store_id, created_at DESC);

ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_versions_tenant_isolation ON workflow_versions USING (store_id::text = NULLIF(current_setting('app.store_id', true), '')) WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY workflow_approvals_tenant_isolation ON workflow_approvals USING (store_id::text = NULLIF(current_setting('app.store_id', true), '')) WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY merchant_notifications_tenant_isolation ON merchant_notifications USING (store_id::text = NULLIF(current_setting('app.store_id', true), '')) WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));

-- Existing run/step policies lacked explicit write checks.
DROP POLICY IF EXISTS workflow_runs_tenant_isolation ON workflow_runs;
DROP POLICY IF EXISTS workflow_steps_tenant_isolation ON workflow_steps;
CREATE POLICY workflow_runs_tenant_isolation ON workflow_runs USING (store_id::text = NULLIF(current_setting('app.store_id', true), '')) WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY workflow_steps_tenant_isolation ON workflow_steps USING (store_id::text = NULLIF(current_setting('app.store_id', true), '')) WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
