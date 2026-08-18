-- PR #46: recommendation lifecycle metadata.
-- Adds decision audit fields, entity linkage, time sensitivity, and snooze
-- state to ai_recommendations. Historical rows keep NULLs — the API treats a
-- NULL decided_at on a decided row as "decided before lifecycle tracking".
ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS entity_key text;
ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

-- Supports the expiry sweep (PENDING rows past their expiry window).
CREATE INDEX IF NOT EXISTS ai_recommendations_store_expiry
  ON ai_recommendations (store_id, status, expires_at)
  WHERE expires_at IS NOT NULL;

-- Supports impact-sorted list queries without a full payload scan.
CREATE INDEX IF NOT EXISTS ai_recommendations_store_created
  ON ai_recommendations (store_id, created_at DESC);
