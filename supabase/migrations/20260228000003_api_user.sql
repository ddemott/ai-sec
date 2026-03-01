-- Create a restricted user for the API and Edge Functions
-- This user is subject to RLS policies.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
        CREATE ROLE api_user WITH LOGIN PASSWORD 'api_password';
    END IF;
END
$$;

-- Grant permissions to the api_user
GRANT USAGE ON SCHEMA public TO api_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO api_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO api_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO api_user;

-- Ensure RLS is still enabled (just in case)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE soft_reservations ENABLE ROW LEVEL SECURITY;
