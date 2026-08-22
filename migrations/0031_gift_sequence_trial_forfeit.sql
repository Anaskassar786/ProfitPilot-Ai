-- Gift-code sequencing + permanent trial forfeiture (GA 2026-08-22).
--
-- 1. gift_codes.sequence encodes primary/secondary redemption order:
--    KASSAR786 = 1 (primary), AFRIDI786 = 2 (secondary). A secondary code is
--    only redeemable once the primary has reached its usage cap or been
--    marked inactive/expired.
-- 2. trials.trial_forfeited permanently voids the 14-day trial when a gift is
--    redeemed: once the gift window closes the store transitions straight to
--    TRIAL_EXPIRED (locked) with zero remaining trial days.
-- Both columns are backward compatible (NULL/default on existing rows).
ALTER TABLE gift_codes ADD COLUMN IF NOT EXISTS sequence integer NOT NULL DEFAULT 0;
UPDATE gift_codes SET sequence = 1 WHERE upper(code) = 'KASSAR786' AND sequence = 0;
UPDATE gift_codes SET sequence = 2 WHERE upper(code) = 'AFRIDI786' AND sequence = 0;
-- Any remaining custom/env-seeded codes (sequence 0) are ordered by code so
-- the primary/secondary invariant holds for non-default setups too.
UPDATE gift_codes SET sequence = sub.seq
FROM (
  SELECT code, row_number() OVER (ORDER BY code) AS seq FROM gift_codes WHERE sequence = 0
) sub
WHERE gift_codes.code = sub.code;

ALTER TABLE trials ADD COLUMN IF NOT EXISTS trial_forfeited boolean NOT NULL DEFAULT false;
