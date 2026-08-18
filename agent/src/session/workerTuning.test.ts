/**
 * Tests for the worker-pool knob. Env parsing, not LiveKit — the value's only
 * job is to be a sane number or nothing at all.
 */
import { describe, it, expect } from 'vitest';
import { idleProcessOverride } from './workerTuning.js';

describe('idleProcessOverride', () => {
  it('HAPPY: a positive integer is honoured', () => {
    // WHO: a developer running `npm run dev:local` to hear a call.
    // WHY: dev mode keeps ZERO idle processes, so without this the caller waits
    //      through process spawn + VAD load that production pre-pays.
    expect(idleProcessOverride({ NUM_IDLE_PROCESSES: '1' } as NodeJS.ProcessEnv)).toBe(1);
    expect(idleProcessOverride({ NUM_IDLE_PROCESSES: '4' } as NodeJS.ProcessEnv)).toBe(4);
  });

  it('SAD: unset, blank, non-numeric, zero and negative all fall back to the SDK default', () => {
    // WHY: `Number('')` is 0 and `Number('abc')` is NaN, and either handed to
    //      the SDK as a pool size disables pre-warming outright — a worse
    //      outage than the latency this knob exists to remove. Same
    //      blank-string trap as MAX_TOOL_STEPS and the silence timers.
    for (const value of [undefined, '', '   ', 'abc', '0', '-2']) {
      const env = (value === undefined ? {} : { NUM_IDLE_PROCESSES: value }) as NodeJS.ProcessEnv;
      expect(idleProcessOverride(env), `NUM_IDLE_PROCESSES=${String(value)}`).toBeUndefined();
    }
  });

  it('never hard-codes production down to a laptop-sized pool', () => {
    // The SDK default is min(cpus,4) in production. Returning a number here
    // when nothing was set would replace that with whatever suited dev.
    expect(idleProcessOverride({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
