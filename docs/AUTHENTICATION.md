# Authentication Logic Update

## Change Summary
- The backend login endpoint in src/index.ts now uses bcrypt for password comparison.
- Instead of calling the authenticate_user SQL function, the code fetches the user by email and compares the submitted password to the stored bcrypt hash.

## Implementation Details
- The login endpoint queries the users table for the given email.
- If a user is found, bcrypt.compare is used to check the password.
- On success, tenant_id, user_id, and user_name are returned.
- On failure, a 401 Unauthorized error is returned.

## Security Note
- Passwords are never checked in plain text.
- Only bcrypt hashes are stored and compared.

## Migration Note
- The authenticate_user SQL function is no longer used for authentication.
- Ensure all seeded users have bcrypt password hashes.

## Example
```js
const bcrypt = await import('bcrypt');
const match = await bcrypt.compare(password, user.password_hash);
```

## Related Files
- src/index.ts (backend logic)
- supabase/migrations/20260301000000_user_accounts.sql (schema)
- seed.sql (user seeding)

## Next Steps
- Test login with bcrypt-hashed passwords.
- Remove or update any documentation referencing the old SQL authentication function.
