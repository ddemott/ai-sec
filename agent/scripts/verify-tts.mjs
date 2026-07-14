/**
 * CAN THE AGENT ACTUALLY SPEAK?
 *
 * WHY THIS EXISTS (2026-07-14): I switched the TTS engine to Deepgram Aura and shipped
 * it straight to production. Typecheck passed. 567 unit tests passed. And the phone
 * line went COMPLETELY SILENT — the owner rang his own business, said "Hello… Hello…",
 * heard nothing, and hung up.
 *
 * The cause was one query parameter. The plugin appends `?speed=…` to the WebSocket
 * upgrade URL, Aura answers 400, the socket never opens, and there is no TTS at all.
 *
 * Not one of those 567 tests could have caught it, because NOT ONE OF THEM SYNTHESISES
 * A WORD. They mock the TTS. A voice product where nobody listens to the voice before
 * deploying is a voice product that ships silence.
 *
 * "It compiles and the tests are green" is not the same as "it makes noise."
 *
 * So this script does the one thing that matters: it opens the REAL socket to the REAL
 * API with the REAL config the agent uses, and demands actual audio bytes back. It is
 * the last gate before a TTS change reaches a phone line.
 *
 *   cd agent && node scripts/verify-tts.mjs
 *
 * Exit 0 = it speaks. Exit 1 = do not deploy.
 */
import { WebSocket } from 'ws';

const KEY = process.env.DEEPGRAM_API_KEY;
if (!KEY) {
  console.error('DEEPGRAM_API_KEY not set — cannot verify the agent can speak.');
  process.exit(2);
}

// Every voice the tenant picker can map to. A per-tenant voice that 400s is a silent
// line for THAT tenant, which is no better than a silent line for everyone.
const VOICES = [
  'aura-asteria-en',
  'aura-luna-en',
  'aura-stella-en',
  'aura-athena-en',
  'aura-orion-en',
  'aura-arcas-en',
];

const SENTENCE = 'Thank you for calling. How can I help you today?';

/** Open the socket exactly as the LiveKit plugin does, send text, demand audio back. */
function speak(voice) {
  return new Promise((resolve) => {
    const url = `wss://api.deepgram.com/v1/speak?model=${voice}&encoding=linear16&sample_rate=24000`;
    const ws = new WebSocket(url, { headers: { Authorization: `Token ${KEY}` } });
    let bytes = 0;

    const done = (ok, detail) => {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
      resolve({ voice, ok, bytes, detail });
    };

    const timer = setTimeout(() => done(false, 'timeout — no audio within 15s'), 15_000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'Speak', text: SENTENCE }));
      ws.send(JSON.stringify({ type: 'Flush' }));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) bytes += data.length;
      // Deepgram signals the end of the utterance; by then we must have real audio.
      if (!isBinary && String(data).includes('Flushed')) {
        clearTimeout(timer);
        done(bytes > 1000, bytes > 1000 ? `${bytes} bytes of audio` : `only ${bytes} bytes`);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      // THE 2026-07-14 OUTAGE, exactly: "Unexpected server response: 400".
      done(false, err.message);
    });

    ws.on('close', (code) => {
      clearTimeout(timer);
      // ALWAYS resolve. The first version only resolved when bytes === 0 — so a socket
      // that delivered audio and then closed WITHOUT a "Flushed" message left the
      // promise pending forever, and the whole gate hung. A verification script that
      // can hang is a verification script that gets bypassed, which is exactly how the
      // outage it exists to prevent happens again.
      done(
        bytes > 1000,
        bytes > 1000
          ? `${bytes} bytes of audio`
          : `socket closed (${code}) with only ${bytes} bytes`
      );
    });
  });
}

const results = [];
for (const v of VOICES) results.push(await speak(v));

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  \x1b[32mSPEAKS\x1b[0m  ${r.voice.padEnd(18)} ${r.detail}`);
  } else {
    failed++;
    console.log(`  \x1b[31mSILENT\x1b[0m  ${r.voice.padEnd(18)} ${r.detail}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${results.length} voices produce NO AUDIO. DO NOT DEPLOY.`);
  console.error('A silent phone line is worse than a choppy one.');
  process.exit(1);
}
console.log(`\nAll ${results.length} voices speak. Safe to deploy.`);
