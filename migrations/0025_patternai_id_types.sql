-- PatternAI (formerly Insights Hub) — critical schema repair.
--
-- Root cause of the "Internal server error" crash on the module page:
-- migration 0024 declared every primary key as `uuid`, but the deterministic
-- discovery engine in @profitpilot/ai mints stable, content-addressed ids such
-- as `disc_1f4c…`, `pat_…`, `pers_…`, `lesson_…`, `pred_…`, `evt_…`. Every
-- INSERT therefore failed with `invalid input syntax for type uuid`, which
-- bubbled up as a 500 from /insights/overview, /insights/discoveries/feed and
-- every generation endpoint — the page could never finish loading.
--
-- This migration widens the affected id columns (and the two id-referencing
-- columns) to `text`, preserving every existing row. Table names stay
-- unchanged for backend compatibility; only the product name is rebranded.
--
-- The DO blocks are idempotent: they inspect information_schema first, so
-- re-running against an already-migrated database is a no-op.

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('insights_discoveries', 'id'),
      ('insights_lessons', 'id'),
      ('insights_patterns', 'id'),
      ('insights_personas', 'id'),
      ('insights_investigations', 'id'),
      ('insights_trends', 'id'),
      ('insights_comparisons', 'id'),
      ('insights_knowledge_base', 'id'),
      ('insights_timeline_events', 'id'),
      ('insights_timeline_events', 'entity_id'),
      ('insights_predictions', 'id'),
      ('insights_api_usage', 'id')
    ) AS t(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = target.table_name
        AND column_name = target.column_name
        AND data_type = 'uuid'
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', target.table_name, target.column_name);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE text USING %I::text', target.table_name, target.column_name, target.column_name);
      IF target.column_name = 'id' THEN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT gen_random_uuid()::text', target.table_name, target.column_name);
      END IF;
    END IF;
  END LOOP;
END
$$;

-- Knowledge-base cross links point at engine ids too (`disc_…`, `pat_…`).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'insights_knowledge_base'
      AND column_name = 'linked_insights'
      AND udt_name = '_uuid'
  ) THEN
    ALTER TABLE insights_knowledge_base ALTER COLUMN linked_insights DROP DEFAULT;
    ALTER TABLE insights_knowledge_base ALTER COLUMN linked_insights TYPE text[] USING linked_insights::text[];
    ALTER TABLE insights_knowledge_base ALTER COLUMN linked_insights SET DEFAULT '{}';
  END IF;
END
$$;

-- Patterns are upserted by (store, type, title); without this unique index the
-- repository fell back to a read-then-write race that duplicated rows whenever
-- two discovery sweeps overlapped.
CREATE UNIQUE INDEX IF NOT EXISTS insights_patterns_store_type_title
  ON insights_patterns (store_id, pattern_type, title);

-- Trends are upserted by (store, title) for the same reason.
CREATE UNIQUE INDEX IF NOT EXISTS insights_trends_store_title
  ON insights_trends (store_id, title);

-- The discovery feed reads NEW discoveries per store constantly; this partial
-- index keeps the first paint fast on large stores.
CREATE INDEX IF NOT EXISTS insights_discoveries_store_new
  ON insights_discoveries (store_id, discovered_at DESC)
  WHERE status = 'NEW';
