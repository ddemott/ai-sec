import { CALLER_NOTES_PREFIX, toStampText } from '../../shared/callContext';

export interface MeetingNotesCaptureArgs {
  tenant_id: string;
  appointment_id: string;
  caller_name: string;
  callback_phone?: string;
  notes: string;
  call_id?: string;
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

export interface PersistMeetingNotesCaptureParams {
  args: MeetingNotesCaptureArgs;
  withTenantClient: WithTenantClientLike;
}

export interface PersistMeetingNotesCaptureResult {
  appointment_id: string | null;
  appointmentLinkMiss: boolean;
  appointmentStampMiss: boolean;
}

function buildMeetingNotesPayload(args: MeetingNotesCaptureArgs): string {
  return JSON.stringify({
    schema_version: 1,
    submission_type: 'meeting_notes',
    caller_name: args.caller_name,
    callback_phone: args.callback_phone ?? null,
    appointment_id: args.appointment_id,
    call_id: args.call_id ?? null,
    notes: args.notes,
  });
}

export async function persistMeetingNotesCapture({
  args,
  withTenantClient,
}: PersistMeetingNotesCaptureParams): Promise<PersistMeetingNotesCaptureResult> {
  return withTenantClient(args.tenant_id, async (client) => {
    const appt = await client.query<{ appointment_id: string }>(
      `SELECT appointment_id FROM appointments
         WHERE tenant_id = $1 AND appointment_id = $2 AND is_deleted = false`,
      [args.tenant_id, args.appointment_id]
    );
    const appointmentId = appt.rows[0]?.appointment_id ?? null;
    if (!appointmentId) {
      return {
        appointment_id: null,
        appointmentLinkMiss: true,
        appointmentStampMiss: false,
      };
    }

    await client.query<{ submission_id: string }>(
      `INSERT INTO intake_submissions
         (tenant_id, customer_id, submission_type, call_id, appointment_id,
          caller_name, callback_phone, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (tenant_id, submission_type, call_id)
         WHERE call_id IS NOT NULL
       DO UPDATE SET
         appointment_id = COALESCE(EXCLUDED.appointment_id, intake_submissions.appointment_id),
         caller_name    = EXCLUDED.caller_name,
         callback_phone = EXCLUDED.callback_phone,
         payload_json   = EXCLUDED.payload_json
       RETURNING submission_id`,
      [
        args.tenant_id,
        null,
        'meeting_notes',
        args.call_id ?? null,
        appointmentId,
        args.caller_name,
        args.callback_phone ?? null,
        buildMeetingNotesPayload(args),
      ]
    );

    const stamped = await client.query<{ appointment_id: string }>(
      `UPDATE appointments
          SET description = COALESCE(NULLIF(description, '') || E'\n\n', '') || $3,
              updated_at = now()
        WHERE tenant_id = $1 AND appointment_id = $2 AND is_deleted = false
        RETURNING appointment_id`,
      [args.tenant_id, appointmentId, `${CALLER_NOTES_PREFIX}${toStampText(args.notes)}`]
    );

    return {
      appointment_id: stamped.rows[0]?.appointment_id ?? null,
      appointmentLinkMiss: false,
      appointmentStampMiss: stamped.rowCount === 0,
    };
  });
}
