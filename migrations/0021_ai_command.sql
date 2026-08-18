-- PR51: AI Command conversations, action log, saved shortcuts, usage, and preferences.
CREATE TABLE IF NOT EXISTS ai_command_conversations (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_command_actions (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES ai_command_conversations(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  action_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  merchant_approved boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  execution_status text NOT NULL DEFAULT 'PENDING',
  execution_result jsonb,
  error_details jsonb,
  rollback_available boolean NOT NULL DEFAULT false,
  rollback_deadline timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS ai_command_saved_commands (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  command_text text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_command_usage (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  commands_used integer NOT NULL DEFAULT 0,
  actions_executed integer NOT NULL DEFAULT 0,
  tokens_used integer NOT NULL DEFAULT 0,
  cost_micro_dollars integer NOT NULL DEFAULT 0,
  UNIQUE (store_id, usage_date)
);

CREATE TABLE IF NOT EXISTS ai_command_preferences (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  default_response_style text NOT NULL DEFAULT 'CONCISE',
  quick_commands_enabled boolean NOT NULL DEFAULT true,
  auto_suggestions_enabled boolean NOT NULL DEFAULT true,
  thinking_animation_enabled boolean NOT NULL DEFAULT true,
  conversation_memory_enabled boolean NOT NULL DEFAULT true,
  notification_on_action_complete boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_command_conversations_store_updated
  ON ai_command_conversations (store_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS ai_command_actions_store_created
  ON ai_command_actions (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_command_saved_store
  ON ai_command_saved_commands (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_command_usage_store_date
  ON ai_command_usage (store_id, usage_date DESC);

ALTER TABLE ai_command_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_command_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_command_saved_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_command_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_command_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_command_conversations_tenant_isolation ON ai_command_conversations
  USING (store_id::text = current_setting('app.store_id', true))
  WITH CHECK (store_id::text = current_setting('app.store_id', true));
CREATE POLICY ai_command_actions_tenant_isolation ON ai_command_actions
  USING (store_id::text = current_setting('app.store_id', true))
  WITH CHECK (store_id::text = current_setting('app.store_id', true));
CREATE POLICY ai_command_saved_commands_tenant_isolation ON ai_command_saved_commands
  USING (store_id::text = current_setting('app.store_id', true))
  WITH CHECK (store_id::text = current_setting('app.store_id', true));
CREATE POLICY ai_command_usage_tenant_isolation ON ai_command_usage
  USING (store_id::text = current_setting('app.store_id', true))
  WITH CHECK (store_id::text = current_setting('app.store_id', true));
CREATE POLICY ai_command_preferences_tenant_isolation ON ai_command_preferences
  USING (store_id::text = current_setting('app.store_id', true))
  WITH CHECK (store_id::text = current_setting('app.store_id', true));
