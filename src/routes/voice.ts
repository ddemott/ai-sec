/**
 * Voice Routes - CRM Context for Voice Calls
 *
 * Provides endpoints for:
 * - Starting voice sessions with customer context lookup
 * - Ending voice sessions with outcome tracking
 * - Getting active calls for dashboard
 * - Getting call history
 * - Adding notes to customers from calls
 */

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import type {
  CustomerContext,
  VoiceSession,
  VoiceSessionDisplay,
  VoiceSessionOutcome,
} from '../types/voiceCrm';

const StartSessionSchema = z.object({
  call_id: z.string().min(1),
  caller_phone: z.string().min(1),
});

const EndSessionSchema = z.object({
  call_id: z.string().min(1),
  duration_seconds: z.number().int().min(0).optional(),
  outcome: z.enum([
    'appointment_booked',
    'appointment_rescheduled',
    'appointment_cancelled',
    'info_provided',
    'transferred',
    'voicemail',
    'abandoned',
    'other',
  ]).optional(),
  transcript: z.string().optional(),
  summary: z.string().optional(),
  appointment_id: z.string().uuid().optional(),
});

const AddNoteSchema = z.object({
  customer_id: z.string().uuid(),
  note: z.string().min(1).max(2000),
  note_type: z.enum(['general', 'call', 'preference', 'important']).optional(),
  call_id: z.string().optional(),
});

export function registerVoiceRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>,
  io?: any // Socket.IO server instance
) {
  /**
   * POST /voice/session/start
   * Start a voice session and get customer context
   *
   * Called by Vapi webhook when a call starts
   */
  app.post('/voice/session/start', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const parsed = StartSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { call_id, caller_phone } = parsed.data;

    const context = await withTenantClient(tenantId, async (client) => {
      // Use the database function to start session and get context
      const result = await client.query<{ start_voice_session: CustomerContext }>(
        'SELECT start_voice_session($1, $2, $3) as context',
        [tenantId, call_id, caller_phone]
      );
      return result.rows[0]?.context || null;
    });

    if (!context) {
      return reply.status(500).send({
        success: false,
        error: 'Failed to create voice session',
      });
    }

    logEvent(req, 'voice_session_started', {
      call_id,
      caller_phone,
      is_known_customer: context.is_known_customer,
      customer_id: context.customer?.id,
    });

    // Emit real-time event if Socket.IO is available
    if (io) {
      io.to(`tenant:${tenantId}`).emit('call-started', {
        call_id,
        caller_phone,
        customer_context: context,
        timestamp: new Date().toISOString(),
      });
    }

    return reply.send({
      success: true,
      context,
    });
  }, 'Failed to start voice session'));

  /**
   * POST /voice/session/end
   * End a voice session with outcome tracking
   *
   * Called by Vapi webhook when a call ends
   */
  app.post('/voice/session/end', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const parsed = EndSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { call_id, duration_seconds, outcome, transcript, summary, appointment_id } = parsed.data;

    const ended = await withTenantClient(tenantId, async (client) => {
      const result = await client.query<{ end_voice_session: boolean }>(
        'SELECT end_voice_session($1, $2, $3, $4, $5, $6, $7) as ended',
        [tenantId, call_id, duration_seconds || null, outcome || null, transcript || null, summary || null, appointment_id || null]
      );
      return result.rows[0]?.ended || false;
    });

    if (!ended) {
      return reply.status(404).send({
        success: false,
        error: 'Voice session not found',
      });
    }

    logEvent(req, 'voice_session_ended', {
      call_id,
      duration_seconds,
      outcome,
      appointment_id,
    });

    // Emit real-time event
    if (io) {
      io.to(`tenant:${tenantId}`).emit('call-ended', {
        call_id,
        duration_seconds,
        outcome,
        timestamp: new Date().toISOString(),
      });
    }

    return reply.send({ success: true });
  }, 'Failed to end voice session'));

  /**
   * GET /voice/session/:callId
   * Get a specific voice session with full context
   */
  app.get('/voice/session/:callId', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { callId } = req.params as { callId: string };

    const session = await withTenantClient(tenantId, async (client) => {
      const result = await client.query<VoiceSession>(
        `SELECT * FROM voice_sessions WHERE tenant_id = $1 AND call_id = $2`,
        [tenantId, callId]
      );
      return result.rows[0] || null;
    });

    if (!session) {
      return reply.status(404).send({
        success: false,
        error: 'Voice session not found',
      });
    }

    return reply.send(session);
  }, 'Failed to get voice session'));

  /**
   * GET /voice/active
   * Get list of active calls for dashboard
   */
  app.get('/voice/active', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const calls = await withTenantClient(tenantId, async (client) => {
      const result = await client.query<VoiceSessionDisplay>(
        `SELECT
          vs.id,
          vs.call_id,
          vs.caller_phone,
          vs.customer_id,
          c.name as customer_name,
          vs.status,
          vs.started_at,
          vs.duration_seconds,
          vs.outcome,
          (vs.customer_context->>'is_known_customer')::boolean as is_known_customer
        FROM voice_sessions vs
        LEFT JOIN customers c ON c.id = vs.customer_id
        WHERE vs.tenant_id = $1 AND vs.status = 'active'
        ORDER BY vs.started_at DESC`,
        [tenantId]
      );
      return result.rows;
    });

    return reply.send({
      calls,
      total: calls.length,
    });
  }, 'Failed to get active calls'));

  /**
   * GET /voice/history
   * Get call history with optional filters
   */
  app.get('/voice/history', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const query = req.query as {
      customer_id?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };

    const limit = Math.min(parseInt(query.limit || '50'), 200);
    const offset = parseInt(query.offset || '0');

    const { calls, total } = await withTenantClient(tenantId, async (client) => {
      let whereClause = 'WHERE vs.tenant_id = $1';
      const params: (string | number)[] = [tenantId];
      let paramIndex = 2;

      if (query.customer_id) {
        whereClause += ` AND vs.customer_id = $${paramIndex}`;
        params.push(query.customer_id);
        paramIndex++;
      }

      if (query.status) {
        whereClause += ` AND vs.status = $${paramIndex}`;
        params.push(query.status);
        paramIndex++;
      }

      // Get total count
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM voice_sessions vs ${whereClause}`,
        params
      );
      const totalCount = parseInt(countResult.rows[0]?.count || '0');

      // Get sessions
      params.push(limit, offset);
      const result = await client.query<VoiceSession>(
        `SELECT
          vs.*,
          c.name as customer_name
        FROM voice_sessions vs
        LEFT JOIN customers c ON c.id = vs.customer_id
        ${whereClause}
        ORDER BY vs.started_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        params
      );

      return {
        calls: result.rows,
        total: totalCount,
      };
    });

    return reply.send({
      calls,
      total,
      has_more: offset + calls.length < total,
    });
  }, 'Failed to get call history'));

  /**
   * GET /voice/customer/:customerId/context
   * Get full CRM context for a specific customer
   */
  app.get('/voice/customer/:customerId/context', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { customerId } = req.params as { customerId: string };

    const context = await withTenantClient(tenantId, async (client) => {
      // Get customer phone to use with context function
      const customerResult = await client.query<{ phone: string }>(
        'SELECT phone FROM customers WHERE id = $1 AND tenant_id = $2',
        [customerId, tenantId]
      );

      if (customerResult.rows.length === 0) {
        return null;
      }

      const result = await client.query<{ get_customer_context_for_call: CustomerContext }>(
        'SELECT get_customer_context_for_call($1, $2) as context',
        [tenantId, customerResult.rows[0].phone]
      );
      return result.rows[0]?.context || null;
    });

    if (!context) {
      return reply.status(404).send({
        success: false,
        error: 'Customer not found',
      });
    }

    return reply.send(context);
  }, 'Failed to get customer context'));

  /**
   * GET /voice/customer/:customerId/calls
   * Get call history for a specific customer
   */
  app.get('/voice/customer/:customerId/calls', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { customerId } = req.params as { customerId: string };
    const limit = Math.min(parseInt((req.query as any).limit || '20'), 100);

    const calls = await withTenantClient(tenantId, async (client) => {
      const result = await client.query<VoiceSession>(
        `SELECT * FROM voice_sessions
        WHERE tenant_id = $1 AND customer_id = $2
        ORDER BY started_at DESC
        LIMIT $3`,
        [tenantId, customerId, limit]
      );
      return result.rows;
    });

    return reply.send({ calls });
  }, 'Failed to get customer call history'));

  /**
   * POST /voice/customer/note
   * Add a note to a customer record
   */
  app.post('/voice/customer/note', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const parsed = AddNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation failed',
        details: parsed.error.issues,
      });
    }

    const { customer_id, note, note_type, call_id } = parsed.data;

    const added = await withTenantClient(tenantId, async (client) => {
      // Verify customer belongs to tenant
      const checkResult = await client.query(
        'SELECT id FROM customers WHERE id = $1 AND tenant_id = $2',
        [customer_id, tenantId]
      );

      if (checkResult.rows.length === 0) {
        return false;
      }

      const result = await client.query<{ add_customer_note: boolean }>(
        'SELECT add_customer_note($1, $2, $3, $4) as added',
        [customer_id, note, note_type || 'general', call_id || null]
      );
      return result.rows[0]?.added || false;
    });

    if (!added) {
      return reply.status(404).send({
        success: false,
        error: 'Customer not found',
      });
    }

    logEvent(req, 'customer_note_added', {
      customer_id,
      note_type,
      call_id,
    });

    return reply.send({ success: true });
  }, 'Failed to add customer note'));

  /**
   * GET /voice/context/:phone
   * Get customer context by phone number (for Vapi tools)
   * This endpoint can be called during a call to enrich AI context
   */
  app.get('/voice/context/:phone', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const { phone } = req.params as { phone: string };

    const context = await withTenantClient(tenantId, async (client) => {
      const result = await client.query<{ get_customer_context_for_call: CustomerContext }>(
        'SELECT get_customer_context_for_call($1, $2) as context',
        [tenantId, phone]
      );
      return result.rows[0]?.context || null;
    });

    return reply.send(context || {
      is_known_customer: false,
      customer: null,
      appointment_history: { total: 0, completed: 0, cancelled: 0, upcoming_appointments: [] },
      notes: [],
      preferences: {},
      tags: [],
    });
  }, 'Failed to get customer context'));
}
