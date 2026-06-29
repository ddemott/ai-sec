/**
 * Tests for attachThinkingSound — the thinking-sound bed wiring.
 *
 * These pin the WIRING contract, not the audio (acoustic/PSTN-mix behavior is
 * real-call-only, per the playbook): the bed is created + started with the live
 * room/session when attached, the detach closes it exactly once (idempotent —
 * the long-lived worker must not leak the published track), and a start failure
 * is swallowed so it can never break the call.
 *
 * Each test carries a 5W diagnostic header.
 */
import { describe, it, expect, vi } from 'vitest';
import { attachThinkingSound, type ThinkingPlayer } from './thinkingSound.js';
import type { voice } from '@livekit/agents';
import type { Room } from '@livekit/rtc-node';

// Minimal stand-ins — attachThinkingSound only passes these through to the
// injected player; it never inspects their internals.
const fakeSession = {} as unknown as voice.AgentSession;
const fakeRoom = {} as unknown as Room;

function makeLog() {
  return { info: vi.fn(), warn: vi.fn() };
}

/** A controllable fake player + the factory to inject it. */
function makeFakePlayer(startImpl?: () => Promise<void>) {
  const player: ThinkingPlayer & {
    start: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  } = {
    start: vi.fn(startImpl ?? (() => Promise.resolve())),
    close: vi.fn(() => Promise.resolve()),
  };
  const createPlayer = vi.fn(() => player);
  return { player, createPlayer };
}

describe('attachThinkingSound', () => {
  it('starts the player with the live room + session and the configured volume', async () => {
    // WHO: a tenant with ENABLE_THINKING_SOUND=true on a live call.
    // WHAT: the bed is created at the configured volume and started against the
    //       connected room + running agent session.
    // WHEN: attach is called after session.start (room already connected).
    // WHERE: index.ts ENABLE_THINKING_SOUND block.
    // WHY: the bed only covers dead air if it actually publishes into the call.
    const { player, createPlayer } = makeFakePlayer();
    const log = makeLog();

    attachThinkingSound(fakeSession, fakeRoom, { volume: 0.6, log, createPlayer });
    await Promise.resolve(); // let the fire-and-forget start() settle

    expect(createPlayer).toHaveBeenCalledWith(0.6);
    expect(player.start).toHaveBeenCalledWith({ room: fakeRoom, agentSession: fakeSession });
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'thinking_sound_started', volume: 0.6 }),
      expect.any(String)
    );
  });

  it('detach closes the player exactly once (idempotent)', async () => {
    // WHO: the worker tearing down a finished call (and reused for the next one).
    // WHAT: the returned detach closes the player; calling it again is a no-op.
    // WHEN: session 'close' fires (possibly more than once across teardown).
    // WHERE: the detach returned by attachThinkingSound.
    // WHY: the worker is long-lived — a leaked published track would bleed the
    //      bed into the next caller's call.
    const { player, createPlayer } = makeFakePlayer();
    const detach = attachThinkingSound(fakeSession, fakeRoom, {
      volume: 0.5,
      log: makeLog(),
      createPlayer,
    });
    await Promise.resolve();

    detach();
    detach();
    // close() is chained on the settled start() promise — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(player.close).toHaveBeenCalledTimes(1);
  });

  it('detach before start() resolves still closes once start settles (no leaked track)', async () => {
    // WHO: a call that ends almost immediately (session closes before the bed's
    //      async start() has finished publishing its track).
    // WHAT: detach must NOT close before start settles — otherwise start()
    //       publishes a track AFTER close() already ran, leaking it.
    // WHEN: detach() is called while start() is still in-flight.
    // WHERE: the `started.then(close)` chaining in attachThinkingSound.
    // WHY: the long-lived worker would bleed the leaked bed into the next call.
    let resolveStart!: () => void;
    const startGate = new Promise<void>((r) => {
      resolveStart = r;
    });
    const { player, createPlayer } = makeFakePlayer(() => startGate);

    const detach = attachThinkingSound(fakeSession, fakeRoom, {
      volume: 0.5,
      log: makeLog(),
      createPlayer,
    });

    // Close arrives BEFORE start() has resolved.
    detach();
    expect(player.close).not.toHaveBeenCalled(); // must wait for start to settle

    resolveStart();
    await Promise.resolve();
    await Promise.resolve();

    expect(player.close).toHaveBeenCalledTimes(1);
  });

  it('swallows a start failure (the call proceeds without the bed)', async () => {
    // WHO: a call where publishing the bed track fails (e.g. room race).
    // WHAT: the rejection is caught + logged as a warning, never rethrown.
    // WHEN: player.start() rejects.
    // WHERE: the fire-and-forget start in attachThinkingSound.
    // WHY: a cosmetic bed must NEVER break the actual call.
    const { player, createPlayer } = makeFakePlayer(() =>
      Promise.reject(new Error('publish failed'))
    );
    const log = makeLog();

    const detach = attachThinkingSound(fakeSession, fakeRoom, {
      volume: 0.5,
      log,
      createPlayer,
    });
    // Flush the rejected start() microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(player.start).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'thinking_sound_start_failed' }),
      expect.any(String)
    );
    // detach is still safe after a failed start.
    expect(() => detach()).not.toThrow();
  });
});
