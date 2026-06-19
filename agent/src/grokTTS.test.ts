/**
 * Tests for the xAI Grok TTS plugin. Fetch is mocked end-to-end; we never
 * hit the real xAI endpoint.
 *
 * Covers: constructor validation, request shape (URL, headers, body), and
 * audio frame emission (final-flag, abort handling, upstream error path).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initializeLogger } from '@livekit/agents';
import { GrokTTS } from './grokTTS.js';

// LiveKit's tts.ChunkedStream constructs a logger eagerly; the test runner
// has no agent CLI to do that for us.
beforeAll(() => {
  initializeLogger({ pretty: false, level: 'silent' });
});

const API_KEY = 'xai-test-key';
const SAMPLE_RATE = 24_000;

/**
 * Build a Response that returns `byteLength` bytes of zeroed PCM. AudioByteStream
 * needs ≥ 2 bytes (one Int16 sample) per frame. By default we pass 100ms worth
 * of audio (one frame at 24kHz mono = sampleRate/10 * 2 bytes = 4800).
 */
function pcmResponse(byteLength = 4800, status = 200): Response {
  const buf = new ArrayBuffer(byteLength);
  return new Response(buf, { status, headers: { 'content-type': 'audio/pcm' } });
}

describe('GrokTTS constructor', () => {
  it('SAD: missing apiKey throws synchronously', () => {
    // WHO: Operator forgot to set XAI_API_KEY in Railway env
    // WHAT: Constructor throws immediately rather than failing on first call
    // WHY: Surfaces config errors at agent startup, not mid-call dead air
    // @ts-expect-error testing the runtime guard
    expect(() => new GrokTTS({})).toThrow(/XAI_API_KEY/);
  });

  it('HAPPY: declares 24kHz mono, non-streaming capabilities', () => {
    // WHY: voice.AgentSession asks the TTS for sample rate / channels to
    //       size its audio pipeline; if these drift the playback warps
    const t = new GrokTTS({ apiKey: API_KEY });
    expect(t.sampleRate).toBe(SAMPLE_RATE);
    expect(t.numChannels).toBe(1);
    expect(t.capabilities.streaming).toBe(false);
    expect(t.model).toBe('grok-tts');
    expect(t.provider).toBe('api.x.ai');
  });

  it('HAPPY: cheerful defaults to false when not provided', async () => {
    // WHO: any caller path that constructs GrokTTS without specifying cheerful
    // WHAT: omitting cheerful from the constructor options must produce plain
    //        text (no <cheerful> tag) on the next synthesize call
    // WHEN: any session where the tenant's Cheerful checkbox is null/unset
    // WHERE: GrokTTS DEFAULT_OPTIONS — cheerful: false
    // WHY: if the default were true, every tenant who hadn't explicitly opted
    //       in would unknowingly get cheerful prosody applied to every utterance
    let sentText: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentText = JSON.parse(init!.body as string).text;
      return pcmResponse();
    };
    const t = new GrokTTS({ apiKey: API_KEY, fetchImpl });
    for await (const _f of t.synthesize('Default delivery')) {
      // drain
    }
    expect(sentText).toBe('Default delivery');
  });
});

describe('GrokTTS.synthesize', () => {
  it('HAPPY: posts the documented xAI payload (URL, auth, body)', async () => {
    // WHO: Live caller hears the agent greeting; that string flows through here
    // WHAT: Verify the request shape matches xAI's /v1/tts contract exactly —
    //        endpoint, bearer token, JSON body keys, PCM 24kHz output_format
    // WHY: A drift in any of these silently fails — request gets rejected
    //        by xAI and the caller hears dead air. Pin every field.
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return pcmResponse();
    };
    const t = new GrokTTS({ apiKey: API_KEY, voice: 'rex', fetchImpl });

    const stream = t.synthesize('Hello caller');
    // Drain the stream so run() executes
    for await (const _frame of stream) {
      // no-op
    }

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://api.x.ai/v1/tts');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toEqual({
      text: 'Hello caller',
      voice_id: 'rex',
      language: 'en',
      speed: 1.0,
      output_format: { codec: 'pcm', sample_rate: SAMPLE_RATE },
    });
  });

  it('HAPPY: speed + soft are applied — body carries speed, text wrapped in <soft>', async () => {
    // WHO: Tenant wants a slow, soothing "caring friend" delivery (Dale's brief)
    // WHAT: speed flows to the xAI `speed` param; soft wraps the utterance in
    //        the <soft> prosody tag so delivery is gentler. voice is unchanged.
    // WHY: These are the two knobs that turn the British female voice (eve) from
    //        brisk/neutral into slow+soothing without changing WHO is speaking.
    const calls: Array<{ init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls.push({ init: init ?? {} });
      return pcmResponse();
    };
    const t = new GrokTTS({ apiKey: API_KEY, voice: 'eve', speed: 0.85, soft: true, fetchImpl });

    for await (const _f of t.synthesize('How can I help you today?')) {
      // drain
    }

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.voice_id).toBe('eve');
    expect(body.speed).toBe(0.85);
    expect(body.text).toBe('<soft>How can I help you today?</soft>');
  });

  it('HAPPY: soft defaults off — text is sent unwrapped when soft not set', async () => {
    // WHY: The TTS class must stay byte-for-byte backward compatible when the
    //        new options are omitted (e.g. other call sites / tests) — soft=false
    //        and speed=1.0 by default so behavior is unchanged unless opted in.
    let sentText: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentText = JSON.parse(init!.body as string).text;
      return pcmResponse();
    };
    const t = new GrokTTS({ apiKey: API_KEY, fetchImpl });
    for await (const _f of t.synthesize('plain')) {
      // drain
    }
    expect(sentText).toBe('plain');
  });

  it('HAPPY: emits frames; the LAST frame is marked final:true', async () => {
    // WHO: AgentSession playback consumes frames and uses final:true to
    //       decide when a segment is complete (end-of-utterance for VAD)
    // WHAT: Two frames worth of PCM in → two frames out, only the last final
    // WHY: If we marked every frame final the playback would chop. If we
    //       never marked final, downstream silence detection would hang.
    const fetchImpl: typeof fetch = async () => pcmResponse(9_600); // 200ms = 2 frames
    const t = new GrokTTS({ apiKey: API_KEY, fetchImpl });

    const collected: Array<{ final: boolean }> = [];
    for await (const frame of t.synthesize('two-frame greeting')) {
      collected.push({ final: frame.final });
    }

    expect(collected.length).toBeGreaterThanOrEqual(2);
    // Only the trailing frame should carry final:true
    expect(collected[collected.length - 1].final).toBe(true);
    expect(collected.slice(0, -1).every((f) => f.final === false)).toBe(true);
  });

  it('SAD: upstream non-2xx surfaces via the error event with status + body', async () => {
    // WHO: xAI rate-limit, bad voice ID, or expired API key
    // WHAT: Stream emits an `error` event carrying the HTTP status + xAI
    //        body so AgentSession's metrics pipeline can log it. The
    //        iteration itself ends cleanly (parent class swallows the
    //        throw and closes the queue).
    // WHY: AgentSession listens for `error` to mark the segment failed;
    //        if we lost the status code there it would be impossible to
    //        tell auth failure from rate-limit from bad voice in prod logs
    const fetchImpl: typeof fetch = async () =>
      new Response('{"error":"invalid voice_id"}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    const t = new GrokTTS({ apiKey: API_KEY, fetchImpl });
    const errorEvents: Array<{ error: Error }> = [];
    t.on('error', (e) => errorEvents.push(e as { error: Error }));

    let frameCount = 0;
    for await (const _frame of t.synthesize('bad call')) {
      frameCount++;
    }

    expect(frameCount).toBe(0);
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].error).toBeInstanceOf(Error);
    expect(errorEvents[0].error.message).toContain('400');
    expect(errorEvents[0].error.message).toContain('invalid voice_id');
  });

  it('SAD: AbortError mid-fetch ends the stream cleanly (no throw)', async () => {
    // WHO: Caller hangs up while a TTS chunk is in flight, AgentSession
    //       aborts the synth to free resources
    // WHAT: Stream returns without throwing — the parent class still
    //        closes the queue downstream
    // WHY: An uncaught abort would crash the worker and drop unrelated
    //        concurrent calls. Aborts are normal call-end signals.
    const fetchImpl: typeof fetch = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    const t = new GrokTTS({ apiKey: API_KEY, fetchImpl });

    const stream = t.synthesize('will-be-aborted');
    let frameCount = 0;
    let threw = false;
    try {
      for await (const _frame of stream) {
        frameCount++;
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(frameCount).toBe(0);
  });

  it('HAPPY: updateOptions changes the voice on the next call', async () => {
    // WHY: A future "per-tenant voice" feature will swap voice between
    //       calls on the same TTS instance; verify the option is picked up
    let observedVoice: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      observedVoice = JSON.parse(init!.body as string).voice_id;
      return pcmResponse();
    };
    const t = new GrokTTS({ apiKey: API_KEY, voice: 'ara', fetchImpl });

    t.updateOptions({ voice: 'leo' });
    for await (const _f of t.synthesize('after update')) {
      // drain
    }
    expect(observedVoice).toBe('leo');
  });

  it('HAPPY: cheerful=true wraps text in <cheerful> tag, soft=false leaves outer plain', async () => {
    // WHO: tenant with the Cheerful voice style checkbox checked
    // WHAT: synthesize emits the text wrapped in <cheerful>; the absence of
    //        soft=true means no outer <soft> wrapper is added
    // WHEN: every utterance on a call for that tenant
    // WHERE: grokTTS.synthesize prosody-tag branch (cheerful only)
    // WHY: validates the cheerful feature independently from soft so a
    //       regression in one doesn't hide behind the other
    let sentText: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentText = JSON.parse(init!.body as string).text;
      return pcmResponse();
    };
    const t = new GrokTTS({ apiKey: API_KEY, cheerful: true, soft: false, fetchImpl });
    for await (const _f of t.synthesize('Good morning!')) {
      // drain
    }
    expect(sentText).toBe('<cheerful>Good morning!</cheerful>');
  });

  it('HAPPY: soft=true + cheerful=true stacks — cheerful inner, soft outer', async () => {
    // WHO: tenant with both Soft and Cheerful checkboxes checked
    // WHAT: synthesize wraps text in cheerful first, then soft around it —
    //        the xAI API interprets the outer tag last so soft modulates an
    //        already-cheerful delivery
    // WHEN: every utterance on a call for a tenant with both flags set
    // WHERE: grokTTS.synthesize — sequential prosody-tag application
    // WHY: the stacking order matters; reversing it produces a different
    //       audio character; this pins the documented intent
    let sentText: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentText = JSON.parse(init!.body as string).text;
      return pcmResponse();
    };
    const t = new GrokTTS({ apiKey: API_KEY, cheerful: true, soft: true, fetchImpl });
    for await (const _f of t.synthesize('Hello!')) {
      // drain
    }
    expect(sentText).toBe('<soft><cheerful>Hello!</cheerful></soft>');
  });

  it('HAPPY: cheerful=false, soft=false — text sent unwrapped (regression guard)', async () => {
    // WHO: tenant with neither Soft nor Cheerful checked (the default)
    // WHAT: text arrives at xAI unmodified — no prosody tags, plain string
    // WHEN: every utterance on a call where both flags are explicitly false
    // WHERE: grokTTS.synthesize prosody-tag section
    // WHY: regression guard for the default-off case; adding the cheerful
    //       feature must not change behavior for tenants who didn't opt in
    let sentText: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentText = JSON.parse(init!.body as string).text;
      return pcmResponse();
    };
    const t = new GrokTTS({ apiKey: API_KEY, cheerful: false, soft: false, fetchImpl });
    for await (const _f of t.synthesize('Plain text')) {
      // drain
    }
    expect(sentText).toBe('Plain text');
  });

  it('HAPPY: updateOptions({ cheerful: true }) is picked up on next synthesize call', async () => {
    // WHO: a future per-tenant voice swap that enables cheerful mid-session
    // WHAT: construct with cheerful=false, call updateOptions to enable it,
    //        then synthesize — body.text must be wrapped in <cheerful>
    // WHEN: any session that dynamically updates TTS options
    // WHERE: grokTTS.updateOptions + synthesize
    // WHY: without this, a dynamic option update would be a no-op and the
    //       caller would hear the wrong prosody style after the update
    let sentText: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentText = JSON.parse(init!.body as string).text;
      return pcmResponse();
    };
    const t = new GrokTTS({ apiKey: API_KEY, cheerful: false, fetchImpl });
    t.updateOptions({ cheerful: true });
    for await (const _f of t.synthesize('Updated greeting')) {
      // drain
    }
    expect(sentText).toBe('<cheerful>Updated greeting</cheerful>');
  });

  it('SAD: cheerful=true + upstream 400 error — error event fires, no frames emitted', async () => {
    // WHO: xAI rejects the request (bad API key, invalid voice, rate-limit)
    //        even though a prosody tag was applied before the fetch
    // WHAT: the error event fires with the status code; no frames are emitted
    // WHEN: any upstream error regardless of which prosody tags are set
    // WHERE: grokTTS run() error branch — same path as the existing SAD test
    // WHY: prosody-tag application must not suppress error propagation; the
    //       tag is cosmetic and the error path must survive it unchanged
    const fetchImpl: typeof fetch = async () =>
      new Response('{"error":"invalid voice_id"}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    const t = new GrokTTS({ apiKey: API_KEY, cheerful: true, fetchImpl });
    const errorEvents: Array<{ error: Error }> = [];
    t.on('error', (e) => errorEvents.push(e as { error: Error }));

    let frameCount = 0;
    for await (const _frame of t.synthesize('will-fail')) {
      frameCount++;
    }

    expect(frameCount).toBe(0);
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].error).toBeInstanceOf(Error);
    expect(errorEvents[0].error.message).toContain('400');
  });
});

describe('GrokTTS.stream', () => {
  it('SAD: throws — xAI does not expose a streaming endpoint', () => {
    // WHY: Capabilities advertise streaming:false, but defense-in-depth:
    //       if anything calls stream() it should fail loud, not return a
    //       broken stream that emits no frames
    const t = new GrokTTS({ apiKey: API_KEY });
    expect(() => t.stream()).toThrow(/Streaming is not supported/);
  });
});

describe('GrokTTS.close', () => {
  it('HAPPY: resolves without error', async () => {
    // WHY: AgentSession calls close() during teardown; if we threw, the
    //       worker would log noisy errors on every call end
    const t = new GrokTTS({ apiKey: API_KEY });
    await expect(t.close()).resolves.toBeUndefined();
  });
});
