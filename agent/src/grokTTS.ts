/**
 * xAI Grok TTS plugin for LiveKit Agents.
 *
 * Mirrors the shape of `@livekit/agents-plugin-openai`'s TTS class so it can
 * drop into `voice.AgentSession`'s `tts` slot without surrounding code
 * changes. Streaming endpoint isn't exposed by xAI, so we declare
 * `streaming: false` and only implement `synthesize()` — the parent class
 * handles the rest.
 *
 * API contract (POST https://api.x.ai/v1/tts):
 *   body: { text, voice_id, language, output_format: { codec, sample_rate } }
 *   auth: Authorization: Bearer ${apiKey}
 *   resp: single buffer of raw 16-bit mono PCM at the requested sample_rate
 */
import { AudioByteStream, shortuuid, tts } from '@livekit/agents';
import type { APIConnectOptions } from '@livekit/agents';

const GROK_TTS_URL = 'https://api.x.ai/v1/tts';
const GROK_TTS_SAMPLE_RATE = 24_000;
const GROK_TTS_CHANNELS = 1;

export type GrokVoice = 'eve' | 'ara' | 'rex' | 'sal' | 'leo' | (string & {});
// Any string works for custom cloned voices from xAI console (voice_id)

export interface GrokTTSOptions {
  apiKey: string;
  voice: GrokVoice;
  language: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_OPTIONS: Omit<GrokTTSOptions, 'apiKey'> = {
  voice: 'ara',
  language: 'en',
};

export class GrokTTS extends tts.TTS {
  label = 'xai.GrokTTS';
  private opts: GrokTTSOptions;
  private fetchImpl: typeof fetch;

  override get model(): string {
    return 'grok-tts';
  }

  override get provider(): string {
    return 'api.x.ai';
  }

  constructor(opts: Partial<GrokTTSOptions> & Pick<GrokTTSOptions, 'apiKey'>) {
    super(GROK_TTS_SAMPLE_RATE, GROK_TTS_CHANNELS, { streaming: false });
    if (!opts.apiKey) {
      throw new Error('xAI API key is required (XAI_API_KEY)');
    }
    this.opts = { ...DEFAULT_OPTIONS, ...opts } as GrokTTSOptions;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  updateOptions(opts: Partial<Pick<GrokTTSOptions, 'voice' | 'language'>>): void {
    this.opts = { ...this.opts, ...opts };
  }

  synthesize(
    text: string,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ): GrokChunkedStream {
    const responsePromise = this.fetchImpl(GROK_TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voice_id: this.opts.voice,
        language: this.opts.language,
        output_format: {
          codec: 'pcm',
          sample_rate: GROK_TTS_SAMPLE_RATE,
        },
      }),
      signal: abortSignal,
    });

    return new GrokChunkedStream(this, text, responsePromise, connOptions, abortSignal);
  }

  stream(): tts.SynthesizeStream {
    throw new Error('Streaming is not supported on xAI Grok TTS');
  }

  override async close(): Promise<void> {
    // No persistent connection to tear down.
  }
}

export class GrokChunkedStream extends tts.ChunkedStream {
  label = 'xai.GrokChunkedStream';
  private response: Promise<Response>;

  constructor(
    parent: GrokTTS,
    text: string,
    response: Promise<Response>,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ) {
    super(text, parent, connOptions, abortSignal);
    this.response = response;
  }

  protected async run(): Promise<void> {
    try {
      const res = await this.response;
      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(`xAI TTS upstream error (${res.status}): ${errText}`);
      }
      const buffer = await res.arrayBuffer();
      const requestId = shortuuid();
      const audioByteStream = new AudioByteStream(GROK_TTS_SAMPLE_RATE, GROK_TTS_CHANNELS);
      const frames = audioByteStream.write(buffer);

      // Emit frames; mark the trailing frame as `final: true` so downstream
      // playback knows the segment is complete.
      let lastFrame: (typeof frames)[number] | undefined;
      const flushPending = (segmentId: string, final: boolean) => {
        if (lastFrame) {
          this.queue.put({ requestId, segmentId, frame: lastFrame, final });
          lastFrame = undefined;
        }
      };
      for (const frame of frames) {
        flushPending(requestId, false);
        lastFrame = frame;
      }
      flushPending(requestId, true);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      // Emit via the base class's `emitError` and return cleanly instead
      // of throwing. LiveKit's `mainTask` is fire-and-forget (unawaited
      // promise on the parent class's `start()`), so a throw here lands as
      // an unhandled rejection at the Node level — even though the
      // framework also catches and emits the same 'error' event. Calling
      // `emitError` ourselves preserves the single-event contract the
      // test asserts (`errorEvents.length === 1`) and stops the
      // unhandled-rejection warning that surfaced under vitest.
      // Cast: emitError is declared `private` in the framework's .d.ts but
      // not actually `#private` in the JS — runtime-accessible to subclasses.
      (this as unknown as {
        emitError: (args: { error: Error; recoverable: boolean }) => void;
      }).emitError({
        error: error instanceof Error ? error : new Error(String(error)),
        recoverable: false,
      });
    } finally {
      this.queue.close();
    }
  }
}
