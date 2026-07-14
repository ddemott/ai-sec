-- THERE ARE TWO COMPANIES IN A STAFFING CALL, AND WE ONLY RECORDED ONE.
--
-- A recruiter rings about a contract. There is:
--
--   CALLER'S COMPANY  — the agency they work for, and the outfit you will be
--                       negotiating your rate with (TEKsystems, Insight Global, a
--                       one-man shop nobody has heard of).
--   CLIENT COMPANY    — where the work would actually happen, and the name on the
--                       badge (Blue Cross Blue Shield).
--
-- These are different facts, and both matter. The client tells you whether the work
-- is interesting; the CALLER'S company tells you who you are actually dealing with —
-- whether they are a known agency or someone who found you on LinkedIn, and whether
-- the rate they quote has one middleman in it or three.
--
-- job_inquiries had a single `company` column and a `represents_company` boolean, so
-- the two collapsed into one and WHICH one you got depended on how the model felt.
-- On the real call (2026-07-14) it recorded company = 'Blue Cross Blue Shield' and
-- represents_company = false — so the owner knew where the work was and had NO IDEA
-- which agency had called him. He would ring the number back and be talking to a firm
-- he could not name.
--
-- The existing column holds the CLIENT on the calls we have (the model reached for the
-- more prominent name), so that is the honest rename. The caller's own company was
-- never captured at all, so it is a new column with no backfill to do — and it is
-- NULL on old rows because we genuinely do not know it, which is the truth.
--
-- represents_company survives and gets sharper: TRUE means the caller works directly
-- for the client (an in-house recruiter), in which case the two companies are the same.

ALTER TABLE job_inquiries RENAME COLUMN company TO client_company;

COMMENT ON COLUMN job_inquiries.client_company IS
  'Where the work would actually happen — the end client (e.g. Blue Cross Blue Shield).';

ALTER TABLE job_inquiries ADD COLUMN caller_company TEXT;

COMMENT ON COLUMN job_inquiries.caller_company IS
  'The company the CALLER works for — the staffing agency placing the role. Equals client_company when represents_company is true (an in-house recruiter). NULL on rows captured before 2026-07-14, when we never asked.';

COMMENT ON COLUMN job_inquiries.represents_company IS
  'True when the caller works directly for the client company (in-house recruiter), so caller_company = client_company. False = an agency placing on a client''s behalf.';
