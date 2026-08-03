// sim-call.mjs — talk to the voice agent from a browser, NO phone needed.
// Driven by scripts/simulate.sh `call`.
//
// Dispatches the agent into a fresh LiveKit room and mints a join token for a
// human "caller", then prints a one-click LiveKit Meet URL. Open it, allow the
// mic, and you're talking to the real agent: Deepgram STT -> GPT LLM -> Grok
// TTS -> /agent-tools booking. This exercises the entire voice path EXCEPT the
// Telnyx PSTN leg (which only a real carrier call can prove).
//
// Reads LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET + SIM_TENANT from env
// (bash wrapper exports them from the repo .env).

import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk';

const url = process.env.LIVEKIT_URL;
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;
const tenant = process.env.SIM_TENANT || 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';
// Same var the worker reads (agent/src/index.ts). Default = production's name, so
// `simulate.sh call` with no env still tests the deployed agent. Set
// AGENT_NAME=secretary-hq-agent-dev on BOTH a local worker and this dispatcher to
// hear a BRANCH — otherwise LiveKit load-balances the job across every worker with
// the same name and your local build races the Railway one for it. You would not
// be able to tell which code answered.
const AGENT_NAME = process.env.AGENT_NAME ?? 'secretary-hq-agent';

if (!url || !key || !secret) {
  console.error('sim-call: missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  process.exit(2);
}

const httpUrl = url.replace(/^ws/, 'http');
const room = `sim-call-${Date.now()}`;
const identity = `sim-caller-${Date.now()}`;

// Mint a 30-min join token for the human caller.
const at = new AccessToken(key, secret, { identity, ttl: '30m' });
at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
const token = await at.toJwt();

// Dispatch the agent into that room (so it's waiting when you join).
const dispatch = new AgentDispatchClient(httpUrl, key, secret);
try {
  await dispatch.createDispatch(room, AGENT_NAME, {
    metadata: JSON.stringify({ tenant_id: tenant }),
  });
} catch (e) {
  console.error('sim-call: dispatch failed:', e?.message ?? e);
  process.exit(1);
}

const joinUrl = `https://meet.livekit.io/custom?liveKitUrl=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;

console.log('');
console.log('  Agent dispatched. Open this URL, allow the mic, and talk to the agent:');
console.log('');
console.log('  ' + joinUrl);
console.log('');
console.log(`  room:    ${room}`);
console.log(`  tenant:  ${tenant}`);
console.log(`  agent:   ${AGENT_NAME}`);
console.log('  (real STT/LLM/TTS/booking — no phone. Token valid 30 min.)');
console.log('');
