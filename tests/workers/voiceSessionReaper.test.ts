/**
 * WHO:   the voice-session reaper background worker
 * WHAT:  finalizes voice_sessions rows the agent left status='active'
 * WHEN:  on each tick (and on-demand via reapStaleVoiceSessionsNow)
 * WHERE: src/workers/voiceSessionReaper.ts → reap_stale_voice_sessions() RPC
 * WHY:   guarantees every call has a completed record even if the agent never
 *        sends voice-session-end (the bug seen on the first real __PERSONA_NAME__ calls,
 *        which left rows stranded 'active' with no duration/transcript)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB pool before importing the worker (it grabs getPool at call time).
const mockQuery = vi.fn();
vi.mock('../../src/database/index.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import { reapStaleVoiceSessionsNow } from '../../src/workers/voiceSessionReaper';

describe('voiceSessionReaper.reapStaleVoiceSessionsNow', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('HAPPY: calls reap_stale_voice_sessions with the age and returns the count', async () => {
    // WHAT: the worker delegates to the SECURITY DEFINER RPC and surfaces the
    //       number of stranded rows it finalized.
    mockQuery.mockResolvedValue({ rows: [{ reap_stale_voice_sessions: 3 }] });

    const reaped = await reapStaleVoiceSessionsNow(20);

    expect(reaped).toBe(3);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('reap_stale_voice_sessions');
    expect(params).toEqual([20]);
  });

  it('HAPPY: returns 0 when nothing was stranded (no false positives)', async () => {
    // WHY: a quiet system must report 0, not throw — the worker should be a
    //      no-op when every call finalized normally.
    mockQuery.mockResolvedValue({ rows: [{ reap_stale_voice_sessions: 0 }] });
    expect(await reapStaleVoiceSessionsNow()).toBe(0);
  });

  it('SAD: a malformed RPC response degrades to 0 rather than NaN/undefined', async () => {
    // WHO: a driver/edge case returning an empty row set.
    // WHY: the count feeds a metric + log; it must never become undefined.
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await reapStaleVoiceSessionsNow()).toBe(0);
  });

  it('SAD: a DB error propagates so the tick can log + bump errors_total', async () => {
    // WHY: the worker tick wraps this in try/catch to emit
    //      errors_total{event="voice_session_reaper_failed"}; the helper itself
    //      must surface the failure, not swallow it.
    mockQuery.mockRejectedValue(new Error('connection terminated'));
    await expect(reapStaleVoiceSessionsNow()).rejects.toThrow(/connection terminated/);
  });
});
