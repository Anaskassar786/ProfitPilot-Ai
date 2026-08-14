-- F7: SOC-2-Lite access review assignments and immutable administrative history.
CREATE TABLE IF NOT EXISTS access_review_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES roles(id),
  assigned_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL CHECK (version > 0),
  revoked_at timestamptz,
  UNIQUE (store_id, user_id)
);

CREATE TABLE IF NOT EXISTS access_review_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  before_role text REFERENCES roles(id),
  after_role text REFERENCES roles(id),
  at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS access_review_audit_store_at ON access_review_audit (store_id, at, id);

ALTER TABLE access_review_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_review_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_review_assignments_tenant_isolation ON access_review_assignments
  USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY access_review_audit_tenant_isolation ON access_review_audit
  USING (store_id::text = current_setting('app.store_id', true));
