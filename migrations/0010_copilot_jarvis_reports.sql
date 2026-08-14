-- F8: tenant-scoped Jarvis sessions, Copilot threads, deterministic report runs, and schedules.
CREATE TABLE IF NOT EXISTS jarvis_preferences (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  addressing text NOT NULL DEFAULT 'Sir',
  language text NOT NULL DEFAULT 'auto',
  engagement_mode text NOT NULL DEFAULT 'balanced',
  silence_until timestamptz,
  navigation_suggestions boolean NOT NULL DEFAULT true,
  only_answer_when_asked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_sessions (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  plan text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  paused boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  last_page text NOT NULL,
  memory_expires_at timestamptz NOT NULL,
  undo_window_seconds integer NOT NULL,
  nonsense_count integer NOT NULL DEFAULT 0,
  pending_action jsonb,
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS jarvis_messages (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES jarvis_sessions(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  role text NOT NULL,
  text text NOT NULL,
  language text NOT NULL,
  mode text NOT NULL,
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS copilot_threads (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS copilot_answers (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES copilot_threads(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  query text NOT NULL,
  intent text,
  answer text NOT NULL,
  clarification text,
  evidence jsonb,
  slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_schedules (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  frequency text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS report_runs (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  frequency text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  filename text NOT NULL,
  object_key text NOT NULL,
  content_sha256 text,
  status text NOT NULL,
  email_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (store_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS jarvis_messages_store_session ON jarvis_messages (store_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS copilot_answers_store_thread ON copilot_answers (store_id, thread_id, created_at);
CREATE INDEX IF NOT EXISTS report_runs_store_created ON report_runs (store_id, created_at DESC);

ALTER TABLE jarvis_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE jarvis_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE jarvis_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY jarvis_preferences_tenant_isolation ON jarvis_preferences USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY jarvis_sessions_tenant_isolation ON jarvis_sessions USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY jarvis_messages_tenant_isolation ON jarvis_messages USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY copilot_threads_tenant_isolation ON copilot_threads USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY copilot_answers_tenant_isolation ON copilot_answers USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY report_schedules_tenant_isolation ON report_schedules USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY report_runs_tenant_isolation ON report_runs USING (store_id::text = current_setting('app.store_id', true));
