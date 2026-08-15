-- Operator-facing reliability: tenant-safe writes, report bytes, tickets, and workflow drafts.
-- RLS policies created in earlier phases only had USING clauses. INSERT/UPDATE
-- then inherit that check, which rejects the row when app.store_id is unset.
-- Recreate the hottest merchant-write policies with an explicit WITH CHECK.

DO $$
DECLARE
  policy_name text;
BEGIN
  FOREACH policy_name IN ARRAY ARRAY[
    'jarvis_preferences_tenant_isolation',
    'jarvis_sessions_tenant_isolation',
    'jarvis_messages_tenant_isolation',
    'copilot_threads_tenant_isolation',
    'copilot_answers_tenant_isolation',
    'report_schedules_tenant_isolation',
    'report_runs_tenant_isolation',
    'workflows_tenant_isolation',
    'campaign_templates_tenant_isolation',
    'support_tickets_tenant_isolation',
    'support_thread_messages_tenant_isolation',
    'trials_tenant_isolation',
    'ai_recommendations_tenant_isolation'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, CASE
      WHEN policy_name LIKE 'jarvis_preferences%' THEN 'jarvis_preferences'
      WHEN policy_name LIKE 'jarvis_sessions%' THEN 'jarvis_sessions'
      WHEN policy_name LIKE 'jarvis_messages%' THEN 'jarvis_messages'
      WHEN policy_name LIKE 'copilot_threads%' THEN 'copilot_threads'
      WHEN policy_name LIKE 'copilot_answers%' THEN 'copilot_answers'
      WHEN policy_name LIKE 'report_schedules%' THEN 'report_schedules'
      WHEN policy_name LIKE 'report_runs%' THEN 'report_runs'
      WHEN policy_name LIKE 'workflows%' THEN 'workflows'
      WHEN policy_name LIKE 'campaign_templates%' THEN 'campaign_templates'
      WHEN policy_name LIKE 'support_tickets%' THEN 'support_tickets'
      WHEN policy_name LIKE 'support_thread_messages%' THEN 'support_thread_messages'
      WHEN policy_name LIKE 'trials%' THEN 'trials'
      WHEN policy_name LIKE 'ai_recommendations%' THEN 'ai_recommendations'
    END);
  END LOOP;
END $$;

CREATE POLICY jarvis_preferences_tenant_isolation ON jarvis_preferences
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY jarvis_sessions_tenant_isolation ON jarvis_sessions
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY jarvis_messages_tenant_isolation ON jarvis_messages
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY copilot_threads_tenant_isolation ON copilot_threads
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY copilot_answers_tenant_isolation ON copilot_answers
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY report_schedules_tenant_isolation ON report_schedules
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY report_runs_tenant_isolation ON report_runs
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY workflows_tenant_isolation ON workflows
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY campaign_templates_tenant_isolation ON campaign_templates
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY support_tickets_tenant_isolation ON support_tickets
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY support_thread_messages_tenant_isolation ON support_thread_messages
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY trials_tenant_isolation ON trials
  USING (shop_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (shop_id::text = NULLIF(current_setting('app.store_id', true), ''));
CREATE POLICY ai_recommendations_tenant_isolation ON ai_recommendations
  USING (store_id::text = NULLIF(current_setting('app.store_id', true), ''))
  WITH CHECK (store_id::text = NULLIF(current_setting('app.store_id', true), ''));

ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS content_base64 text;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE workflows ALTER COLUMN definition_hash DROP NOT NULL;
ALTER TABLE workflows ALTER COLUMN definition_hash SET DEFAULT '';
