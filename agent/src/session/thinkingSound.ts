/**
 * Thinking-sound bed — a looping ambient track that covers dead air while the
 * agent is processing.
 *
 * LiveKit's `BackgroundAudioPlayer` owns everything that's hard here: it
 * publishes a second audio track, loops the clip, mixes it, and (given the
 * `agentSession`) starts the `thinkingSound` on `agent_state → 'thinking'` and
 * stops it the instant the agent starts speaking. We just wire it up under a
 * flag and tear it down on session close.
 *
 * Scope / caveats (the real-call validation items — none CI-verifiable):
 * - In PIPELINE mode the agent is 'thinking' ~2-3s every reply, so the bed plays
 *   before essentially every turn. That's intended for an *ambient* bed (reads as
 *   "receptionist typing") — unlike a spoken filler every turn, which reads as
 *   broken. It's an all-or-nothing-per-turn behavior; the framework's
 *   `thinkingSound` has no per-turn deadline knob.
 * - It MASKS dead air; it does NOT fix a slow/failed turn (raise TPM / fix the
 *   tool — VOICE_AGENT_PLAYBOOK §2.4 / §8).
 * - Whether the 2nd track mixes through to the PSTN caller, the right volume, and
 *   the feel on Realtime's sub-second turns are all real-call checks.
 *
 * This is the SFX half of the "thinking cover" TODO item; the spoken-filler half
 * is the separate output watchdog (`watchdog.ts`, `ENABLE_OUTPUT_WATCHDOG`). They
 * are independent flags and are NOT layered together here (the watchdog's `say()`
 * drives the agent into 'speaking', which would stop this bed — composing them is
 * a future, real-call-only design).
 */
import { voice } from '@livekit/agents';
import type { Room } from '@livekit/rtc-node';

type LogFn = (obj: Record<string, unknown>, msg: string) => void;

/** Minimal surface of BackgroundAudioPlayer we use — lets tests inject a fake. */
export interface ThinkingPlayer {
  start(opts: { room: Room; agentSession: voice.AgentSession }): Promise<void>;
  close(): Promise<void>;
}

export interface ThinkingSoundOptions {
  /** Bed volume 0-1. */
  volume: number;
  /** Structured logger (callLog). */
  log: { info: LogFn; warn: LogFn };
  /** Factory override for tests; defaults to the real BackgroundAudioPlayer. */
  createPlayer?: (volume: number) => ThinkingPlayer;
}

/**
 * Attach the thinking-sound bed to a live, started AgentSession whose room is
 * already connected. Returns a detach function (idempotent) that closes the
 * player — register it on the session 'close' event (and it's safe to call from
 * any other teardown path; the long-lived worker must not leak the published
 * track into the next call).
 */
export function attachThinkingSound(
  session: voice.AgentSession,
  room: Room,
  opts: ThinkingSoundOptions
): () => void {
  const create =
    opts.createPlayer ??
    ((volume: number): ThinkingPlayer =>
      new voice.BackgroundAudioPlayer({
        thinkingSound: { source: voice.BuiltinAudioClip.KEYBOARD_TYPING, volume },
      }));

  const player = create(opts.volume);

  // Fire-and-forget start: a failure to publish the bed must never break the
  // call — the caller just gets the normal (bed-less) experience.
  void (async () => {
    try {
      await player.start({ room, agentSession: session });
      opts.log.info(
        { event: 'thinking_sound_started', volume: opts.volume },
        'thinking-sound bed started (keyboard ambiance during agent thinking)'
      );
    } catch (e) {
      opts.log.warn(
        {
          event: 'thinking_sound_start_failed',
          error_message: e instanceof Error ? e.message : String(e),
        },
        'thinking-sound bed failed to start — call proceeds without it'
      );
    }
  })();

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    void player.close().catch(() => undefined);
  };
}
