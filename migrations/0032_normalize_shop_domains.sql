-- 0032: permanently normalize stored shop domains.
--
-- Root cause of the embedded 401 loop: different code paths wrote the same
-- store under different spellings — `https://commander-pilot.myshopify.com`,
-- `Commander-Pilot.myshopify.com`, `commander-pilot.myshopify.com/` — while
-- the App Bridge session token's `dest` claim always normalizes to
-- `commander-pilot.myshopify.com`. The lookup missed the row, the API answered
-- 401 STORE_NOT_FOUND, and the merchant saw "Session expired" forever. RLS on
-- `stores` / `shopify_tokens` compares `shop_domain` to the `app.shop_domain`
-- setting byte-for-byte, so a mis-spelled row is invisible rather than merely
-- unmatched.
--
-- The application now normalizes at every entry point (packages/shopify
-- normalizeShopDomain + packages/db normalizeShopDomain). This migration
-- repairs rows written by earlier deploys. It is idempotent, and it never
-- touches a row whose normalized form would collide with an existing row
-- (the canonical row already exists in that case).

-- stores ---------------------------------------------------------------------
UPDATE stores AS s
SET shop_domain = lower(btrim(regexp_replace(regexp_replace(s.shop_domain, '^https?://', '', 'i'), '/+$', ''))),
    updated_at = now()
WHERE s.shop_domain <> lower(btrim(regexp_replace(regexp_replace(s.shop_domain, '^https?://', '', 'i'), '/+$', '')))
  AND NOT EXISTS (
    SELECT 1 FROM stores AS other
    WHERE other.id <> s.id
      AND other.shop_domain = lower(btrim(regexp_replace(regexp_replace(s.shop_domain, '^https?://', '', 'i'), '/+$', '')))
  );

-- shopify_tokens (the offline access-token vault) -----------------------------
UPDATE shopify_tokens AS t
SET shop_domain = lower(btrim(regexp_replace(regexp_replace(t.shop_domain, '^https?://', '', 'i'), '/+$', '')))
WHERE t.shop_domain <> lower(btrim(regexp_replace(regexp_replace(t.shop_domain, '^https?://', '', 'i'), '/+$', '')))
  AND NOT EXISTS (
    SELECT 1 FROM shopify_tokens AS other
    WHERE other.shop_domain <> t.shop_domain
      AND other.shop_domain = lower(btrim(regexp_replace(regexp_replace(t.shop_domain, '^https?://', '', 'i'), '/+$', '')))
  );

-- shopify_oauth_states: short-lived, but a mis-spelled shop makes the callback
-- fail state verification with "restart the install flow".
UPDATE shopify_oauth_states AS o
SET shop_domain = lower(btrim(regexp_replace(regexp_replace(o.shop_domain, '^https?://', '', 'i'), '/+$', '')))
WHERE o.shop_domain <> lower(btrim(regexp_replace(regexp_replace(o.shop_domain, '^https?://', '', 'i'), '/+$', '')));

-- A store that completed OAuth must be reachable: an ACTIVE row is what every
-- status='ACTIVE' query and the embedded session lookup expect. Only rows that
-- still hold a live offline access token are revived — an intentionally
-- uninstalled store keeps its UNINSTALLED status because its token is deleted
-- by the app/uninstalled webhook.
UPDATE stores AS s
SET status = 'ACTIVE', uninstalled_at = NULL, updated_at = now()
WHERE s.status <> 'ACTIVE'
  AND EXISTS (SELECT 1 FROM shopify_tokens AS t WHERE t.shop_domain = s.shop_domain);
