import { describe, it, expect } from 'vitest';
import {
  persistJobInquiryCapture,
  resolveJobCompanies,
  type JobInquiryCaptureArgs,
  type JobInquiryRecipientResolver,
} from '../../src/services/jobInquiryCapture';

type MockQueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number };

type RecordedQuery = { text: string; params: unknown[] };

function makeDeps(opts: {
  queryResponses: MockQueryResult[];
  recipient?: { recipient: string | null; ownerName: string | null };
  customerId?: string | null;
}) {
  const queries: RecordedQuery[] = [];
  const queryResponses = [...opts.queryResponses];
  const client = {
    async query(text: string, params: unknown[] = []) {
      queries.push({ text, params });
      if (queryResponses.length === 0) throw new Error(`No mock response left for query: ${text}`);
      const next = queryResponses.shift()!;
      return { rows: next.rows, rowCount: next.rowCount ?? next.rows.length };
    },
  };
  const withTenantClient = async <T>(
    tenantId: string,
    fn: (client: typeof client) => Promise<T>
  ) => {
    expect(tenantId).toBe('tenant-1');
    return fn(client);
  };
  const getOrCreateCustomerByPhoneOnClient = async () => opts.customerId ?? 'cust-1';
  const resolveRecipient: JobInquiryRecipientResolver = async () =>
    opts.recipient ?? { recipient: 'owner@example.com', ownerName: 'Dale DeMott' };
  return { queries, withTenantClient, getOrCreateCustomerByPhoneOnClient, resolveRecipient };
}

describe('persistJobInquiryCapture', () => {
  const baseArgs: JobInquiryCaptureArgs = {
    tenant_id: 'tenant-1',
    caller_name: 'Rhonda Recruiter',
    callback_phone: '+13128651186',
    caller_company: 'Insight Global',
    client_company: 'Blue Cross',
    represents_company: false,
    employment_type: 'contract',
    rate_range: '$65-82/hr',
    duration: '6 months',
    location_type: 'hybrid',
    address: '300 Randolph St',
  };

  it('returns existing inquiry immediately on duplicate call_id retry', async () => {
    const deps = makeDeps({
      queryResponses: [{ rows: [{ job_inquiry_id: 'ji-existing' }] }],
      recipient: { recipient: 'owner@example.com', ownerName: 'Dale DeMott' },
    });

    const result = await persistJobInquiryCapture({
      args: { ...baseArgs, call_id: 'call-1' },
      callbackPhone: '+13128651186',
      companies: resolveJobCompanies(baseArgs),
      withTenantClient: deps.withTenantClient,
      getOrCreateCustomerByPhoneOnClient: deps.getOrCreateCustomerByPhoneOnClient,
      resolveRecipient: deps.resolveRecipient,
    });

    expect(result).toMatchObject({
      job_inquiry_id: 'ji-existing',
      duplicate: true,
      recipient: 'owner@example.com',
      ownerName: 'Dale DeMott',
    });
    expect(deps.queries).toHaveLength(1);
    expect(deps.queries[0].text).toContain('SELECT job_inquiry_id FROM job_inquiries');
  });

  it('writes generic envelope first, then projection, then stamp for inserted linked inquiry', async () => {
    const deps = makeDeps({
      queryResponses: [
        { rows: [] },
        { rows: [{ appointment_id: 'appt-1' }] },
        { rows: [{ submission_id: 'sub-1' }] },
        { rows: [{ job_inquiry_id: 'ji-1' }] },
        { rows: [], rowCount: 1 },
      ],
    });

    const result = await persistJobInquiryCapture({
      args: { ...baseArgs, appointment_id: 'appt-1', call_id: 'call-2' },
      callbackPhone: '+13128651186',
      companies: resolveJobCompanies(baseArgs),
      withTenantClient: deps.withTenantClient,
      getOrCreateCustomerByPhoneOnClient: deps.getOrCreateCustomerByPhoneOnClient,
      resolveRecipient: deps.resolveRecipient,
    });

    expect(result).toMatchObject({
      job_inquiry_id: 'ji-1',
      duplicate: false,
      recipient: 'owner@example.com',
      ownerName: 'Dale DeMott',
    });
    expect(deps.queries[2].text).toContain('INSERT INTO intake_submissions');
    expect(deps.queries[3].text).toContain('INSERT INTO job_inquiries');
    expect(deps.queries[4].text).toContain('UPDATE appointments');
  });
});
