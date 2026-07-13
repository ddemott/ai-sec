/**
 * Self-service appointment tokens — short-lived, signed JWTs that let a
 * customer cancel their own appointment without creating an account.
 *
 * Signed by the same JWT_SECRET as session tokens; a different `action`
 * claim distinguishes them so a session token can never be replayed here.
 * 24-hour expiry balances utility (same-day cancel) against security
 * (token leak window).
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production' ? '' : 'dev-jwt-secret-change-in-production');

export type SelfServiceAction = 'cancel' | 'reschedule';

export interface SelfServiceTokenPayload {
  /** Token type — see generateSelfServiceToken. Never 'session'. */
  typ: 'self_service';
  appointment_id: string;
  tenant_id: string;
  action: SelfServiceAction;
  iat?: number;
  exp?: number;
}

/** Generate a 24-hour cancel token for the given appointment. Returns null if JWT_SECRET is empty. */
export function generateSelfServiceToken(
  appointmentId: string,
  tenantId: string,
  action: SelfServiceAction
): string | null {
  if (!JWT_SECRET) return null;
  // `typ` is load-bearing, not decoration. This token travels to a CUSTOMER, in
  // a link, in an SMS. It is signed with the same JWT_SECRET as a login
  // session, so without a type claim the session verifier could not tell the
  // two apart and accepted this as a logged-in user (see middleware.ts
  // JwtPayload). It grants exactly one thing: cancel/reschedule ONE
  // appointment.
  return jwt.sign(
    { typ: 'self_service', appointment_id: appointmentId, tenant_id: tenantId, action },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * Verify and decode a self-service token.
 * Returns the payload when valid, null on bad signature / expiry / wrong action.
 *
 * Empty JWT_SECRET returns null immediately — an empty string is a valid HMAC
 * key so jwt.verify would accept ANY token signed with an empty string.
 */
export function verifySelfServiceToken(
  token: string,
  expectedAction: SelfServiceAction
): SelfServiceTokenPayload | null {
  if (!JWT_SECRET) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as SelfServiceTokenPayload;
    // Symmetric to the session verifier: only a self-service token opens a
    // self-service route. A session JWT presented here must NOT be honoured
    // either — the confusion has to fail closed in both directions, or we have
    // only moved it.
    if (payload.typ !== 'self_service') return null;
    if (payload.action !== expectedAction) return null;
    if (!payload.appointment_id || !payload.tenant_id) return null;
    return payload;
  } catch {
    return null;
  }
}
