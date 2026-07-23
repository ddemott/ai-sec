import { describe, it, expect, vi } from 'vitest';
import { reportDispatchNoParticipant } from './dispatchReport.js';

// The fire-and-forget ghost-dispatch metric report. Verifies it POSTs to the
// right backend route with the agent secret, names the absent-room case, and —
// critically — NEVER throws, so a metric hiccup can't stop the agent leaving a
// ghost room. Origin: 2026-07-23 double-dispatch.
const CFG = { BACKEND_URL: 'https://backend.test', AGENT_SECRET: 's'.repeat(32) };

function okFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, result: { recorded: true } }),
  });
}

describe('reportDispatchNoParticipant', () => {
  it('POSTs to the report route with the agent secret and tenant/room', async () => {
    const fetchImpl = okFetch();
    await reportDispatchNoParticipant(
      CFG,
      { tenantId: 'tenant-1', room: 'room:call-_123' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://backend.test/agent-tools/report-dispatch-no-participant');
    expect(init.method).toBe('POST');
    expect(init.headers['x-agent-secret']).toBe(CFG.AGENT_SECRET);
    expect(JSON.parse(init.body)).toEqual({ tenant_id: 'tenant-1', room: 'room:call-_123' });
  });

  it('names the absent-room case "unknown" (backend requires a non-empty room)', async () => {
    const fetchImpl = okFetch();
    await reportDispatchNoParticipant(
      CFG,
      { tenantId: 'tenant-1', room: undefined },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).room).toBe('unknown');
  });

  it('SAD: never throws when the backend POST rejects (metric is best-effort)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('backend down'));
    await expect(
      reportDispatchNoParticipant(
        CFG,
        { tenantId: 'tenant-1', room: 'r' },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).resolves.toBeUndefined();
  });
});
