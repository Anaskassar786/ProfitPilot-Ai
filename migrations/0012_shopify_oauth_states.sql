-- F10: OAuth state tokens shared across API processes.
-- The /shopify/install redirect and the /shopify/callback request can be served
-- by different processes (restarts, replicas, deploys), so single-use state
-- tokens are persisted here instead of in process memory. consume() runs
-- DELETE ... RETURNING, which burns each token atomically.
CREATE TABLE IF NOT EXISTS shopify_oauth_states (
  token text PRIMARY KEY,
  shop_domain text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shopify_oauth_states_expires_at_idx ON shopify_oauth_states (expires_at);

-- No row-level security on this table: rows are transient single-use CSRF
-- tokens whose callback-time consumer cannot carry an authenticated tenant
-- context yet; possession of the random 256-bit token plus HMAC proof is the
-- capability. Expired rows are garbage-collected by the issuing path.
