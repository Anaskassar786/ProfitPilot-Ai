-- PR #48: Store Coach — the first section of the AI Growth Command module.
-- A merchant's personal AI business advisor: daily huddles, priorities, goals,
-- achievements, progress tracking, and conversational chat.
--
-- Every table is tenant-isolated via RLS using the same policy pattern as the
-- rest of the data plane (app.store_id session setting). Two helper tables are
-- included beyond the PR spec because the listed endpoints need durable state:
--   * store_coach_onboarding  (backing GET/POST /store-coach/onboarding/*)
--   * store_coach_usage_daily (backing GET /store-coach/usage chat meters)

-- 1. Daily briefings. One huddle per store per calendar day (merchant timezone
--    is resolved at generation time; the stored date is the merchant-local
--    day it was generated for).
CREATE TABLE IF NOT EXISTS store_coach_huddles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  huddle_date date NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_coach_huddles_store_day_unique UNIQUE (store_id, huddle_date)
);
CREATE INDEX IF NOT EXISTS store_coach_huddles_store_created ON store_coach_huddles (store_id, created_at DESC);

-- 2. Today's actions (priorities). Expiry sweep moves PENDING rows past
--    expires_at to EXPIRED.
CREATE TABLE IF NOT EXISTS store_coach_priorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  priority_date date NOT NULL,
  category text NOT NULL CHECK (category IN ('HIGH_IMPACT', 'QUICK_WIN', 'OPPORTUNITY')),
  title text NOT NULL,
  description text NOT NULL,
  impact_value numeric(20, 4) NOT NULL DEFAULT 0,
  impact_currency text NOT NULL DEFAULT 'USD',
  impact_label text NOT NULL DEFAULT '',
  time_estimate_minutes integer NOT NULL DEFAULT 15,
  action_type text NOT NULL DEFAULT '',
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'DISMISSED', 'EXPIRED')),
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_coach_priorities_store_day ON store_coach_priorities (store_id, priority_date, status);
CREATE INDEX IF NOT EXISTS store_coach_priorities_expiry ON store_coach_priorities (status, expires_at) WHERE expires_at IS NOT NULL;

-- 3. Weekly/monthly goals with live progress and feasibility.
CREATE TABLE IF NOT EXISTS store_coach_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  goal_type text NOT NULL DEFAULT 'WEEKLY' CHECK (goal_type IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  metric text NOT NULL DEFAULT 'REVENUE' CHECK (metric IN ('REVENUE', 'ORDERS', 'CUSTOMERS', 'AOV', 'RETENTION', 'CUSTOM')),
  target_value numeric(20, 4) NOT NULL,
  target_currency text NOT NULL DEFAULT 'USD',
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED')),
  current_progress numeric(20, 4) NOT NULL DEFAULT 0,
  feasibility text NOT NULL DEFAULT 'MEDIUM' CHECK (feasibility IN ('HIGH', 'MEDIUM', 'LOW')),
  achieved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_coach_goals_store_status ON store_coach_goals (store_id, status);
CREATE INDEX IF NOT EXISTS store_coach_goals_store_window ON store_coach_goals (store_id, start_date, end_date);

-- 4. Badges earned. (store_id, badge_id) is unique — a badge is earned once.
CREATE TABLE IF NOT EXISTS store_coach_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  badge_id text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT store_coach_achievements_store_badge_unique UNIQUE (store_id, badge_id)
);
CREATE INDEX IF NOT EXISTS store_coach_achievements_store_earned ON store_coach_achievements (store_id, earned_at DESC);

-- 5. Chat history. One rolling conversation per store; messages is a jsonb
--    array of { role, content, timestamp, evidence }.
CREATE TABLE IF NOT EXISTS store_coach_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Per-store settings. huddle_time is stored in minutes-since-midnight in
--    the merchant's store timezone.
CREATE TABLE IF NOT EXISTS store_coach_preferences (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  personality text NOT NULL DEFAULT 'PROFESSIONAL' CHECK (personality IN ('PROFESSIONAL', 'MOTIVATIONAL', 'ANALYTICAL', 'CASUAL')),
  huddle_time_minutes integer NOT NULL DEFAULT 420 CHECK (huddle_time_minutes >= 0 AND huddle_time_minutes < 1440),
  huddle_enabled boolean NOT NULL DEFAULT true,
  weekly_email_enabled boolean NOT NULL DEFAULT true,
  voice_enabled boolean NOT NULL DEFAULT false,
  widget_enabled boolean NOT NULL DEFAULT false,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
  notification_frequency text NOT NULL DEFAULT 'NORMAL' CHECK (notification_frequency IN ('LOW', 'NORMAL', 'HIGH')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7. Engagement scoring. Kept as a series so health trendlines are real.
CREATE TABLE IF NOT EXISTS store_coach_health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  factors jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS store_coach_health_scores_store_calculated ON store_coach_health_scores (store_id, calculated_at DESC);

-- 8. Weekly PDF reports (Commander plan only).
CREATE TABLE IF NOT EXISTS store_coach_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  report_type text NOT NULL DEFAULT 'WEEKLY' CHECK (report_type IN ('WEEKLY', 'MONTHLY')),
  report_date date NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_url text,
  sent_via_email boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_coach_reports_store_date ON store_coach_reports (store_id, report_date DESC);

-- 9. Daily streak tracking. One row per store, upserted on every huddle view.
CREATE TABLE IF NOT EXISTS store_coach_streaks (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_active_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 10. Onboarding progress (5 steps). step_completed is the highest step the
--     merchant finished; skipped_at records an explicit skip.
CREATE TABLE IF NOT EXISTS store_coach_onboarding (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 0 CHECK (current_step >= 0 AND current_step <= 5),
  completed boolean NOT NULL DEFAULT false,
  skipped_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 11. Daily usage meters (chat messages, generated huddles) so plan limits
--     survive restarts and can be surfaced in GET /store-coach/usage.
CREATE TABLE IF NOT EXISTS store_coach_usage_daily (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  usage_day date NOT NULL,
  chat_messages integer NOT NULL DEFAULT 0,
  huddles_generated integer NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, usage_day)
);

-- RLS: tenant isolation for every Store Coach table.
ALTER TABLE store_coach_huddles ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_coach_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_coach_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_coach_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_coach_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_coach_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_coach_health_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_coach_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_coach_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_coach_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_coach_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_coach_huddles_tenant_isolation ON store_coach_huddles USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY store_coach_priorities_tenant_isolation ON store_coach_priorities USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY store_coach_goals_tenant_isolation ON store_coach_goals USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY store_coach_achievements_tenant_isolation ON store_coach_achievements USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY store_coach_conversations_tenant_isolation ON store_coach_conversations USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY store_coach_preferences_tenant_isolation ON store_coach_preferences USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY store_coach_health_scores_tenant_isolation ON store_coach_health_scores USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY store_coach_reports_tenant_isolation ON store_coach_reports USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY store_coach_streaks_tenant_isolation ON store_coach_streaks USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY store_coach_onboarding_tenant_isolation ON store_coach_onboarding USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY store_coach_usage_daily_tenant_isolation ON store_coach_usage_daily USING (store_id::text = current_setting('app.store_id', true));
