/**
 * Pre-synthesized filler/recovery audio cache.
 *
 * The output watchdog (and, later, tool-boundary fillers) need to speak a fixed
 * holding phrase the INSTANT a deadline fires — with zero TTS latency, since the
 * whole point is that TTS is the thing that was slow. We synthesize each fixed
 * line ONCE (per worker, per voice) into a single AudioFrame via the TTS
 * plugin's `synthesize(text).collect()`, then replay it through
 * `session.say(text, { audio })`, which skips synthesis entirely.
 *
 * Why a module-level cache: the LiveKit worker is per-tenant and long-lived, so
 * the tenant's voice is stable across calls — synthesize once, reuse for every
 * subsequent call. Keyed by `${voice}::${text}` so a voice change re-synths.
 *
 * Warming is best-effort and async: a synth failure (OpenAI down) leaves the
 * entry absent, and callers fall back to a plain text `say()` (live synthesis —
 * slower, but never silent). Warming MUST NOT block call setup.
 */
import type { AudioFrame } from '@livekit/rtc-node';

/** Minimal slice of the TTS plugin we depend on — keeps this unit-testable. */
export interface FillerSynthesizer {
  synthesize(text: string): { collect(): Promise<AudioFrame> };
}

const cache = new Map<string, AudioFrame>();

function key(voice: string, text: string): string {
  return `${voice}::${text}`;
}

/**
 * Synthesize the given lines (once each) and store their frames. Resolves when
 * all attempts settle; individual failures are swallowed (logged by the caller
 * via the returned per-line results) so one bad synth can't reject the batch.
 * Returns the lines that failed to synth, for optional logging.
 */
export async function warmFillers(
  synth: FillerSynthesizer,
  voice: string,
  texts: readonly string[]
): Promise<{ warmed: string[]; failed: string[] }> {
  const warmed: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    texts.map(async (text) => {
      if (cache.has(key(voice, text))) {
        warmed.push(text);
        return;
      }
      try {
        const frame = await synth.synthesize(text).collect();
        cache.set(key(voice, text), frame);
        warmed.push(text);
      } catch {
        failed.push(text);
      }
    })
  );
  return { warmed, failed };
}

/** Return the cached frame for a line, or undefined if not warmed (yet/failed). */
export function getFillerFrame(voice: string, text: string): AudioFrame | undefined {
  return cache.get(key(voice, text));
}

/**
 * Build a single-use ReadableStream carrying one cached frame, for
 * `session.say(text, { audio: frameStream(...) })`. A ReadableStream is
 * consumed once, so this must be called fresh per playback.
 */
export function frameStream(frame: AudioFrame): ReadableStream<AudioFrame> {
  return new ReadableStream<AudioFrame>({
    start(controller) {
      controller.enqueue(frame);
      controller.close();
    },
  });
}

/** Test-only: clear the module cache between cases. */
export function _resetFillerCacheForTest(): void {
  cache.clear();
}
