/**
 * Shared route helpers for consistent request validation, response envelopes,
 * and common query parsing patterns.
 *
 * These helpers reduce boilerplate across route modules while keeping
 * route-specific SQL and business logic in each file.
 */

import type { FastifyReply } from 'fastify';
import type { ZodIssue } from 'zod';

// ── Response Envelope Helpers ───────────────────────────────────────

/**
 * Send a standard 400 validation-failure response.
 * Replaces the repeated `reply.status(400).send({ success: false, error: 'Validation failed', details })` pattern.
 */
export function sendValidationError(reply: FastifyReply, issues: ZodIssue[]): void {
  void reply.status(400).send({ success: false, error: 'Validation failed', details: issues });
}

/**
 * Send a standard 404 not-found response for a named entity.
 * Use after zero-row mutations to stop returning success on no-ops.
 */
export function sendNotFound(reply: FastifyReply, entityName: string): void {
  void reply.status(404).send({ success: false, error: `${entityName} not found` });
}

/**
 * Send a standard success envelope with optional data payload.
 */
export function sendSuccess(reply: FastifyReply, data?: Record<string, unknown>): void {
  void reply.send({ success: true, ...data });
}

/**
 * Send a standard 409 conflict response for duplicate-name / unique-constraint violations.
 */
export function sendConflict(reply: FastifyReply, message: string): void {
  void reply.status(409).send({ success: false, error: message });
}

// ── Mutation Guard ──────────────────────────────────────────────────

/**
 * Check whether an UPDATE/DELETE query actually affected a row.
 * Returns true if at least one row was affected, or sends a 404 and returns false.
 *
 * Usage:
 *   const res = await client.query('UPDATE ... RETURNING id', [...]);
 *   if (!assertRowAffected(res, reply, 'Employee')) return;
 */
export function assertRowAffected(
  res: { rowCount: number | null; rows: unknown[] },
  reply: FastifyReply,
  entityName: string
): boolean {
  if ((res.rowCount ?? 0) === 0 && res.rows.length === 0) {
    sendNotFound(reply, entityName);
    return false;
  }
  return true;
}

// ── UUID Validation ─────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate that a string is a valid UUID.
 * Returns true if valid, or sends a 400 and returns false.
 *
 * Usage:
 *   if (!requireValidUUID(serviceId, reply, 'serviceId')) return;
 */
export function requireValidUUID(value: string, reply: FastifyReply, paramName: string): boolean {
  if (!UUID_RE.test(value)) {
    void reply.status(400).send({ success: false, error: `Invalid ${paramName} — must be UUID` });
    return false;
  }
  return true;
}

// ── Date Range Parsing ──────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRange {
  startDate: string;
  endDate: string | null;
}

/**
 * Parse and validate YYYY-MM-DD date range from query params.
 * Returns today as startDate default, null as endDate default.
 *
 * Usage:
 *   const { startDate, endDate } = parseDateRange(req.query);
 */
export function parseDateRange(query: Record<string, string>): DateRange {
  const rawStart = query.start_date;
  const rawEnd = query.end_date;
  const startDate = (rawStart && DATE_RE.test(rawStart)) ? rawStart : new Date().toISOString().split('T')[0];
  const endDate = (rawEnd && DATE_RE.test(rawEnd)) ? rawEnd : null;
  return { startDate, endDate };
}

// ── Pagination Parsing ──────────────────────────────────────────────

export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Parse limit/offset from query params with bounds checking.
 * Defaults: limit=100, offset=0. Max limit=1000.
 */
export function parsePagination(query: Record<string, string>, defaults?: { limit?: number; maxLimit?: number }): PaginationParams {
  const maxLimit = defaults?.maxLimit ?? 1000;
  const defaultLimit = defaults?.limit ?? 100;

  const rawLimit = parseInt(query.limit, 10);
  const rawOffset = parseInt(query.offset, 10);

  const limit = (!Number.isNaN(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const offset = (!Number.isNaN(rawOffset) && rawOffset >= 0) ? rawOffset : 0;

  return { limit, offset };
}
