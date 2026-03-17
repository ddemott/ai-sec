# Authentication

## Overview
The backend uses JWT-based authentication with bcrypt password hashing.

## Login Flow
1. Client sends `POST /login` with `{ email, password }`.
2. Backend queries `users` table for the email.
3. `bcrypt.compare()` checks the submitted password against the stored hash.
4. On success, a signed JWT is returned containing `tenant_id`, `user_id`, and `user_name`.
5. Token is stored in `localStorage` on the client.

## Token Details
- **Algorithm**: HS256 (via `jsonwebtoken` library)
- **Expiry**: 8 hours (configurable via `JWT_EXPIRY` env var)
- **Secret**: Set via `JWT_SECRET` env var (must be changed from default in production)
- **Payload**: `{ tenant_id, user_id, user_name }`

## Request Authentication
- All API requests include `Authorization: Bearer <token>` header.
- The `getHeaders()` function in `dashboard/lib/api.ts` automatically attaches the token.
- Backend verifies the token and extracts tenant context for RLS enforcement.

## Auto-Logout
- On HTTP 401 response, the client automatically:
  - Clears `tenantId`, `userName`, and `authToken` from localStorage
  - Redirects to the login page

## Password Storage
- Passwords are hashed with `bcrypt` before storage.
- Only bcrypt hashes are stored in the `users.password_hash` column.
- Seeded users (e.g., `dale@ai-sec.com`) have pre-computed bcrypt hashes.

## Related Files
- `src/routes/auth.ts` — Login endpoint and JWT signing
- `dashboard/lib/api.ts` — Token attachment and auto-logout
- `dashboard/lib/hooks.ts` — `useSession()` hook for auth state
- `dashboard/lib/SessionContext.tsx` — React Context for centralized auth state
- `supabase/migrations/20260301000000_user_accounts.sql` — Users table schema
- `supabase/seed.sql` — Seeded user credentials

## Security Notes
- `JWT_SECRET` must be a strong random string in production (not the default `dev-jwt-secret-change-in-production`).
- The `authenticate_user` SQL function is no longer used; authentication is handled entirely in the application layer.
