-- QA (2026-08-20): gift codes had no expiry field, so an expired code and a
-- wrong code produced the same "Gift code is invalid or exhausted" error.
-- Merchants deserve a distinct "This gift code has expired" message, so add
-- an optional expires_at column (NULL = never expires). Backward compatible.
ALTER TABLE gift_codes ADD COLUMN IF NOT EXISTS expires_at timestamptz;
