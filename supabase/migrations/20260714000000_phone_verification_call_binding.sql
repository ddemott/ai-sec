-- Bind a phone verification to the CALL it was proved on.
--
-- THE HOLE (found 2026-07-13, one day after the gate shipped):
--
-- The disclosure gate accepted ANY verified row for (tenant_id, phone) in the
-- last 24 hours. Nothing tied it to the call in progress. So:
--
--   09:00  Camille rings the forwarded line, says her number, reads back the
--          4-digit code we texted her. Verified. Correct.
--   09:05  A stranger rings the same line and says Camille's number.
--          The gate finds her 09:00 row, and hands over her name, her
--          preferences and her call history. No code. No challenge.
--
-- For the next 24 hours, ANY caller who speaks a number that someone once
-- verified is treated as that person. The gate degrades into "was this number
-- ever verified recently" — which is the claim-based trust it was built to
-- destroy. One legitimate verification opened a 24-hour window for everyone.
--
-- Possession must be proven on THE CALL WHERE IT IS USED. A code proves you
-- held the handset at that moment; it does not make the number yours forever.
--
-- Consequence, accepted deliberately: on a forwarded line (no caller-ID) a
-- returning customer verifies on every call. That is the true cost of a line
-- that cannot tell us who is calling. On a normal line the carrier attests the
-- number and no OTP is ever needed — so this cost falls only where it must.
--
-- NULL call_id = a verification that can never satisfy the gate. Fail closed:
-- an unattributable proof is not a proof.

ALTER TABLE phone_verifications
  ADD COLUMN IF NOT EXISTS call_id TEXT;

COMMENT ON COLUMN phone_verifications.call_id IS
  'The voice call this verification was proved on. The disclosure gate requires a verified row whose call_id matches the live call — a code proves possession at a moment, not ownership of the number forever. NULL can never satisfy the gate (fail closed).';

-- The gate''s exact lookup: verified, for this call, for this number.
CREATE INDEX IF NOT EXISTS idx_phone_verifications_verified_call
  ON phone_verifications (tenant_id, phone, call_id)
  WHERE verified_at IS NOT NULL;

-- Existing verified rows have no call_id and therefore stop satisfying the gate
-- the moment this lands. That is the intended effect, not collateral damage:
-- every one of them is a row that could be replayed by a stranger. There are
-- none in production (the OTP flow has never run against a real caller), so
-- this deliberately-breaking change costs nothing today and would be far more
-- expensive to make later.
