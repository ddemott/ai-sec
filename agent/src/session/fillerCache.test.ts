/**
 * Tests for the pre-synthesized filler cache. The synthesizer is mocked (one
 * fake AudioFrame per line) so we exercise warm/get/stream without real TTS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioFrame } from '@livekit/rtc-node';
import {
  warmFillers,
  getFillerFrame,
  frameStream,
  _resetFillerCacheForTest,
  type FillerSynthesizer,
} from './fillerCache.js';

const FRAME = { _fake: 'frame' } as unknown as AudioFrame;

function mockSynth(behavior?: (text: string) => Promise<AudioFrame>): FillerSynthesizer {
  return {
    synthesize: (text: string) => ({
      collect: () => (behavior ? behavior(text) : Promise.resolve(FRAME)),
    }),
  };
}

describe('fillerCache', () => {
  beforeEach(() => _resetFillerCacheForTest());

  it('HAPPY: warms lines once and serves the cached frame by voice+text', async () => {
    // WHO: the watchdog warming its hold lines at session start.
    // WHAT: warmFillers synthesizes each line (collect → one frame) and stores it;
    //        getFillerFrame returns it keyed by voice+text.
    const synth = mockSynth();
    const spy = vi.spyOn(synth, 'synthesize');
    const res = await warmFillers(synth, 'eve', ['one moment', 'sorry, hang on']);
    expect(res.warmed.sort()).toEqual(['one moment', 'sorry, hang on'].sort());
    expect(res.failed).toEqual([]);
    expect(getFillerFrame('eve', 'one moment')).toBe(FRAME);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('HAPPY: a second warm of an already-cached line does not re-synthesize', async () => {
    // WHY: the worker is long-lived; we synth once per voice and reuse across calls.
    const synth = mockSynth();
    const spy = vi.spyOn(synth, 'synthesize');
    await warmFillers(synth, 'eve', ['one moment']);
    await warmFillers(synth, 'eve', ['one moment']);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('SAD: a synth failure is isolated — other lines still warm, failure reported', async () => {
    // WHO: OpenAI TTS down for one line.
    // WHAT: that line lands in `failed` (caller logs it) and is NOT cached, so the
    //        watchdog will fall back to live TTS for it; the batch never rejects.
    const synth = mockSynth((t) =>
      t === 'boom' ? Promise.reject(new Error('TTS 503')) : Promise.resolve(FRAME)
    );
    const res = await warmFillers(synth, 'eve', ['ok', 'boom']);
    expect(res.warmed).toEqual(['ok']);
    expect(res.failed).toEqual(['boom']);
    expect(getFillerFrame('eve', 'boom')).toBeUndefined();
    expect(getFillerFrame('eve', 'ok')).toBe(FRAME);
  });

  it('different voice is a cache miss (re-synth per voice)', async () => {
    await warmFillers(mockSynth(), 'eve', ['hi']);
    expect(getFillerFrame('nova', 'hi')).toBeUndefined();
  });

  it('frameStream yields the single frame then closes (single-use)', async () => {
    const stream = frameStream(FRAME);
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first).toEqual({ done: false, value: FRAME });
    const second = await reader.read();
    expect(second.done).toBe(true);
  });
});
