-- PR #50: Insights Hub (AI Growth Command, part 3).
-- Discovery + learning + understanding surfaces: discoveries, lessons,
-- patterns, personas, why? investigations, trends, comparisons, knowledge
-- base, timeline, predictions, preferences, and Commander API usage.
-- Every table is tenant-scoped with RLS identical to the existing modules.

CREATE TABLE IF NOT EXISTS insights_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  discovery_type text NOT NULL CHECK (discovery_type IN ('PATTERN','ANOMALY','OPPORTUNITY','CORRELATION','TREND','SEGMENT','BEHAVIOR')),
  category text NOT NULL CHECK (category IN ('REVENUE','CUSTOMERS','PRODUCTS','OPERATIONS','MARKETING','TIME')),
  title text NOT NULL,
  description text NOT NULL,
  explanation text NOT NULL DEFAULT '',
  confidence_score numeric NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  impact_estimate numeric,
  impact_currency text NOT NULL DEFAULT 'USD',
  data_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  visualization_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','REVIEWED','SAVED','DISMISSED','ACTED_ON')),
  sample boolean NOT NULL DEFAULT false,
  viewed_at timestamptz,
  action_taken_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS insights_discoveries_store_status ON insights_discoveries (store_id, status, discovered_at DESC);
ALTER TABLE insights_discoveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_discoveries_tenant_isolation ON insights_discoveries USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lesson_type text NOT NULL CHECK (lesson_type IN ('PATTERN_STUDY','BEHAVIOR_ANALYSIS','COMPETITOR_INSIGHT','BEST_PRACTICE','CASE_STUDY')),
  category text NOT NULL CHECK (category IN ('REVENUE','CUSTOMERS','PRODUCTS','OPERATIONS','MARKETING','TIME')),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  content_markdown text NOT NULL DEFAULT '',
  reading_time_minutes int NOT NULL DEFAULT 3,
  based_on_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  personalized boolean NOT NULL DEFAULT true,
  sample boolean NOT NULL DEFAULT false,
  generated_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  rating int CHECK (rating BETWEEN 0 AND 5),
  bookmarked boolean NOT NULL DEFAULT false,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS insights_lessons_store_category ON insights_lessons (store_id, category, generated_at DESC);
ALTER TABLE insights_lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_lessons_tenant_isolation ON insights_lessons USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  pattern_type text NOT NULL CHECK (pattern_type IN ('TIME','PRODUCT','CUSTOMER','BEHAVIORAL','SEASONAL','ANOMALY','CORRELATION')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  pattern_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurrence_count int NOT NULL DEFAULT 1,
  confidence_score numeric NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  first_detected timestamptz NOT NULL DEFAULT now(),
  last_confirmed timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','INVALIDATED')),
  alerts_enabled boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS insights_patterns_store_type ON insights_patterns (store_id, pattern_type, status);
ALTER TABLE insights_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_patterns_tenant_isolation ON insights_patterns USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  persona_name text NOT NULL,
  persona_emoji text NOT NULL DEFAULT '🧭',
  customer_segment_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  percentage_of_customers numeric NOT NULL DEFAULT 0,
  behavior_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  motivations jsonb NOT NULL DEFAULT '[]'::jsonb,
  how_to_reach jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_revenue_impact numeric NOT NULL DEFAULT 0,
  revenue_currency text NOT NULL DEFAULT 'USD',
  confidence_score numeric NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  radar jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  customer_count int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS insights_personas_store ON insights_personas (store_id, generated_at DESC);
ALTER TABLE insights_personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_personas_tenant_isolation ON insights_personas USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_investigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  question text NOT NULL,
  investigation_status text NOT NULL DEFAULT 'PENDING' CHECK (investigation_status IN ('PENDING','INVESTIGATING','COMPLETED','FAILED')),
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  root_causes jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_sources_analyzed jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_score numeric NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  what_to_do jsonb NOT NULL DEFAULT '[]'::jsonb,
  prevention_tips jsonb NOT NULL DEFAULT '[]'::jsonb,
  rating int CHECK (rating BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS insights_investigations_store ON insights_investigations (store_id, created_at DESC);
ALTER TABLE insights_investigations ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_investigations_tenant_isolation ON insights_investigations USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_trends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  trend_type text NOT NULL CHECK (trend_type IN ('BUSINESS','MARKET','EMERGING','DECLINING')),
  category text NOT NULL CHECK (category IN ('REVENUE','CUSTOMERS','PRODUCTS','OPERATIONS','MARKETING','TIME')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  direction text NOT NULL CHECK (direction IN ('UP','DOWN','STABLE')),
  magnitude numeric NOT NULL DEFAULT 0,
  time_period text NOT NULL DEFAULT 'LAST_14_DAYS',
  data_source text NOT NULL DEFAULT 'INTERNAL' CHECK (data_source IN ('INTERNAL','EXTERNAL','HYBRID')),
  confidence_score numeric NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  detected_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  alerts_enabled boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS insights_trends_store_type ON insights_trends (store_id, trend_type, detected_at DESC);
ALTER TABLE insights_trends ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_trends_tenant_isolation ON insights_trends USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  comparison_type text NOT NULL CHECK (comparison_type IN ('PRODUCT','PERIOD','SEGMENT','CATEGORY','CHANNEL')),
  title text NOT NULL,
  subject_a jsonb NOT NULL DEFAULT '{}'::jsonb,
  subject_b jsonb NOT NULL DEFAULT '{}'::jsonb,
  comparison_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  winner text NOT NULL DEFAULT 'INSUFFICIENT_DATA' CHECK (winner IN ('A','B','TIE','INSUFFICIENT_DATA')),
  insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insights_comparisons_store ON insights_comparisons (store_id, comparison_type, created_at DESC);
ALTER TABLE insights_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_comparisons_tenant_isolation ON insights_comparisons USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('DISCOVERY','LESSON','NOTE','PATTERN','INVESTIGATION','CUSTOM')),
  title text NOT NULL,
  content_markdown text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  linked_insights uuid[] NOT NULL DEFAULT '{}',
  author text NOT NULL DEFAULT 'MERCHANT' CHECK (author IN ('AI','MERCHANT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_referenced_at timestamptz,
  reference_count int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS insights_knowledge_store ON insights_knowledge_base (store_id, entry_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS insights_knowledge_tags ON insights_knowledge_base USING gin (tags);
ALTER TABLE insights_knowledge_base ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_knowledge_base_tenant_isolation ON insights_knowledge_base USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('DISCOVERY','LESSON','PATTERN','PERSONA','INVESTIGATION','TREND','COMPARISON','PREDICTION')),
  entity_id uuid,
  entity_ref text,
  description text NOT NULL DEFAULT '',
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insights_timeline_store ON insights_timeline_events (store_id, event_at DESC);
ALTER TABLE insights_timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_timeline_events_tenant_isolation ON insights_timeline_events USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  prediction_type text NOT NULL CHECK (prediction_type IN ('REVENUE','ORDERS','CUSTOMERS','INVENTORY','TREND','RISK')),
  prediction_horizon text NOT NULL CHECK (prediction_horizon IN ('7_DAYS','30_DAYS','90_DAYS')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  predicted_value numeric NOT NULL DEFAULT 0,
  predicted_low numeric,
  predicted_high numeric,
  predicted_value_currency text NOT NULL DEFAULT 'USD',
  confidence_score numeric NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  method text NOT NULL DEFAULT '',
  prediction_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  based_on jsonb NOT NULL DEFAULT '[]'::jsonb,
  predicted_for date,
  actual_value numeric,
  accuracy_score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz
);
CREATE INDEX IF NOT EXISTS insights_predictions_store ON insights_predictions (store_id, prediction_horizon, created_at DESC);
ALTER TABLE insights_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_predictions_tenant_isolation ON insights_predictions USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_preferences (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  auto_discovery_enabled boolean NOT NULL DEFAULT true,
  discovery_frequency text NOT NULL DEFAULT 'DAILY' CHECK (discovery_frequency IN ('REALTIME','DAILY','WEEKLY')),
  discovery_categories text[] NOT NULL DEFAULT '{REVENUE,CUSTOMERS,PRODUCTS,OPERATIONS,MARKETING,TIME}',
  notification_preferences jsonb NOT NULL DEFAULT '{"highConfidenceDiscoveries":true,"trendAlerts":true,"weeklyDigest":false,"anomalyAlerts":true}'::jsonb,
  trend_monitoring_enabled boolean NOT NULL DEFAULT true,
  persona_updates_enabled boolean NOT NULL DEFAULT true,
  api_access_enabled boolean NOT NULL DEFAULT false,
  api_key text,
  api_rate_limit int,
  last_discovery_run_at timestamptz,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE insights_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_preferences_tenant_isolation ON insights_preferences USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));

CREATE TABLE IF NOT EXISTS insights_api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  request_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_size int NOT NULL DEFAULT 0,
  rate_limit_remaining int,
  called_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insights_api_usage_store ON insights_api_usage (store_id, called_at DESC);
ALTER TABLE insights_api_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY insights_api_usage_tenant_isolation ON insights_api_usage USING (store_id::text = current_setting('app.store_id', true)) WITH CHECK (store_id::text = current_setting('app.store_id', true));
