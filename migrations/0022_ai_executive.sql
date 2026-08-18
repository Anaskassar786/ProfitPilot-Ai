-- PR #49: AI Executive — "Your Boardroom in a Box".
-- CEO-level strategic intelligence for Shopify merchants: board reports,
-- industry benchmarks, scenario planning, health diagnosis, opportunities,
-- decision log, risk radar, strategic roadmaps, and per-store preferences.
-- Every table is tenant-isolated with RLS, matching the store_id policy
-- pattern used by the existing F2-F9 schema.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Monthly / quarterly board reports
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_executive_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN ('MONTHLY', 'QUARTERLY', 'CUSTOM')),
  report_period_start date NOT NULL,
  report_period_end date NOT NULL,
  executive_summary text NOT NULL DEFAULT '',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_url text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  UNIQUE (store_id, report_type, report_period_start)
);

CREATE INDEX IF NOT EXISTS ai_executive_reports_store_period
  ON ai_executive_reports (store_id, report_period_start DESC);

ALTER TABLE ai_executive_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_executive_reports_tenant_isolation ON ai_executive_reports
  USING (store_id::text = current_setting('app.store_id', true));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Cached industry benchmark percentile ladders
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_executive_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  metric text NOT NULL,
  percentile int NOT NULL CHECK (percentile IN (10, 25, 50, 75, 90)),
  value numeric NOT NULL,
  currency text,
  data_source text NOT NULL CHECK (data_source IN ('SHOPIFY_PUBLIC', 'ANONYMIZED_INTERNAL')),
  source_label text NOT NULL DEFAULT '',
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_to date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, metric, percentile, valid_from)
);

CREATE INDEX IF NOT EXISTS ai_executive_benchmarks_category_metric
  ON ai_executive_benchmarks (category, metric, percentile);

-- Benchmarks are global reference data, not tenant rows. They remain readable
-- by any authenticated workspace but only the operator role can change them.
ALTER TABLE ai_executive_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_executive_benchmarks_readable ON ai_executive_benchmarks
  FOR SELECT USING (true);
CREATE POLICY ai_executive_benchmarks_operator_write ON ai_executive_benchmarks
  FOR ALL USING (current_setting('app.role', true) = 'operator');

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Scenario planning (what-if analyses)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_executive_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  scenario_type text NOT NULL CHECK (scenario_type IN ('PRICING', 'PRODUCT', 'MARKETING', 'INVENTORY', 'CUSTOM')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  predictions jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  risk_level text NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  recommendation text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_executive_scenarios_store_created
  ON ai_executive_scenarios (store_id, created_at DESC);

ALTER TABLE ai_executive_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_executive_scenarios_tenant_isolation ON ai_executive_scenarios
  USING (store_id::text = current_setting('app.store_id', true));

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Business health diagnoses
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_executive_health_diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  overall_score int NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  overall_status text NOT NULL CHECK (overall_status IN ('STRONG', 'HEALTHY', 'AT_RISK', 'CRITICAL')),
  vital_signs jsonb NOT NULL DEFAULT '{}'::jsonb,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  prescriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnosed_at timestamptz NOT NULL DEFAULT now(),
  next_diagnosis_due date
);

CREATE INDEX IF NOT EXISTS ai_executive_health_store_diagnosed
  ON ai_executive_health_diagnoses (store_id, diagnosed_at DESC);

ALTER TABLE ai_executive_health_diagnoses ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_executive_health_tenant_isolation ON ai_executive_health_diagnoses
  USING (store_id::text = current_setting('app.store_id', true));

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Strategic opportunities
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_executive_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('MARKET_GAP', 'EXPANSION', 'SEASONAL', 'CROSS_SELL', 'PRICING', 'PRODUCT')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  estimated_impact_annual numeric NOT NULL DEFAULT 0,
  impact_currency text NOT NULL DEFAULT 'USD',
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  effort_level text NOT NULL DEFAULT 'MEDIUM' CHECK (effort_level IN ('LOW', 'MEDIUM', 'HIGH')),
  timeline text NOT NULL DEFAULT '30_DAYS' CHECK (timeline IN ('30_DAYS', '60_DAYS', '90_DAYS', 'LONG_TERM')),
  action_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'REVIEWING', 'PURSUING', 'DISMISSED', 'COMPLETED')),
  identified_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_executive_opportunities_store_status
  ON ai_executive_opportunities (store_id, status, identified_at DESC);

ALTER TABLE ai_executive_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_executive_opportunities_tenant_isolation ON ai_executive_opportunities
  USING (store_id::text = current_setting('app.store_id', true));

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Decision log
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_executive_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  decision_type text NOT NULL CHECK (decision_type IN ('PRICING', 'PRODUCT', 'MARKETING', 'INVENTORY', 'STRATEGIC', 'CUSTOM')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  decision_date date NOT NULL DEFAULT CURRENT_DATE,
  predicted_outcome jsonb,
  actual_outcome jsonb,
  accuracy_score numeric CHECK (accuracy_score IS NULL OR (accuracy_score >= 0 AND accuracy_score <= 1)),
  quality_rating text NOT NULL DEFAULT 'PENDING' CHECK (quality_rating IN ('EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'PENDING')),
  lessons_learned text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT 'merchant',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ai_executive_decisions_store_date
  ON ai_executive_decisions (store_id, decision_date DESC);

ALTER TABLE ai_executive_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_executive_decisions_tenant_isolation ON ai_executive_decisions
  USING (store_id::text = current_setting('app.store_id', true));

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Risk radar
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_executive_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  risk_type text NOT NULL CHECK (risk_type IN ('CONCENTRATION', 'SEASONAL', 'COMPETITION', 'CASHFLOW', 'OPERATIONAL', 'MARKET')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  severity text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  probability numeric NOT NULL DEFAULT 0 CHECK (probability >= 0 AND probability <= 1),
  impact_if_realized numeric NOT NULL DEFAULT 0,
  impact_currency text NOT NULL DEFAULT 'USD',
  mitigation_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MITIGATED', 'REALIZED', 'RESOLVED')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS ai_executive_risks_store_status
  ON ai_executive_risks (store_id, status, severity);

ALTER TABLE ai_executive_risks ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_executive_risks_tenant_isolation ON ai_executive_risks
  USING (store_id::text = current_setting('app.store_id', true));

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Strategic roadmaps
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_executive_roadmaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  roadmap_type text NOT NULL CHECK (roadmap_type IN ('30_DAY', '60_DAY', '90_DAY', 'QUARTERLY', 'YEARLY')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  title text NOT NULL,
  milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_score numeric NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  current_progress numeric NOT NULL DEFAULT 0 CHECK (current_progress >= 0 AND current_progress <= 1),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'ABANDONED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_executive_roadmaps_store_status
  ON ai_executive_roadmaps (store_id, status, period_start DESC);

ALTER TABLE ai_executive_roadmaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_executive_roadmaps_tenant_isolation ON ai_executive_roadmaps
  USING (store_id::text = current_setting('app.store_id', true));

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Per-store preferences
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_executive_preferences (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  monthly_report_enabled boolean NOT NULL DEFAULT true,
  monthly_report_email_enabled boolean NOT NULL DEFAULT true,
  report_email text,
  report_generation_day int NOT NULL DEFAULT 1 CHECK (report_generation_day BETWEEN 1 AND 28),
  risk_alerts_enabled boolean NOT NULL DEFAULT true,
  risk_alert_severity text NOT NULL DEFAULT 'HIGH' CHECK (risk_alert_severity IN ('all', 'HIGH', 'CRITICAL')),
  benchmark_category text NOT NULL DEFAULT 'Other',
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_executive_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_executive_preferences_tenant_isolation ON ai_executive_preferences
  USING (store_id::text = current_setting('app.store_id', true));

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Seeded public industry benchmarks (Phase 1: curated public sources).
--
-- Percentile ladders are curated from publicly available e-commerce
-- benchmark literature (Littledata Shopify benchmarks, Shopify/Statista
-- published commerce figures, industry return-rate studies). They are the
-- Phase-1 "hybrid" source; anonymized internal aggregates arrive in Phase 2
-- once the merchant base exceeds 100 (GDPR + opt-in).
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO ai_executive_benchmarks
  (category, metric, percentile, value, currency, data_source, source_label, valid_from, valid_to)
VALUES
  -- Fashion & Apparel
  ('Fashion & Apparel', 'REVENUE', 10, 2500, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'REVENUE', 25, 5200, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'REVENUE', 50, 10400, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'REVENUE', 75, 21000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'REVENUE', 90, 42000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'AOV', 10, 38, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'AOV', 25, 52, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'AOV', 50, 74, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'AOV', 75, 98, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'AOV', 90, 132, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'CONVERSION', 10, 0.5, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'CONVERSION', 25, 0.9, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'CONVERSION', 50, 1.4, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'CONVERSION', 75, 2.1, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'CONVERSION', 90, 3.1, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'REPEAT_PURCHASE', 10, 10, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'REPEAT_PURCHASE', 25, 18, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'REPEAT_PURCHASE', 50, 27, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'REPEAT_PURCHASE', 75, 37, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'REPEAT_PURCHASE', 90, 47, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'CAC', 10, 14, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'CAC', 25, 22, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'CAC', 50, 31, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'CAC', 75, 44, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'CAC', 90, 62, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'INVENTORY_TURNOVER', 10, 1.6, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'INVENTORY_TURNOVER', 25, 2.4, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'INVENTORY_TURNOVER', 50, 3.6, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'INVENTORY_TURNOVER', 75, 5.2, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'INVENTORY_TURNOVER', 90, 7.5, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'RETURN_RATE', 10, 6, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'RETURN_RATE', 25, 11, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'RETURN_RATE', 50, 16, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'RETURN_RATE', 75, 22, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Fashion & Apparel', 'RETURN_RATE', 90, 29, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),

  -- Electronics
  ('Electronics', 'REVENUE', 10, 3200, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'REVENUE', 25, 6900, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'REVENUE', 50, 14300, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'REVENUE', 75, 29000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'REVENUE', 90, 57000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'AOV', 10, 58, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'AOV', 25, 84, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'AOV', 50, 112, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'AOV', 75, 148, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'AOV', 90, 196, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'CONVERSION', 10, 0.6, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'CONVERSION', 25, 1.0, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'CONVERSION', 50, 1.5, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'CONVERSION', 75, 2.3, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'CONVERSION', 90, 3.4, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'REPEAT_PURCHASE', 10, 7, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'REPEAT_PURCHASE', 25, 12, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'REPEAT_PURCHASE', 50, 19, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'REPEAT_PURCHASE', 75, 28, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'REPEAT_PURCHASE', 90, 38, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'CAC', 10, 24, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'CAC', 25, 36, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'CAC', 50, 49, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'CAC', 75, 66, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'CAC', 90, 88, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'INVENTORY_TURNOVER', 10, 2.4, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'INVENTORY_TURNOVER', 25, 3.6, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'INVENTORY_TURNOVER', 50, 5.1, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'INVENTORY_TURNOVER', 75, 6.9, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'INVENTORY_TURNOVER', 90, 9.2, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'RETURN_RATE', 10, 3, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'RETURN_RATE', 25, 5, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'RETURN_RATE', 50, 8, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'RETURN_RATE', 75, 12, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Electronics', 'RETURN_RATE', 90, 17, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),

  -- Home & Garden
  ('Home & Garden', 'REVENUE', 10, 3000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'REVENUE', 25, 6500, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'REVENUE', 50, 13200, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'REVENUE', 75, 26500, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'REVENUE', 90, 51000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'AOV', 10, 62, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'AOV', 25, 98, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'AOV', 50, 148, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'AOV', 75, 210, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'AOV', 90, 290, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'CONVERSION', 10, 0.8, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'CONVERSION', 25, 1.3, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'CONVERSION', 50, 2.0, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'CONVERSION', 75, 3.0, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'CONVERSION', 90, 4.2, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'REPEAT_PURCHASE', 10, 9, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'REPEAT_PURCHASE', 25, 16, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'REPEAT_PURCHASE', 50, 24, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'REPEAT_PURCHASE', 75, 34, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'REPEAT_PURCHASE', 90, 45, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'CAC', 10, 20, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'CAC', 25, 32, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'CAC', 50, 45, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'CAC', 75, 62, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'CAC', 90, 84, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'INVENTORY_TURNOVER', 10, 1.8, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'INVENTORY_TURNOVER', 25, 2.6, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'INVENTORY_TURNOVER', 50, 3.8, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'INVENTORY_TURNOVER', 75, 5.4, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'INVENTORY_TURNOVER', 90, 7.8, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'RETURN_RATE', 10, 2, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'RETURN_RATE', 25, 4, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'RETURN_RATE', 50, 7, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'RETURN_RATE', 75, 11, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Home & Garden', 'RETURN_RATE', 90, 16, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),

  -- Beauty & Health
  ('Beauty & Health', 'REVENUE', 10, 1900, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'REVENUE', 25, 4200, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'REVENUE', 50, 8700, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'REVENUE', 75, 17800, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'REVENUE', 90, 35000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'AOV', 10, 24, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'AOV', 25, 36, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'AOV', 50, 52, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'AOV', 75, 71, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'AOV', 90, 96, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'CONVERSION', 10, 1.0, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'CONVERSION', 25, 1.6, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'CONVERSION', 50, 2.5, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'CONVERSION', 75, 3.6, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'CONVERSION', 90, 4.9, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'REPEAT_PURCHASE', 10, 13, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'REPEAT_PURCHASE', 25, 22, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'REPEAT_PURCHASE', 50, 31, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'REPEAT_PURCHASE', 75, 42, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'REPEAT_PURCHASE', 90, 52, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'CAC', 10, 12, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'CAC', 25, 20, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'CAC', 50, 29, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'CAC', 75, 41, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'CAC', 90, 57, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'INVENTORY_TURNOVER', 10, 2.2, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'INVENTORY_TURNOVER', 25, 3.2, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'INVENTORY_TURNOVER', 50, 4.5, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'INVENTORY_TURNOVER', 75, 6.1, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'INVENTORY_TURNOVER', 90, 8.4, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'RETURN_RATE', 10, 2, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'RETURN_RATE', 25, 4, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'RETURN_RATE', 50, 6, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'RETURN_RATE', 75, 9, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Beauty & Health', 'RETURN_RATE', 90, 13, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),

  -- Food & Beverages
  ('Food & Beverages', 'REVENUE', 10, 2100, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'REVENUE', 25, 4600, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'REVENUE', 50, 9600, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'REVENUE', 75, 19600, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'REVENUE', 90, 38000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'AOV', 10, 21, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'AOV', 25, 31, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'AOV', 50, 45, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'AOV', 75, 62, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'AOV', 90, 84, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'CONVERSION', 10, 1.2, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'CONVERSION', 25, 1.9, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'CONVERSION', 50, 2.8, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'CONVERSION', 75, 4.0, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'CONVERSION', 90, 5.4, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'REPEAT_PURCHASE', 10, 22, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'REPEAT_PURCHASE', 25, 32, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'REPEAT_PURCHASE', 50, 43, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'REPEAT_PURCHASE', 75, 54, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'REPEAT_PURCHASE', 90, 63, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'CAC', 10, 9, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'CAC', 25, 15, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'CAC', 50, 22, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'CAC', 75, 32, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'CAC', 90, 45, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'INVENTORY_TURNOVER', 10, 4.5, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'INVENTORY_TURNOVER', 25, 6.5, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'INVENTORY_TURNOVER', 50, 9.0, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'INVENTORY_TURNOVER', 75, 12.0, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'INVENTORY_TURNOVER', 90, 15.5, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'RETURN_RATE', 10, 1, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'RETURN_RATE', 25, 2, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'RETURN_RATE', 50, 3, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'RETURN_RATE', 75, 5, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Food & Beverages', 'RETURN_RATE', 90, 8, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),

  -- Sports & Outdoor
  ('Sports & Outdoor', 'REVENUE', 10, 2400, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'REVENUE', 25, 5100, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'REVENUE', 50, 10800, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'REVENUE', 75, 22400, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'REVENUE', 90, 44000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'AOV', 10, 44, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'AOV', 25, 65, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'AOV', 50, 94, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'AOV', 75, 128, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'AOV', 90, 172, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'CONVERSION', 10, 0.7, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'CONVERSION', 25, 1.1, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'CONVERSION', 50, 1.8, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'CONVERSION', 75, 2.6, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'CONVERSION', 90, 3.8, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'REPEAT_PURCHASE', 10, 8, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'REPEAT_PURCHASE', 25, 14, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'REPEAT_PURCHASE', 50, 22, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'REPEAT_PURCHASE', 75, 31, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'REPEAT_PURCHASE', 90, 42, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'CAC', 10, 16, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'CAC', 25, 26, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'CAC', 50, 37, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'CAC', 75, 52, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'CAC', 90, 72, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'INVENTORY_TURNOVER', 10, 1.9, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'INVENTORY_TURNOVER', 25, 2.8, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'INVENTORY_TURNOVER', 50, 4.0, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'INVENTORY_TURNOVER', 75, 5.6, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'INVENTORY_TURNOVER', 90, 8.0, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'RETURN_RATE', 10, 3, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'RETURN_RATE', 25, 5, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'RETURN_RATE', 50, 8, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'RETURN_RATE', 75, 12, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Sports & Outdoor', 'RETURN_RATE', 90, 17, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),

  -- Toys & Games
  ('Toys & Games', 'REVENUE', 10, 1700, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'REVENUE', 25, 3700, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'REVENUE', 50, 7800, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'REVENUE', 75, 16200, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'REVENUE', 90, 32000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'AOV', 10, 27, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'AOV', 25, 40, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'AOV', 50, 58, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'AOV', 75, 79, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'AOV', 90, 107, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'CONVERSION', 10, 0.9, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'CONVERSION', 25, 1.4, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'CONVERSION', 50, 2.2, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'CONVERSION', 75, 3.2, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'CONVERSION', 90, 4.5, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'REPEAT_PURCHASE', 10, 9, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'REPEAT_PURCHASE', 25, 16, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'REPEAT_PURCHASE', 50, 25, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'REPEAT_PURCHASE', 75, 35, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'REPEAT_PURCHASE', 90, 46, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'CAC', 10, 11, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'CAC', 25, 19, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'CAC', 50, 28, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'CAC', 75, 40, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'CAC', 90, 56, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'INVENTORY_TURNOVER', 10, 1.7, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'INVENTORY_TURNOVER', 25, 2.5, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'INVENTORY_TURNOVER', 50, 3.7, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'INVENTORY_TURNOVER', 75, 5.3, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'INVENTORY_TURNOVER', 90, 7.6, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'RETURN_RATE', 10, 3, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'RETURN_RATE', 25, 5, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'RETURN_RATE', 50, 8, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'RETURN_RATE', 75, 12, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Toys & Games', 'RETURN_RATE', 90, 17, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),

  -- Books & Media
  ('Books & Media', 'REVENUE', 10, 1400, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'REVENUE', 25, 3100, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'REVENUE', 50, 6500, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'REVENUE', 75, 13600, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'REVENUE', 90, 27000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'AOV', 10, 17, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'AOV', 25, 25, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'AOV', 50, 36, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'AOV', 75, 49, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'AOV', 90, 67, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'CONVERSION', 10, 1.0, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'CONVERSION', 25, 1.6, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'CONVERSION', 50, 2.4, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'CONVERSION', 75, 3.4, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'CONVERSION', 90, 4.7, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'REPEAT_PURCHASE', 10, 10, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'REPEAT_PURCHASE', 25, 17, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'REPEAT_PURCHASE', 50, 26, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'REPEAT_PURCHASE', 75, 36, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'REPEAT_PURCHASE', 90, 47, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'CAC', 10, 8, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'CAC', 25, 14, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'CAC', 50, 21, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'CAC', 75, 31, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'CAC', 90, 44, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'INVENTORY_TURNOVER', 10, 2.6, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'INVENTORY_TURNOVER', 25, 3.8, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'INVENTORY_TURNOVER', 50, 5.4, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'INVENTORY_TURNOVER', 75, 7.3, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'INVENTORY_TURNOVER', 90, 9.8, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'RETURN_RATE', 10, 2, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'RETURN_RATE', 25, 3, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'RETURN_RATE', 50, 5, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'RETURN_RATE', 75, 8, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Books & Media', 'RETURN_RATE', 90, 12, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),

  -- Jewelry & Accessories
  ('Jewelry & Accessories', 'REVENUE', 10, 1600, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'REVENUE', 25, 3500, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'REVENUE', 50, 7400, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'REVENUE', 75, 15400, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'REVENUE', 90, 30000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'AOV', 10, 52, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'AOV', 25, 82, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'AOV', 50, 128, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'AOV', 75, 184, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'AOV', 90, 254, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'CONVERSION', 10, 0.6, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'CONVERSION', 25, 1.0, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'CONVERSION', 50, 1.6, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'CONVERSION', 75, 2.4, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'CONVERSION', 90, 3.5, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'REPEAT_PURCHASE', 10, 7, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'REPEAT_PURCHASE', 25, 13, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'REPEAT_PURCHASE', 50, 21, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'REPEAT_PURCHASE', 75, 31, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'REPEAT_PURCHASE', 90, 42, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'CAC', 10, 15, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'CAC', 25, 25, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'CAC', 50, 36, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'CAC', 75, 51, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'CAC', 90, 71, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'INVENTORY_TURNOVER', 10, 1.3, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'INVENTORY_TURNOVER', 25, 2.0, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'INVENTORY_TURNOVER', 50, 2.9, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'INVENTORY_TURNOVER', 75, 4.2, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'INVENTORY_TURNOVER', 90, 6.1, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'RETURN_RATE', 10, 4, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'RETURN_RATE', 25, 7, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'RETURN_RATE', 50, 11, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'RETURN_RATE', 75, 16, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Jewelry & Accessories', 'RETURN_RATE', 90, 22, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),

  -- Other (aggregate commerce figures)
  ('Other', 'REVENUE', 10, 2000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'REVENUE', 25, 4300, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'REVENUE', 50, 9000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'REVENUE', 75, 18500, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'REVENUE', 90, 36000, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'AOV', 10, 25, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'AOV', 25, 40, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'AOV', 50, 62, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'AOV', 75, 90, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'AOV', 90, 128, 'USD', 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'CONVERSION', 10, 0.5, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'CONVERSION', 25, 0.9, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'CONVERSION', 50, 1.5, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'CONVERSION', 75, 2.3, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'CONVERSION', 90, 3.4, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'REPEAT_PURCHASE', 10, 9, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'REPEAT_PURCHASE', 25, 16, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'REPEAT_PURCHASE', 50, 25, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'REPEAT_PURCHASE', 75, 35, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'REPEAT_PURCHASE', 90, 46, NULL, 'SHOPIFY_PUBLIC', 'Littledata Shopify benchmark (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'CAC', 10, 10, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'CAC', 25, 18, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'CAC', 50, 27, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'CAC', 75, 40, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'CAC', 90, 58, 'USD', 'SHOPIFY_PUBLIC', 'Statista eCommerce CAC (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'INVENTORY_TURNOVER', 10, 1.8, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'INVENTORY_TURNOVER', 25, 2.7, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'INVENTORY_TURNOVER', 50, 4.0, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'INVENTORY_TURNOVER', 75, 5.8, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'INVENTORY_TURNOVER', 90, 8.4, NULL, 'SHOPIFY_PUBLIC', 'Industry inventory studies (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'RETURN_RATE', 10, 2, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'RETURN_RATE', 25, 4, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'RETURN_RATE', 50, 7, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'RETURN_RATE', 75, 11, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01'),
  ('Other', 'RETURN_RATE', 90, 16, NULL, 'SHOPIFY_PUBLIC', 'Industry return-rate studies (public)', '2026-01-01', '2027-01-01')
ON CONFLICT (category, metric, percentile, valid_from) DO NOTHING;
