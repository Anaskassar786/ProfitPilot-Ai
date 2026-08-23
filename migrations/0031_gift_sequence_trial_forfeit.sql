-- Gift-code sequencing + permanent trial forfeiture (GA 2026-08-22).
--
-- 1. gift_codes.sequence encodes primary/secondary redemption order:
--    sequence 1 is the active primary code, sequence 2 is secondary. A
--    secondary code is only redeemable once the primary has reached its
--    usage cap or been marked inactive/expired. Codes themselves are
--    configuration (GIFT_CODE_SEQUENCE_1/2 env vars), never repository
--    source, so this migration does not reference any literal code.
-- 2. trials.trial_forfeited permanently voids the 14-day trial when a gift is
--    redeemed: once the gift window closes the store transitions straight to
--    TRIAL_EXPIRED (locked) with zero remaining trial days.
-- Both columns are backward compatible (NULL/default on existing rows).
ALTER TABLE gift_codes ADD COLUMN IF NOT EXISTS sequence integer NOT NULL DEFAULT 0;
-- Existing codes (sequence 0) are ordered deterministically by code so the
-- primary/secondary invariant holds; boot-time seeding of env-configured
-- codes assigns explicit sequences for fresh databases.
UPDATE gift_codes SET sequence = sub.seq
FROM (
  SELECT code, row_number() OVER (ORDER BY code) AS seq FROM gift_codes WHERE sequence = 0
) sub
WHERE gift_codes.code = sub.code AND gift_codes.sequence = 0;

ALTER TABLE trials ADD COLUMN IF NOT EXISTS trial_forfeited boolean NOT NULL DEFAULT false;
