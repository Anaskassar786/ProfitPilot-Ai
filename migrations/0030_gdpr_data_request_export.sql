-- GDPR customers/data_request fulfillment: persist the compiled customer data
-- export on the compliance request row so a data_request is actually
-- fulfilled (not just logged as RECEIVED) and the same audit row is purged in
-- the customers/redact transaction once the customer is erased.
ALTER TABLE privacy_compliance_requests ADD COLUMN IF NOT EXISTS export_data jsonb;
