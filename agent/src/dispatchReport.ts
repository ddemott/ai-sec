/**
 * Fire-and-forget metric report: tell the backend that a dispatch produced no
 * SIP participant — a GHOST/duplicate dispatch the agent is leaving without
 * greeting. Bumps errors_total{event="dispatch_no_participant"} on the backend
 * /metrics board so the ghost-leg RATE is observable (and alertable) rather than
 * only visible as a log line.
 *
 * SAFETY CONTRACT: NEVER throws, NEVER blocks the agent from leaving. Short
 * timeout, all errors swallowed. The 5W warn log at the call site is the primary
 * record; this is the durable counter. Origin: 2026-07-23 double-dispatch.
 */
import { ToolsClient } from './toolsClient.js';

export async function reportDispatchNoParticipant(
  cfg: { BACKEND_URL: string; AGENT_SECRET: string },
  info: { tenantId: string; room: string | undefined },
  deps: { fetchImpl?: typeof fetch } = {}
): Promise<void> {
  try {
    const client = new ToolsClient({
      backendUrl: cfg.BACKEND_URL,
      agentSecret: cfg.AGENT_SECRET,
      timeoutMs: 3000,
      fetchImpl: deps.fetchImpl,
    });
    await client.call('/agent-tools/report-dispatch-no-participant', {
      tenant_id: info.tenantId,
      // room.name is `string | undefined` in the LiveKit types; the backend
      // schema requires a non-empty string, so name the absent case explicitly.
      room: info.room && info.room.length > 0 ? info.room : 'unknown',
    });
  } catch {
    // Best-effort metric only; the call-site warn log already captured this.
  }
}
