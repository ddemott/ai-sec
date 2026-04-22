-- Password reset flow: short-lived tokens + per-user invalidation timestamp
-- token_hash stores SHA-256 of the raw token; raw token is sent only via email link.

CREATE TABLE password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'email',
  ip TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_resets_user_id ON password_resets(user_id);
CREATE INDEX idx_password_resets_expires_at ON password_resets(expires_at);

ALTER TABLE users
  ADD COLUMN password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
