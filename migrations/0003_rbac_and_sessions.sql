-- F1: seeded roles, permissions, membership assignments, and rotating sessions.
CREATE TABLE IF NOT EXISTS roles (
  id text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS member_roles (
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES roles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  replaced_by uuid REFERENCES auth_sessions(id),
  reuse_detected_at timestamptz
);

INSERT INTO roles (id, description) VALUES
  ('owner', 'Full store ownership'),
  ('admin', 'Store administration without billing writes'),
  ('operator', 'Operational store actions'),
  ('analyst', 'Read-only analytics and evidence'),
  ('viewer', 'Basic read-only access')
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (id, description) VALUES
  ('store:read', 'Read store settings'), ('store:write', 'Update store settings'),
  ('orders:read', 'Read orders'), ('orders:write', 'Operate orders'),
  ('customers:read', 'Read minimized customer records'), ('customers:write', 'Operate customer tags'),
  ('catalog:read', 'Read catalog'), ('catalog:write', 'Update catalog metadata'),
  ('recommendations:read', 'Read recommendations'), ('recommendations:approve', 'Approve recommendations'),
  ('analytics:read', 'Read analytics'),
  ('automation:read', 'Read workflows'), ('automation:write', 'Edit workflows'),
  ('billing:read', 'Read billing'), ('billing:write', 'Change billing'),
  ('team:read', 'Read team'), ('team:write', 'Manage team'), ('audit:read', 'Read audit events')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'admin', id FROM permissions WHERE id <> 'billing:write' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'operator', id FROM permissions WHERE id IN ('store:read', 'orders:read', 'orders:write', 'customers:read', 'customers:write', 'catalog:read', 'recommendations:read', 'recommendations:approve', 'automation:read', 'automation:write', 'audit:read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'analyst', id FROM permissions WHERE id IN ('store:read', 'orders:read', 'customers:read', 'catalog:read', 'recommendations:read', 'analytics:read', 'audit:read') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'viewer', id FROM permissions WHERE id IN ('store:read', 'orders:read', 'customers:read', 'catalog:read', 'recommendations:read') ON CONFLICT DO NOTHING;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_roles_tenant_isolation ON member_roles
  USING (store_id::text = current_setting('app.store_id', true));
CREATE POLICY auth_sessions_tenant_isolation ON auth_sessions
  USING (store_id::text = current_setting('app.store_id', true));
