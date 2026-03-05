import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://localhost:5433'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'local-dev-no-key'

// If we are talking to a local raw Postgres (port 5433), the Supabase client will fail 
// because it expects the Supabase API Gateway (PostgREST).
// For the PoC, we default to a placeholder.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
