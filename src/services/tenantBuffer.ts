import type { PoolClient } from 'pg';

/**
 * Read a tenant's configured "default buffer between appointments" (minutes).
 *
 * The buffer is the minimum gap the AI must leave between back-to-back bookings.
 * It is passed into the booking + availability RPCs (book_appointment_atomic,
 * book_with_scheduling_atomic, check_availability_with_tz) and applied at every
 * customer-facing slot-offering surface, so the AI never OFFERS a slot the
 * booking path would then reject under the same buffer.
 *
 * Scope: this is read and applied ONLY on the AI / customer-facing routes.
 * Owner manual dashboard bookings deliberately do not call this — they stay
 * unrestricted (product decision 2026-06-07).
 *
 * Returns 0 (no buffer — original behavior) when the tenant is missing or the
 * column is NULL, so a lookup failure degrades to "no buffer", never an error.
 */
export async function getTenantBufferMinutes(
  client: PoolClient,
  tenantId: string
): Promise<number> {
  const res = await client.query<{ default_buffer_minutes: number | null }>(
    'SELECT default_buffer_minutes FROM tenants WHERE tenant_id = $1',
    [tenantId]
  );
  const raw = res.rows[0]?.default_buffer_minutes;
  return typeof raw === 'number' && raw > 0 ? raw : 0;
}
