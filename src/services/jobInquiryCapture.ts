import { JOB_DETAILS_PREFIX, toStampText } from '../../shared/callContext';

export interface JobInquiryCompanies {
  clientCompany: string | null;
  callerCompany: string | null;
  representsCompany: boolean | null;
}

export interface JobInquiryCaptureArgs {
  tenant_id: string;
  caller_name: string;
  callback_phone?: string;
  client_company?: string | null;
  caller_company?: string | null;
  represents_company?: boolean | null;
  employment_type?: string;
  role_description?: string;
  rate_range?: string;
  duration?: string;
  location_type?: string;
  address?: string;
  timezone?: string;
  call_id?: string;
  appointment_id?: string;
}

type TenantClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number }>;
};

export type WithTenantClientLike = <T>(
  tenantId: string,
  fn: (client: TenantClient) => Promise<T>
) => Promise<T>;

export type GetOrCreateCustomerByPhoneOnClientLike = (
  client: TenantClient,
  tenantId: string,
  phone: string,
  name: string | null | undefined
) => Promise<string | null>;

export type JobInquiryRecipientResolver = (
  client: TenantClient,
  tenantId: string
) => Promise<{ recipient: string | null; ownerName: string | null }>;

export interface PersistJobInquiryCaptureParams {
  args: JobInquiryCaptureArgs;
  callbackPhone: string;
  companies: JobInquiryCompanies;
  withTenantClient: WithTenantClientLike;
  getOrCreateCustomerByPhoneOnClient: GetOrCreateCustomerByPhoneOnClientLike;
  resolveRecipient: JobInquiryRecipientResolver;
}

export interface PersistJobInquiryCaptureResult {
  job_inquiry_id: string | null;
  recipient: string | null;
  ownerName: string | null;
  duplicate: boolean;
  appointmentLinkMiss: boolean;
  appointmentStampMiss: boolean;
}

export function resolveJobCompanies(input: {
  client_company?: string | null;
  caller_company?: string | null;
  represents_company?: boolean | null;
}): JobInquiryCompanies {
  const clean = (s?: string | null): string | null =>
    typeof s === 'string' && s.trim() !== '' ? s.trim() : null;
  const cc = clean(input.client_company);
  const ac = clean(input.caller_company);

  if (cc && ac) {
    return {
      clientCompany: cc,
      callerCompany: ac,
      representsCompany: cc.toLowerCase() === ac.toLowerCase(),
    };
  }

  if (input.represents_company === true) {
    const one = cc ?? ac;
    return { clientCompany: one, callerCompany: one, representsCompany: true };
  }

  return {
    clientCompany: cc,
    callerCompany: ac,
    representsCompany: input.represents_company ?? null,
  };
}

export function jobSummaryLine(
  companies: JobInquiryCompanies,
  args: {
    employment_type?: string;
    role_description?: string;
    rate_range?: string;
    duration?: string;
    location_type?: string;
    address?: string;
    timezone?: string;
  }
): string {
  const bits: string[] = [];
  if (args.role_description) bits.push(args.role_description);
  if (args.employment_type)
    bits.push(
      args.employment_type === 'contract'
        ? 'contract'
        : args.employment_type === 'contract_to_hire'
          ? 'contract to hire'
          : 'full time'
    );
  if (args.rate_range) bits.push(args.rate_range);
  if (args.duration) bits.push(args.duration);
  if (args.location_type) {
    bits.push(
      args.location_type === 'remote'
        ? `remote${args.timezone ? ` (${args.timezone})` : ''}`
        : `${args.location_type}${args.address ? ` at ${args.address}` : ''}`
    );
  }
  const company =
    companies.representsCompany === false && companies.clientCompany
      ? `work at ${companies.clientCompany}${companies.callerCompany ? ` via ${companies.callerCompany}` : ''}`
      : companies.callerCompany
        ? `with ${companies.callerCompany}`
        : '';
  const detail = [bits.join(', '), company].filter(Boolean).join(' — ');
  return `${JOB_DETAILS_PREFIX}${toStampText(detail) || 'see the job inquiry record'}.`;
}

function buildJobIntakePayload(
  companies: JobInquiryCompanies,
  args: JobInquiryCaptureArgs
): string {
  return JSON.stringify({
    schema_version: 1,
    submission_type: 'job_inquiry',
    caller_name: args.caller_name,
    callback_phone: args.callback_phone ?? null,
    caller_company: companies.callerCompany,
    client_company: companies.clientCompany,
    represents_company: companies.representsCompany,
    employment_type: args.employment_type ?? null,
    role_description: args.role_description ?? null,
    rate_range: args.rate_range ?? null,
    duration: args.duration ?? null,
    location_type: args.location_type ?? null,
    address: args.address ?? null,
    timezone: args.timezone ?? null,
    call_id: args.call_id ?? null,
    appointment_id: args.appointment_id ?? null,
  });
}

export async function persistJobInquiryCapture({
  args,
  callbackPhone,
  companies,
  withTenantClient,
  getOrCreateCustomerByPhoneOnClient,
  resolveRecipient,
}: PersistJobInquiryCaptureParams): Promise<PersistJobInquiryCaptureResult> {
  return withTenantClient(args.tenant_id, async (client) => {
    if (args.call_id) {
      const existing = await client.query<{ job_inquiry_id: string }>(
        `SELECT job_inquiry_id FROM job_inquiries
          WHERE tenant_id = $1 AND call_id = $2
          ORDER BY created_at ASC LIMIT 1`,
        [args.tenant_id, args.call_id]
      );
      if (existing.rows[0]) {
        const recipDup = await resolveRecipient(client, args.tenant_id);
        return {
          job_inquiry_id: existing.rows[0].job_inquiry_id,
          recipient: recipDup.recipient,
          ownerName: recipDup.ownerName,
          duplicate: true,
          appointmentLinkMiss: false,
          appointmentStampMiss: false,
        };
      }
    }

    const customerId = await getOrCreateCustomerByPhoneOnClient(
      client,
      args.tenant_id,
      callbackPhone,
      args.caller_name
    );

    let appointmentId: string | null = null;
    let appointmentLinkMiss = false;
    let appointmentStampMiss = false;
    if (args.appointment_id) {
      const appt = await client.query<{ appointment_id: string }>(
        `SELECT appointment_id FROM appointments
          WHERE tenant_id = $1 AND appointment_id = $2 AND is_deleted = false`,
        [args.tenant_id, args.appointment_id]
      );
      appointmentId = appt.rows[0]?.appointment_id ?? null;
      appointmentLinkMiss = !appointmentId;
    }

    const intakePayload = buildJobIntakePayload(companies, {
      ...args,
      callback_phone: callbackPhone,
      appointment_id: appointmentId ?? undefined,
    });
    await client.query<{ submission_id: string }>(
      `INSERT INTO intake_submissions
         (tenant_id, customer_id, submission_type, call_id, appointment_id,
          caller_name, callback_phone, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (tenant_id, submission_type, call_id)
         WHERE call_id IS NOT NULL
       DO UPDATE SET
         customer_id    = COALESCE(EXCLUDED.customer_id, intake_submissions.customer_id),
         appointment_id = COALESCE(EXCLUDED.appointment_id, intake_submissions.appointment_id),
         caller_name    = EXCLUDED.caller_name,
         callback_phone = EXCLUDED.callback_phone,
         payload_json   = EXCLUDED.payload_json
       RETURNING submission_id`,
      [
        args.tenant_id,
        customerId,
        'job_inquiry',
        args.call_id ?? null,
        appointmentId,
        args.caller_name,
        callbackPhone,
        intakePayload,
      ]
    );

    const res = await client.query<{ job_inquiry_id: string }>(
      `INSERT INTO job_inquiries
         (tenant_id, customer_id, client_company, caller_company, represents_company,
          employment_type, role_description, rate_range, duration, location_type,
          address, timezone, caller_name, callback_phone, call_id, appointment_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (tenant_id, call_id) WHERE call_id IS NOT NULL DO NOTHING
       RETURNING job_inquiry_id`,
      [
        args.tenant_id,
        customerId,
        companies.clientCompany,
        companies.callerCompany,
        companies.representsCompany,
        args.employment_type ?? null,
        args.role_description ?? null,
        args.rate_range ?? null,
        args.duration ?? null,
        args.location_type ?? null,
        args.address ?? null,
        args.timezone ?? null,
        args.caller_name,
        callbackPhone,
        args.call_id ?? null,
        appointmentId,
      ]
    );
    const inserted = Boolean(res.rows[0]);
    let jobInquiryId = res.rows[0]?.job_inquiry_id ?? null;
    if (!inserted && args.call_id) {
      const winner = await client.query<{ job_inquiry_id: string }>(
        `SELECT job_inquiry_id FROM job_inquiries
          WHERE tenant_id = $1 AND call_id = $2
          ORDER BY created_at ASC LIMIT 1`,
        [args.tenant_id, args.call_id]
      );
      jobInquiryId = winner.rows[0]?.job_inquiry_id ?? null;
    }

    if (appointmentId && inserted) {
      const stamped = await client.query(
        `UPDATE appointments
            SET description = COALESCE(NULLIF(description, '') || E'\n\n', '') || $3,
                updated_at = now()
          WHERE tenant_id = $1 AND appointment_id = $2 AND is_deleted = false`,
        [args.tenant_id, appointmentId, jobSummaryLine(companies, args)]
      );
      appointmentStampMiss = stamped.rowCount === 0;
    }

    const recip = await resolveRecipient(client, args.tenant_id);
    return {
      job_inquiry_id: jobInquiryId,
      recipient: recip.recipient,
      ownerName: recip.ownerName,
      duplicate: !inserted,
      appointmentLinkMiss,
      appointmentStampMiss,
    };
  });
}
