/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  withHandler,
  withPoolClient,
  logEvent,
  requireAuth,
  requireSuperAdmin,
  type AppRequest,
} from '../middleware';
import { SUPER_ADMIN_TENANT_ID } from '../constants';
import { assertRowAffected } from './routeHelpers';
import { createTenantWithOwner } from '../services/tenants/bootstrap';
import { phonesWouldLoop } from '../services/phoneLoopGuard';

const CreateTenantSchema = z.object({
  tenant_name: z.string().min(1).max(200),
  business_type: z.string().min(1).max(50),
  owner_first_name: z.string().min(1).max(100),
  owner_last_name: z.string().min(1).max(100),
  owner_email: z.string().email(),
  owner_pass: z.string().min(6).max(200),
});

const UpdateAttributesSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  business_type: z.string().max(50).optional(),
  timezone: z.string().max(50).optional(),
  voice_id: z.string().max(100).optional().nullable(),
  // OpenAI TTS voice the agent actually uses (shimmer/nova/alloy/echo/onyx/fable).
  tts_voice: z.string().max(100).optional().nullable(),
  system_prompt: z.string().optional().nullable(),
  first_message: z.string().optional().nullable(),
  owner_phone: z.string().max(30).optional().nullable(),
  inbound_phone: z.string().max(30).optional().nullable(),
});

const UpdateConfigSchema = z.object({
  system_prompt: z.string().optional().nullable(),
  // Editable assistant name (e.g. "Chris"). NULL = no explicit name.
  persona_name: z.string().max(120).optional().nullable(),
  // The service a call books when the caller doesn't name a matchable one
  // (the "Default (when nothing matches)" radio in the services list).
  default_service_id: z.string().uuid().optional().nullable(),
  voice_id: z.string().max(100).optional().nullable(),
  business_type: z.string().max(50).optional(),
  first_message: z.string().optional().nullable(),
  save_preferences_enabled: z.boolean().optional(),
  preferences_instructions: z.string().optional().nullable(),
  // Per-tenant OpenAI TTS settings (NULL = use agent/platform defaults `shimmer`).
  // (Legacy comments referred to xAI Grok; the columns were reused after the 2026-06-25 full OpenAI conversion.)
  tts_voice: z.string().max(100).optional().nullable(),
  tts_speed: z.number().min(0.7).max(1.5).optional().nullable(),
  tts_soft: z.boolean().optional().nullable(),
  tts_cheerful: z.boolean().optional().nullable(),
  tts_formal: z.boolean().optional().nullable(),
  tts_warm: z.boolean().optional().nullable(),
  tts_concise: z.boolean().optional().nullable(),
  // Live-transfer destination (owner cell). NULL = no forwarding.
  forward_phone: z.string().max(30).optional().nullable(),
  // SMS notification destination for the owner. NULL = no owner SMS.
  owner_phone: z.string().max(30).optional().nullable(),
  // The line the tenant forwards INTO the assistant. Caller-ID match → collect
  // the caller's real number by voice. Must differ from forward_phone.
  forwarded_from_phone: z.string().max(30).optional().nullable(),
  // Minutes of gap the AI leaves between back-to-back bookings. 0 = no buffer
  // (default). Capped at 120 (2h) — beyond that is almost certainly a typo, not
  // an intent, and a runaway value would starve a day's availability.
  default_buffer_minutes: z.number().int().min(0).max(120).optional(),
  // Owner-editable spoken caller disclosure (the AI + transcription notice).
  // NULL/blank = revert to the platform default. Setting a non-blank value
  // requires disclosure_attested === true (the owner affirms it meets their
  // state disclosure laws); enforced in the handler, not the schema, because it
  // is a cross-field rule. Capped at 600 chars — a disclosure longer than that
  // is a scripting error, and a runaway value would add dead air at pickup.
  call_disclosure: z.string().max(600).optional().nullable(),
  // The affirmative attestation that accompanies a call_disclosure change.
  disclosure_attested: z.boolean().optional(),
});

const CreateTemplateSchema = z.object({
  business_type: z.string().min(1).max(50),
  display_name: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  system_prompt_template: z.string().optional(),
  first_message: z.string().optional(),
  voice_id: z.string().optional().nullable(),
  default_resource_name: z.string().optional(),
  default_resource_description: z.string().optional().nullable(),
  resource_label: z.string().optional(),
  resource_plural: z.string().optional(),
  employee_label: z.string().optional(),
  employee_plural: z.string().optional(),
  booking_label: z.string().optional(),
  example_services: z.array(z.string()).optional(),
});

export function registerTenantRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get(
    '/tenants',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireSuperAdmin(req, reply)) return;
      const res = await withPoolClient(pool, (client) =>
        client.query('SELECT * FROM tenants ORDER BY sort_order ASC, created_at DESC')
      );
      return reply.send(res.rows);
    }, 'Failed to fetch tenants')
  );

  app.delete(
    '/tenants/:id',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireSuperAdmin(req, reply)) return;
      const { id } = req.params as { id: string };
      const res = await withPoolClient(pool, (client) =>
        client.query('DELETE FROM tenants WHERE tenant_id = $1 RETURNING tenant_id', [id])
      );
      if (!assertRowAffected(res, reply, 'Tenant')) return;
      logEvent(req, 'tenant_deleted', { tenantId: id });
      return reply.send({ success: true });
    }, 'Failed to delete tenant')
  );

  app.post(
    '/tenants/:id/update-attributes',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireSuperAdmin(req, reply)) return;
      const { id } = req.params as { id: string };
      const parsed = UpdateAttributesSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const body = parsed.data;
      const res = await withPoolClient(pool, (client) =>
        client.query(
          `UPDATE tenants SET
            name = $1, business_type = $2, timezone = $3, voice_id = $4,
            system_prompt = $5, first_message = $6, owner_phone = $7, inbound_phone = $8,
            tts_voice = COALESCE($9, tts_voice)
         WHERE tenant_id = $10 RETURNING tenant_id`,
          [
            body.name,
            body.business_type,
            body.timezone,
            body.voice_id,
            body.system_prompt,
            body.first_message,
            body.owner_phone,
            body.inbound_phone,
            body.tts_voice ?? null,
            id,
          ]
        )
      );
      if (!assertRowAffected(res, reply, 'Tenant')) return;
      logEvent(req, 'tenant_attributes_updated', { tenantId: id });
      return reply.send({ success: true });
    }, 'Failed to update tenant')
  );

  app.get(
    '/tenants/:id/config',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireAuth(req, reply)) return;
      const { id } = req.params as { id: string };
      // Tenant config (system prompt, voice, business type) is sensitive — a
      // tenant user can read their own; super-admin can read any.
      const isSuperAdmin = req.auth?.tenant_id === SUPER_ADMIN_TENANT_ID;
      if (!isSuperAdmin && req.auth?.tenant_id !== id) {
        return reply
          .status(403)
          .send({ success: false, error: 'Forbidden: cross-tenant config access' });
      }
      const res = await withPoolClient(pool, (client) =>
        client.query(
          // call_disclosure (+ attestation stamp) MUST be here: AIConfigView loads
          // this row and seeds its Caller Disclosure field from it. Omitting the
          // column loads a saved custom disclosure as blank, and the next save then
          // writes null over it — silent data loss. (Copilot review, PR #234.)
          'SELECT tenant_id, name, business_type, system_prompt, persona_name, default_service_id, voice_id, first_message, team_size, timezone, save_preferences_enabled, preferences_instructions, tts_voice, tts_speed, tts_soft, tts_cheerful, tts_formal, tts_warm, tts_concise, forward_phone, owner_phone, inbound_phone, forwarded_from_phone, default_buffer_minutes, call_disclosure, call_disclosure_attested_at, call_disclosure_attested_by FROM tenants WHERE tenant_id = $1',
          [id]
        )
      );
      if (res.rows.length === 0)
        return reply.status(404).send({ success: false, error: 'Tenant not found' });
      return reply.send(res.rows[0]);
    }, 'Failed to fetch tenant config')
  );

  app.post(
    '/tenants/:id/update-config',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireAuth(req, reply)) return;
      const { id } = req.params as { id: string };
      // Same gate as GET /:id/config — tenant-self or super-admin only.
      const isSuperAdmin = req.auth?.tenant_id === SUPER_ADMIN_TENANT_ID;
      if (!isSuperAdmin && req.auth?.tenant_id !== id) {
        return reply
          .status(403)
          .send({ success: false, error: 'Forbidden: cross-tenant config update' });
      }
      const parsed = UpdateConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const body = parsed.data;

      // Read the prior business_type in the same transaction as the UPDATE
      // so a concurrent write can't slip the "did business_type change?"
      // check. When the type changes, also wipe wizard-auto-seeded
      // services and resources (rows where is_auto_seeded = true) so the
      // next wizard pass reseeds for the new template. User-typed rows
      // (is_auto_seeded = false, the default) are left untouched.
      // Origin: 2026-05-28 — picking a new business_type left stale
      // template defaults visible in step 1 because the wizard's
      // `services.length > 0` short-circuited re-seeding.
      const result = await withTenantClient(id, async (client) => {
        await client.query('BEGIN');
        try {
          const priorRes = await client.query<{
            business_type: string | null;
            system_prompt: string | null;
            persona_name: string | null;
            default_service_id: string | null;
            voice_id: string | null;
            first_message: string | null;
            save_preferences_enabled: boolean | null;
            preferences_instructions: string | null;
            tts_voice: string | null;
            tts_speed: number | null;
            tts_soft: boolean | null;
            tts_cheerful: boolean | null;
            tts_formal: boolean | null;
            tts_warm: boolean | null;
            tts_concise: boolean | null;
            forward_phone: string | null;
            owner_phone: string | null;
            forwarded_from_phone: string | null;
            inbound_phone: string | null;
            default_buffer_minutes: number | null;
            call_disclosure: string | null;
          }>(
            'SELECT business_type, system_prompt, persona_name, default_service_id, voice_id, first_message, save_preferences_enabled, preferences_instructions, tts_voice, tts_speed, tts_soft, tts_cheerful, tts_formal, tts_warm, tts_concise, forward_phone, owner_phone, forwarded_from_phone, inbound_phone, default_buffer_minutes, call_disclosure FROM tenants WHERE tenant_id = $1 FOR UPDATE',
            [id]
          );
          const prior = priorRes.rows[0];
          const priorBusinessType = prior?.business_type ?? null;

          // Partial-update safety: body fields not present (undefined) keep
          // the existing DB value; explicit null clears the field intentionally.
          const finalSystemPrompt =
            body.system_prompt !== undefined ? body.system_prompt : (prior?.system_prompt ?? null);
          const finalPersonaName =
            body.persona_name !== undefined ? body.persona_name : (prior?.persona_name ?? null);
          const finalDefaultServiceId =
            body.default_service_id !== undefined
              ? body.default_service_id
              : (prior?.default_service_id ?? null);
          const finalVoiceId =
            body.voice_id !== undefined ? body.voice_id : (prior?.voice_id ?? null);
          const finalBusinessType =
            body.business_type !== undefined ? body.business_type : priorBusinessType;
          const finalFirstMessage =
            body.first_message !== undefined ? body.first_message : (prior?.first_message ?? null);
          const finalSavePreferences =
            body.save_preferences_enabled !== undefined
              ? body.save_preferences_enabled
              : (prior?.save_preferences_enabled ?? false);
          const finalPreferencesInstructions =
            body.preferences_instructions !== undefined
              ? body.preferences_instructions
              : (prior?.preferences_instructions ?? null);
          const finalTtsVoice =
            body.tts_voice !== undefined ? body.tts_voice : (prior?.tts_voice ?? null);
          const finalTtsSpeed =
            body.tts_speed !== undefined ? body.tts_speed : (prior?.tts_speed ?? null);
          const finalTtsSoft =
            body.tts_soft !== undefined ? body.tts_soft : (prior?.tts_soft ?? null);
          const finalTtsCheerful =
            body.tts_cheerful !== undefined ? body.tts_cheerful : (prior?.tts_cheerful ?? null);
          const finalTtsFormal =
            body.tts_formal !== undefined ? body.tts_formal : (prior?.tts_formal ?? null);
          const finalTtsWarm =
            body.tts_warm !== undefined ? body.tts_warm : (prior?.tts_warm ?? null);
          const finalTtsConcise =
            body.tts_concise !== undefined ? body.tts_concise : (prior?.tts_concise ?? null);
          const finalForwardPhone =
            body.forward_phone !== undefined ? body.forward_phone : (prior?.forward_phone ?? null);
          const finalOwnerPhone =
            body.owner_phone !== undefined ? body.owner_phone : (prior?.owner_phone ?? null);
          const finalForwardedFromPhone =
            body.forwarded_from_phone !== undefined
              ? body.forwarded_from_phone
              : (prior?.forwarded_from_phone ?? null);
          const finalDefaultBufferMinutes =
            body.default_buffer_minutes !== undefined
              ? body.default_buffer_minutes
              : (prior?.default_buffer_minutes ?? 0);

          // Caller disclosure + its attestation gate.
          //
          // Normalize blank → null so a whitespace-only value is treated as
          // "revert to the platform default" (matches resolveDisclosure() in the
          // agent). Only compute a new value when the field is present in the body;
          // otherwise keep what is stored (partial-update safety).
          const priorDisclosure = prior?.call_disclosure ?? null;
          const finalCallDisclosure =
            body.call_disclosure !== undefined
              ? body.call_disclosure?.trim()
                ? body.call_disclosure.trim()
                : null
              : priorDisclosure;
          const disclosureChanged = finalCallDisclosure !== priorDisclosure;
          // Setting (or changing) a NON-blank custom disclosure is the affirmative
          // legal act and requires attestation. Clearing it back to null returns to
          // the compliant default and needs none. An unchanged value (idempotent
          // re-save) does not re-prompt. The attestation that is not RECORDED is
          // worthless as a defense, so on a valid change we stamp attested_at/by;
          // on a clear we wipe them (no custom text = nothing attested).
          const requiresAttestation = disclosureChanged && finalCallDisclosure !== null;
          if (requiresAttestation && body.disclosure_attested !== true) {
            await client.query('ROLLBACK');
            return { disclosureUnattested: true as const };
          }
          // Attestation-stamp mode driving the CASE in the UPDATE:
          //   'stamp' — record NOW() + the attesting user (a valid custom change)
          //   'clear' — wipe the stamp (disclosure reverted to default)
          //   'keep'  — leave the existing stamp untouched (no disclosure change)
          const attestMode: 'stamp' | 'clear' | 'keep' = requiresAttestation
            ? 'stamp'
            : disclosureChanged && finalCallDisclosure === null
              ? 'clear'
              : 'keep';
          const attestingUserId = req.auth?.user_id ?? null;

          // Loop guard: a transfer target equal to the forwarded-from line or
          // the AI's own DID would forward the call straight back into the AI.
          if (phonesWouldLoop(finalForwardPhone, finalForwardedFromPhone, prior?.inbound_phone)) {
            await client.query('ROLLBACK');
            return { loop: true as const };
          }

          const updRes = await client.query(
            `UPDATE tenants SET system_prompt = $1, voice_id = $2, business_type = $3, first_message = $4, save_preferences_enabled = $5, preferences_instructions = $6, tts_voice = $7, tts_speed = $8, tts_soft = $9, tts_cheerful = $10, tts_formal = $11, tts_warm = $12, tts_concise = $13, forward_phone = $14, owner_phone = $15, forwarded_from_phone = $16, persona_name = $17, default_service_id = $18, default_buffer_minutes = $19, call_disclosure = $20,
               call_disclosure_attested_at = CASE $21::text WHEN 'stamp' THEN NOW() WHEN 'clear' THEN NULL ELSE call_disclosure_attested_at END,
               call_disclosure_attested_by = CASE $21::text WHEN 'stamp' THEN $22::uuid WHEN 'clear' THEN NULL ELSE call_disclosure_attested_by END
             WHERE tenant_id = $23 RETURNING tenant_id`,
            [
              finalSystemPrompt,
              finalVoiceId,
              finalBusinessType,
              finalFirstMessage,
              finalSavePreferences,
              finalPreferencesInstructions,
              finalTtsVoice,
              finalTtsSpeed,
              finalTtsSoft,
              finalTtsCheerful,
              finalTtsFormal,
              finalTtsWarm,
              finalTtsConcise,
              finalForwardPhone,
              finalOwnerPhone,
              finalForwardedFromPhone,
              finalPersonaName,
              finalDefaultServiceId,
              finalDefaultBufferMinutes,
              finalCallDisclosure,
              attestMode,
              attestMode === 'stamp' ? attestingUserId : null,
              id,
            ]
          );

          let cleanedServices = 0;
          let cleanedResources = 0;
          const businessTypeChanged =
            body.business_type !== undefined && body.business_type !== priorBusinessType;
          if (businessTypeChanged) {
            const svcDel = await client.query(
              'DELETE FROM services WHERE tenant_id = $1 AND is_auto_seeded = true RETURNING service_id',
              [id]
            );
            const resDel = await client.query(
              'DELETE FROM resources WHERE tenant_id = $1 AND is_auto_seeded = true RETURNING resource_id',
              [id]
            );
            cleanedServices = svcDel.rowCount ?? 0;
            cleanedResources = resDel.rowCount ?? 0;
          }

          await client.query('COMMIT');
          return {
            updRes,
            businessTypeChanged,
            cleanedServices,
            cleanedResources,
            disclosureAttested: requiresAttestation,
          };
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });

      if ('loop' in result && result.loop) {
        return reply.status(400).send({
          success: false,
          error:
            "The transfer number can't be the same as the forwarded-from number or the assistant's own number — it would loop the call back to the assistant.",
        });
      }

      if ('disclosureUnattested' in result && result.disclosureUnattested) {
        return reply.status(400).send({
          success: false,
          error:
            'Changing the caller disclosure requires attestation. Confirm the disclosure meets the laws of the states where you and your callers are located, then resubmit with disclosure_attested set.',
        });
      }

      if (!assertRowAffected(result.updRes, reply, 'Tenant')) return;
      const disclosureAttested = result.disclosureAttested;
      logEvent(req, 'tenant_config_updated', {
        tenantId: id,
        businessTypeChanged: result.businessTypeChanged,
        cleanedServices: result.cleanedServices,
        cleanedResources: result.cleanedResources,
        // Audit trail: record the attestation event distinctly from the generic
        // column-change audit so a legal review can find "who attested what, when".
        ...(disclosureAttested ? { disclosureAttestedBy: req.auth?.user_id } : {}),
      });
      return reply.send({ success: true });
    }, 'Failed to update tenant config')
  );

  app.post(
    '/tenants/create',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireSuperAdmin(req, reply)) return;
      const parsed = CreateTenantSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const body = parsed.data;
      const firstName = body.owner_first_name.trim();
      const lastName = body.owner_last_name.trim();
      const tenantName = body.tenant_name.trim();
      const fullName = [firstName, lastName].filter(Boolean).join(' ');

      const result = await createTenantWithOwner(pool, {
        tenantName,
        businessType: body.business_type,
        ownerEmail: body.owner_email,
        ownerPassword: body.owner_pass,
        ownerFullName: fullName,
        ownerFirstName: firstName || null,
        ownerLastName: lastName || null,
        duplicateCheck: 'tenant_name',
      });

      if (!result.ok) {
        return reply.status(409).send({ success: false, error: result.conflictMessage });
      }

      logEvent(req, 'tenant_created', { tenantId: result.tenantId, name: tenantName });
      return reply.send({ success: true, tenant_id: result.tenantId });
    }, 'Failed to create tenant')
  );

  // Wizard "Done" hook — clears is_auto_seeded on every services +
  // resources row for the tenant. After this fires, those rows are
  // treated as user-owned, so a future business_type change (typically
  // post-launch, from Settings) won't delete them. Called by the
  // wizard's Done button (solo + team). 2026-05-28.
  app.post(
    '/tenants/:id/finalize-setup',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireAuth(req, reply)) return;
      const { id } = req.params as { id: string };
      const isSuperAdmin = req.auth?.tenant_id === SUPER_ADMIN_TENANT_ID;
      if (!isSuperAdmin && req.auth?.tenant_id !== id) {
        return reply
          .status(403)
          .send({ success: false, error: 'Forbidden: cross-tenant finalize' });
      }
      const result = await withTenantClient(id, async (client) => {
        await client.query('BEGIN');
        try {
          const svc = await client.query(
            'UPDATE services SET is_auto_seeded = false WHERE tenant_id = $1 AND is_auto_seeded = true RETURNING service_id',
            [id]
          );
          const res = await client.query(
            'UPDATE resources SET is_auto_seeded = false WHERE tenant_id = $1 AND is_auto_seeded = true RETURNING resource_id',
            [id]
          );
          await client.query('COMMIT');
          return { services: svc.rowCount ?? 0, resources: res.rowCount ?? 0 };
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });
      logEvent(req, 'tenant_setup_finalized', {
        tenantId: id,
        promotedServices: result.services,
        promotedResources: result.resources,
      });
      return reply.send({ success: true, ...result });
    }, 'Failed to finalize setup')
  );

  // Save tenant sort order (admin drag-and-drop reordering)
  app.post(
    '/tenants/reorder',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireSuperAdmin(req, reply)) return;
      const { order } = req.body as { order: string[] }; // array of tenant IDs in desired order
      if (!Array.isArray(order) || order.length === 0) {
        return reply
          .status(400)
          .send({ success: false, error: 'order must be a non-empty array of tenant IDs' });
      }
      await withPoolClient(pool, async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(
            `UPDATE tenants SET sort_order = v.idx
             FROM unnest($1::uuid[], $2::int[]) AS v(tenant_id, idx)
             WHERE tenants.tenant_id = v.tenant_id`,
            [order, order.map((_, i) => i)]
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });
      logEvent(req, 'tenants_reordered', { count: order.length });
      return reply.send({ success: true });
    }, 'Failed to save tenant order')
  );

  app.get(
    '/templates',
    withHandler(async (_req: AppRequest, reply) => {
      const res = await withPoolClient(pool, (client) =>
        client.query(
          'SELECT business_type, display_name, category, sort_order FROM business_templates ORDER BY display_name'
        )
      );
      return reply.send(res.rows);
    }, 'Failed to fetch templates')
  );

  app.get(
    '/templates/full',
    withHandler(async (_req: AppRequest, reply) => {
      const res = await withPoolClient(pool, (client) =>
        client.query('SELECT * FROM business_templates ORDER BY display_name')
      );
      return reply.send(res.rows);
    }, 'Failed to fetch full templates')
  );

  // POST /templates/create — Admin adds a new business type
  app.post(
    '/templates/create',
    withHandler(async (req: AppRequest, reply) => {
      if (!requireSuperAdmin(req, reply)) return;
      const parsed = CreateTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const body = parsed.data;
      const res = await withPoolClient(pool, (client) =>
        client.query(
          `
        INSERT INTO business_templates (
          business_type, display_name, category,
          system_prompt_template, first_message, voice_id,
          default_resource_name, default_resource_description,
          resource_label, resource_plural, employee_label, employee_plural,
          booking_label, example_services
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (business_type) DO UPDATE SET
          display_name = EXCLUDED.display_name, category = EXCLUDED.category,
          system_prompt_template = COALESCE(EXCLUDED.system_prompt_template, business_templates.system_prompt_template),
          first_message = COALESCE(EXCLUDED.first_message, business_templates.first_message),
          voice_id = COALESCE(EXCLUDED.voice_id, business_templates.voice_id),
          default_resource_name = COALESCE(EXCLUDED.default_resource_name, business_templates.default_resource_name),
          default_resource_description = COALESCE(EXCLUDED.default_resource_description, business_templates.default_resource_description),
          resource_label = COALESCE(EXCLUDED.resource_label, business_templates.resource_label),
          resource_plural = COALESCE(EXCLUDED.resource_plural, business_templates.resource_plural),
          employee_label = COALESCE(EXCLUDED.employee_label, business_templates.employee_label),
          employee_plural = COALESCE(EXCLUDED.employee_plural, business_templates.employee_plural),
          booking_label = COALESCE(EXCLUDED.booking_label, business_templates.booking_label),
          example_services = COALESCE(EXCLUDED.example_services, business_templates.example_services)
        RETURNING *
      `,
          [
            body.business_type,
            body.display_name,
            body.category,
            body.system_prompt_template ||
              `You are a professional receptionist for {{business_name}}.`,
            body.first_message || `Thanks for calling! How can we help you today?`,
            body.voice_id || null,
            body.default_resource_name || 'Station 1',
            body.default_resource_description || null,
            body.resource_label || 'Resource',
            body.resource_plural || 'Resources',
            body.employee_label || 'Employee',
            body.employee_plural || 'Employees',
            body.booking_label || 'Appointment',
            body.example_services || '{}',
          ]
        )
      );
      logEvent(req, 'template_created', { businessType: body.business_type });
      return reply.send({ success: true, template: res.rows[0] });
    }, 'Failed to create template')
  );
}
