/**
 * Real-DB tests for the communication-history recorder + send-path wiring.
 *
 * Why real DB (not a mocked pool): the `communications_history` table has
 * FORCE ROW LEVEL SECURITY whose tenant-isolation USING clause doubles as the
 * INSERT WITH CHECK. A mocked pool proves the mock works, not that the INSERT
 * survives RLS against the real column shape — exactly the class of drift that
 * the CLAUDE.md "test it or delete it" rule (and the ReminderSchedule UUID/
 * number bug origin story) exists to catch. These tests exercise the live
 * test_db so an RLS rejection or a column-shape mismatch fails loudly.
 *
 * 5W context for sad-path failures:
 *   WHO   — EmailService.sendEmail / SMSService.sendSMS after a successful send
 *   WHAT  — recording one append-only row in communications_history
 *   WHEN  — every outbound email/SMS the platform actually sends
 *   WHERE — recordCommunicationHistory → createWithTenantClient → INSERT
 *   WHY   — a silently-dropped history write (RLS rejection swallowed by the
 *           defensive catch) would leave the audit log empty in production
 *           while every gate stayed green
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Client } from 'pg';
import {
  ROOT_DB_URL,
  getRootClient,
  getApiClient,
  clearDB,
  createTenant,
  skipIfDbDown,
} from '../../test-utils';
import { closePool } from '../../database/index';
import { recordCommunicationHistory } from './communicationHistory';
import { SMSService } from './smsService';
import { EmailService } from './emailService';
import { providerRegistry } from './ProviderRegistry';
import type { TenantConfigService, TenantConfig } from '../tenants/index';

let root: Client;
let api: Client;
let dbAvailable = false;
let tenantId: string;
let otherTenantId: string;

beforeAll(async () => {
  // The recorder calls getPool(), which reads DATABASE_URL. Hard-pin it to the
  // test_db ROOT_DB_URL (identical to CI's value) — '=' not '??=' so we never
  // inherit a stray .env / prod DATABASE_URL and accidentally write history rows
  // to the wrong database. Reset the singleton first in case an earlier import
  // already created a pool against a different URL.
  await closePool().catch(() => {});
  process.env.DATABASE_URL = ROOT_DB_URL;
  try {
    root = await getRootClient();
    api = await getApiClient();
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  // Drain the singleton pool this file opened so later test files don't inherit
  // checked-out connections that could contend with their TRUNCATE locks.
  await closePool().catch(() => {});
  if (root) await root.end().catch(() => {});
  if (api) await api.end().catch(() => {});
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  await clearDB(root);
  await root.query('TRUNCATE communications_history CASCADE').catch(() => {});
  tenantId = await createTenant(root, 'History Co', 'salon');
  otherTenantId = await createTenant(root, 'Other Co', 'salon');
});

describe('recordCommunicationHistory', () => {
  it('HAPPY: writes an email row under the correct tenant', async () => {
    // WHO: EmailService after transporter.sendMail resolves
    // WHAT: one communications_history row, channel=email, status=sent
    // WHEN: a consented email is delivered
    // WHERE: recordCommunicationHistory tenant-scoped INSERT
    // WHY: the GET /communications/history endpoint reads exactly these rows
    await recordCommunicationHistory(tenantId, {
      channel: 'email',
      recipient: 'jane@example.com',
      subject: 'Your appointment',
      body: 'See you Tuesday',
      providerMessageId: 'msg-123',
    });

    const res = await root.query('SELECT * FROM communications_history WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].channel).toBe('email');
    expect(res.rows[0].recipient).toBe('jane@example.com');
    expect(res.rows[0].subject).toBe('Your appointment');
    expect(res.rows[0].status).toBe('sent');
    expect(res.rows[0].direction).toBe('outbound');
    expect(res.rows[0].provider_message_id).toBe('msg-123');
  });

  it('HAPPY: writes an SMS row with the phone recipient', async () => {
    // WHO: SMSService after the provider returns a SID
    // WHAT: one row, channel=sms, recipient = E.164 phone
    // WHEN: a consented SMS is delivered
    // WHERE: recordCommunicationHistory
    // WHY: SMS sends must also be auditable in the same history feed
    await recordCommunicationHistory(tenantId, {
      channel: 'sms',
      recipient: '+15551234567',
      body: 'Reminder: 2pm tomorrow',
      providerMessageId: 'SM999',
    });

    const res = await root.query('SELECT * FROM communications_history WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].channel).toBe('sms');
    expect(res.rows[0].recipient).toBe('+15551234567');
    expect(res.rows[0].subject).toBeNull();
  });

  it('SAD: a write for an unknown tenant does not throw (best-effort)', async () => {
    // WHO: a caller passing a tenant id that no longer exists
    // WHAT: createWithTenantClient rejects (TENANT_NOT_FOUND); recorder swallows it
    // WHEN: a race where the tenant was deleted between send and log
    // WHERE: recordCommunicationHistory defensive try/catch
    // WHY: a failed history write must NEVER turn a successful send into a failure
    await expect(
      recordCommunicationHistory('00000000-0000-4000-8000-000000000000', {
        channel: 'email',
        recipient: 'nobody@example.com',
      })
    ).resolves.toBeUndefined();
  });
});

describe('communications_history RLS (the WITH-CHECK trap)', () => {
  it('SAD: api_user INSERT under a DIFFERENT tenant context is rejected by FORCE RLS', async () => {
    // WHO: any code path that inserts a row for tenant A while scoped to tenant B
    // WHAT: Postgres rejects the INSERT — the tenant_isolation USING clause is
    //       also the WITH CHECK, so a row whose tenant_id != the active GUC fails
    // WHEN: this is the trap the recorder avoids by routing through
    //       createWithTenantClient, which sets the GUC to the row's own tenant
    // WHERE: communications_history RLS policy (FORCE ROW LEVEL SECURITY)
    // WHY: proving RLS is FORCED here is what makes the HAPPY tests meaningful —
    //      it confirms the recorder's success is due to setting the right
    //      context, not to RLS being absent. (An EMPTY context would instead hit
    //      the admin_bypass policy, so we use a concrete mismatched tenant.)
    await api.query('SELECT set_tenant_context($1::uuid)', [otherTenantId]);
    await expect(
      api.query(
        `INSERT INTO communications_history (tenant_id, channel, recipient)
         VALUES ($1, 'email', 'x@example.com')`,
        [tenantId]
      )
    ).rejects.toThrow();
    await api.query("SELECT set_config('app.current_tenant_id', '', false)");
  });

  it('HAPPY: api_user INSERT WITH matching tenant context succeeds', async () => {
    // WHO: the recorder's tenant-scoped client
    // WHAT: the same INSERT succeeds once app.current_tenant_id matches tenant_id
    // WHEN: the normal send path
    // WHERE: communications_history RLS policy
    // WHY: confirms the WITH CHECK passes for the in-context tenant
    await api.query('SELECT set_tenant_context($1::uuid)', [tenantId]);
    await expect(
      api.query(
        `INSERT INTO communications_history (tenant_id, channel, recipient)
         VALUES ($1, 'sms', '+15550000000')`,
        [tenantId]
      )
    ).resolves.toBeTruthy();
    await api.query("SELECT set_config('app.current_tenant_id', '', false)");
  });

  it('SAD: a tenant cannot read another tenant history rows', async () => {
    // WHO: tenant A reading the history feed
    // WHAT: rows written under tenant B are invisible under A's RLS context
    // WHEN: every tenant-scoped read
    // WHERE: communications_history tenant_isolation policy
    // WHY: cross-tenant leakage of communication logs would be a data breach
    await recordCommunicationHistory(otherTenantId, {
      channel: 'email',
      recipient: 'b@example.com',
    });

    await api.query('SELECT set_tenant_context($1::uuid)', [tenantId]);
    const res = await api.query('SELECT * FROM communications_history');
    await api.query("SELECT set_config('app.current_tenant_id', '', false)");
    expect(res.rows).toHaveLength(0);
  });
});

describe('send path writes history (provider mocked, real DB)', () => {
  // Minimal config service stub returning a config for the real seeded tenant.
  // The provider (SMS mock adapter / email test transporter) is already a stub
  // in test mode, so no real SMS/email is sent — we only assert the history row.
  const buildConfigService = (): TenantConfigService =>
    ({
      getTenantConfig: vi.fn().mockResolvedValue({
        tenantId,
        name: 'History Co',
        phone: '+15551234567',
        settings: { smsEnabled: true, emailEnabled: true },
      } satisfies TenantConfig),
      getTenantConfigs: vi.fn().mockResolvedValue([]),
      updateTenantConfig: vi.fn(),
      getBusinessName: vi.fn().mockResolvedValue('History Co'),
      getNotificationPreferences: vi.fn().mockResolvedValue({
        smsEnabled: true,
        emailEnabled: true,
        reminderHours: [],
        contactInfo: { phone: '+15551234567' },
      }),
    }) as unknown as TenantConfigService;

  it('HAPPY: SMSService.sendSMS records an sms history row', async () => {
    // WHO: SMSService.sendSMS on the success path (consent omitted → allowed)
    // WHAT: a communications_history row is written for the delivered SMS
    // WHEN: an SMS is sent through the real service (mock provider)
    // WHERE: SMSService.sendSMS → recordCommunicationHistory
    // WHY: the task requires the send path itself to record history, not just
    //      the recorder in isolation
    const smsService = new SMSService(buildConfigService(), undefined);

    const result = await smsService.sendSMS(tenantId, {
      to: '+15559998888',
      body: 'Hello from the send path',
    });
    expect(result.success).toBe(true);

    const rows = await root.query(
      "SELECT * FROM communications_history WHERE tenant_id = $1 AND channel = 'sms'",
      [tenantId]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].recipient).toBe('+15559998888');
    expect(rows.rows[0].body).toBe('Hello from the send path');
    expect(rows.rows[0].status).toBe('sent');
  });

  it('HAPPY: EmailService.sendEmail records an email history row', async () => {
    // WHO: EmailService.sendEmail on the success path (consent omitted → allowed)
    // WHAT: a communications_history row is written for the delivered email
    // WHEN: an email is sent through the real service (stub transporter)
    // WHERE: EmailService.sendEmail → recordCommunicationHistory
    // WHY: email sends must also be auditable from the same end-to-end path
    const emailService = new EmailService(buildConfigService(), undefined);

    const result = await emailService.sendEmail(tenantId, {
      to: 'send-path@example.com',
      subject: 'Send-path subject',
      text: 'Send-path body',
    });
    expect(result.success).toBe(true);

    const rows = await root.query(
      "SELECT * FROM communications_history WHERE tenant_id = $1 AND channel = 'email'",
      [tenantId]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].recipient).toBe('send-path@example.com');
    expect(rows.rows[0].subject).toBe('Send-path subject');
    expect(rows.rows[0].status).toBe('sent');
  });
});

describe('send-FAILURE path records a failed row (drill-down data source)', () => {
  // Same real-seeded-tenant config stub as the success-path suite. The provider
  // (SMS) / transporter (email) is forced to reject so we exercise the catch
  // block that writes the status='failed' row — the row the dashboard
  // ?status=failed drill-down reads. Without this row the drill-down is inert.
  const buildConfigService = (): TenantConfigService =>
    ({
      getTenantConfig: vi.fn().mockResolvedValue({
        tenantId,
        name: 'History Co',
        phone: '+15551234567',
        settings: { smsEnabled: true, emailEnabled: true },
      } satisfies TenantConfig),
      getTenantConfigs: vi.fn().mockResolvedValue([]),
      updateTenantConfig: vi.fn(),
      getBusinessName: vi.fn().mockResolvedValue('History Co'),
      getNotificationPreferences: vi.fn().mockResolvedValue({
        smsEnabled: true,
        emailEnabled: true,
        reminderHours: [],
        contactInfo: { phone: '+15551234567' },
      }),
    }) as unknown as TenantConfigService;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SAD: SMSService.sendSMS records a status=failed row with the provider error', async () => {
    // WHO: SMSService.sendSMS when the provider.sendSMS call rejects
    // WHAT: a communications_history row with status='failed' + the error text
    // WHEN: a real provider outage / rejected send (here: forced mock rejection)
    // WHERE: SMSService.sendSMS catch block → recordCommunicationHistory
    // WHY: the ?status=failed drill-down was inert because failures never wrote
    //      a row — this proves the failed row now exists so the UI has data
    const smsService = new SMSService(buildConfigService(), undefined);
    // Force the (mock) provider's sendSMS to reject so the catch path runs.
    vi.spyOn(providerRegistry.getDefaultProvider(), 'sendSMS').mockRejectedValue(
      new Error('carrier rejected: 30007')
    );

    const result = await smsService.sendSMS(tenantId, {
      to: '+15557770000',
      body: 'This one fails',
    });
    // Sad path: the caller still gets a clean {success:false}, not a throw.
    expect(result.success).toBe(false);
    expect(result.error).toContain('carrier rejected');

    const rows = await root.query(
      "SELECT * FROM communications_history WHERE tenant_id = $1 AND channel = 'sms'",
      [tenantId]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe('failed');
    expect(rows.rows[0].recipient).toBe('+15557770000');
    expect(rows.rows[0].body).toBe('This one fails');
    expect(rows.rows[0].error).toContain('carrier rejected');
  });

  it('SAD: EmailService.sendEmail records a status=failed row with the provider error', async () => {
    // WHO: EmailService.sendEmail when transporter.sendMail rejects
    // WHAT: a communications_history row with status='failed' + the error text
    // WHEN: an SMTP/transport error on a real send (here: forced stub rejection)
    // WHERE: EmailService.sendEmail catch block → recordCommunicationHistory
    // WHY: email failures must also feed the ?status=failed drill-down, not just
    //      vanish into a returned {success:false}
    const emailService = new EmailService(buildConfigService(), undefined);
    // Override the stub transporter so the send throws into the catch block.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (emailService as any).transporter = {
      sendMail: vi.fn().mockRejectedValue(new Error('SMTP 550 mailbox unavailable')),
    };

    const result = await emailService.sendEmail(tenantId, {
      to: 'bounce@example.com',
      subject: 'Failed subject',
      text: 'Failed body',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('SMTP 550');

    const rows = await root.query(
      "SELECT * FROM communications_history WHERE tenant_id = $1 AND channel = 'email'",
      [tenantId]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe('failed');
    expect(rows.rows[0].recipient).toBe('bounce@example.com');
    expect(rows.rows[0].subject).toBe('Failed subject');
    expect(rows.rows[0].body).toBe('Failed body');
    expect(rows.rows[0].error).toContain('SMTP 550');
  });
});
