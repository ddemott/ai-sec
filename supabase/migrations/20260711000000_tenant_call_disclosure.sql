-- Per-tenant, editable caller disclosure (the spoken AI + call-transcription
-- notice) with a recorded attestation.
--
-- Background: every inbound call opens with a fixed platform disclosure
-- (agent/src/greeting.ts) telling the caller they reached an AI assistant and
-- that the call is transcribed for quality and service. Some tenants have a
-- legitimate need to change the WORDING — a non-English business, a brand voice,
-- or their own counsel-approved script. The platform's job is a safe default
-- plus a recorded attestation, not a straitjacket: docs/legaldocs/
-- AI_Secretary_Consent_and_Privacy_Language.md already assigns the duty to
-- inform callers to the tenant.
--
--   call_disclosure — the spoken disclosure line. NULL or blank means "use the
--                     platform default" (buildDisclosure() in greeting.ts), so
--                     an existing tenant, or one who clears the field, always
--                     gets a compliant line. Owner-editable.
--
--   call_disclosure_attested_at / _by — stamped when an owner SAVES a custom
--                     disclosure. An attestation that is not recorded is
--                     worthless as a defense, so the affirmative act is captured
--                     on the row (in addition to the fn_audit_trigger row that
--                     records the text change itself). NULL = never customized;
--                     the default is in force.
--
-- Forward-only safe: ADD COLUMN IF NOT EXISTS, all nullable, no backfill. NULL
-- across the board reproduces today's behavior (platform default spoken), so
-- existing tenants are unaffected.

BEGIN;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS call_disclosure TEXT,
    ADD COLUMN IF NOT EXISTS call_disclosure_attested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS call_disclosure_attested_by UUID REFERENCES users(user_id);

COMMENT ON COLUMN tenants.call_disclosure IS 'Spoken caller disclosure (AI + transcription notice). NULL/blank = platform default from greeting.ts. Owner-editable, requires attestation to change.';
COMMENT ON COLUMN tenants.call_disclosure_attested_at IS 'When the owner attested a custom call_disclosure meets their state disclosure laws. NULL = never customized (default in force).';
COMMENT ON COLUMN tenants.call_disclosure_attested_by IS 'user_id of the owner who attested the custom call_disclosure. FK users(user_id).';

COMMIT;
