/**
 * Communication history recorder.
 *
 * Writes one append-only row to `communications_history` for every outbound
 * communication attempt. Called from BOTH the send success path (status='sent')
 * and the send-failure catch path (status='failed', carrying the provider
 * error) of EmailService.sendEmail / SMSService.sendSMS — the universal choke
 * point that every caller (route, reminders worker, appointmentService) bottoms
 * out at. The failed rows are what make the dashboard's ?status=failed
 * drill-down real.
 *
 * IMPORTANT — RLS: `communications_history` has FORCE ROW LEVEL SECURITY with a
 * tenant-isolation policy whose USING clause doubles as the INSERT WITH CHECK.
 * An INSERT that does not set `app.current_tenant_id` is REJECTED by Postgres.
 * That is why we route through `createWithTenantClient(getPool())` (which sets
 * the GUC for the duration of the callback) rather than issuing a bare
 * `pool.query`. A bare insert would silently fail under RLS in production.
 *
 * IMPORTANT — defensive: a failed history write must NEVER break the send. The
 * recorder swallows every error (logging it) and returns void. By the time this
 * is called the send has already resolved (succeeded, or failed with a result
 * the caller is about to return); losing a history row is an acceptable, logged
 * degradation, not a user-facing failure.
 */

import { getPool, createWithTenantClient } from '../../database/index.js';

export interface CommunicationHistoryEntry {
  channel: 'email' | 'sms';
  recipient: string;
  direction?: 'outbound' | 'inbound';
  subject?: string;
  body?: string;
  status?: 'sent' | 'failed' | 'queued';
  providerMessageId?: string;
  customerId?: string;
  error?: string;
}

/**
 * Insert a communications_history row for a communication attempt (status
 * 'sent' on success, 'failed' on a send error).
 *
 * Best-effort: never throws. On any failure (DB down, RLS rejection, bad
 * shape) it logs and returns — the caller's send result is unaffected.
 */
export async function recordCommunicationHistory(
  tenantId: string,
  entry: CommunicationHistoryEntry
): Promise<void> {
  try {
    const withTenantClient = createWithTenantClient(getPool());
    await withTenantClient(tenantId, async (client) => {
      await client.query(
        `INSERT INTO communications_history
           (tenant_id, customer_id, channel, direction, recipient, subject, body, status, provider_message_id, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          tenantId,
          entry.customerId ?? null,
          entry.channel,
          entry.direction ?? 'outbound',
          entry.recipient,
          entry.subject ?? null,
          entry.body ?? null,
          entry.status ?? 'sent',
          entry.providerMessageId ?? null,
          entry.error ?? null,
        ]
      );
    });
  } catch (error) {
    // Defensive: history is a side-channel. The send already succeeded; a
    // failed log must not surface to the caller. Log and move on.
    console.error('⚠️ Failed to record communication history (send unaffected):', error);
  }
}
