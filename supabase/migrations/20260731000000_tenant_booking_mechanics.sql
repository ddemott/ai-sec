-- booking_mechanics: what ACTUALLY HAPPENS at the booked time, in the owner's words.
--
-- "Booked a call" has no call mechanics. The system writes a meeting row and
-- nobody ever defines who dials whom — so when a caller asked the obvious
-- question, the model confabulated the most agreeable answer. On 2026-07-27
-- (SCL_6QQqjBf7kNQj, CALL_IMPROVEMENTS.md #9) it told the caller to "call Dale
-- directly at two thirty PM today… you can use the same number." The same
-- number IS the AI receptionist's line. That single sentence produced FOUR more
-- failed calls from the same caller that afternoon (#5-#8): she dialed the
-- number she was given, at the time she was given, and got the AI menu again.
--
-- The cure is not a better prompt — the model had no ground truth to state. It
-- is a FACT the owner supplies once, spoken verbatim at every booking:
--   phone consult   → "Dale will call you at this number at the booked time."
--   in-shop service → "Come by the shop at your appointment time."
--   mobile service  → "Our tech will come to you at the address you gave."
--
-- NULL/blank = the confirmation says nothing extra (current behaviour, and the
-- right default for a tenant who has not thought about it — silence is not a
-- lie). Owner-editable on Phone Assistant → AI Persona.
ALTER TABLE tenants
  ADD COLUMN booking_mechanics TEXT;

COMMENT ON COLUMN tenants.booking_mechanics IS
  'Spoken verbatim after a successful booking: what happens at the appointment time (who calls whom / where to go). NULL = say nothing extra.';
