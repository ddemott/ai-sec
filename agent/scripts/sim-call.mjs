// sim-call.mjs — talk to the voice agent from a browser, NO phone needed.
// Driven by scripts/simulate.sh `call` and the dashboard browser-call launcher.
//
// DEFAULT (dashboard): create room, mint token, print join URL + room/tenant/agent,
// dispatch immediately, EXIT. Backend `startBrowserCallerSession` waits ≤15s for
// this process to finish and parse stdout — it cannot wait for a human.
//
// SIM_CALL_JOIN_FIRST=1 (CLI `simulate.sh call`): print the same banner first,
// wait until the human joins, THEN dispatch. Prod agent leaves after 20s with
// no participant (ghost-dispatch guard) — dispatch-first loses that race when
// a person still has to open Meet and grant mic.
//
// Reads LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET + SIM_TENANT from env
// (bash wrapper exports them from the repo .env).

import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import { formatSimCallBanner } from './sim-call-format.mjs';

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
const JOIN_FIRST = process.env.SIM_CALL_JOIN_FIRST === '1';

if (!url || !key || !secret) {
  console.error('sim-call: missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  process.exit(2);
}

const httpUrl = url.replace(/^ws/, 'http');
const room = `sim-call-${Date.now()}`;
const identity = `sim-caller-${Date.now()}`;
const rooms = new RoomServiceClient(httpUrl, key, secret);
const dispatch = new AgentDispatchClient(httpUrl, key, secret);

// Hold an empty room long enough for a human to open the URL (join-first) or
// for Meet to connect after a dispatch-first print (dashboard).
await rooms.createRoom({
  name: room,
  emptyTimeout: 300,
  departureTimeout: 20,
  maxParticipants: 4,
  metadata: JSON.stringify({ tenant_id: tenant }),
});

const at = new AccessToken(key, secret, { identity, ttl: '30m' });
at.addGrant({
  roomJoin: true,
  roomCreate: true,
  room,
  canPublish: true,
  canSubscribe: true,
});
const token = await at.toJwt();

const joinUrl = `https://meet.livekit.io/custom?liveKitUrl=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;

// Banner is COMPLETE before any wait — dashboard parser needs room/tenant/agent
// on the first (and only) stdout it sees when this process exits.
console.log(
  formatSimCallBanner({
    joinUrl,
    room,
    tenant,
    agent: AGENT_NAME,
    joinFirst: JOIN_FIRST,
  })
);

async function dispatchAgent() {
  try {
    await dispatch.createDispatch(room, AGENT_NAME, {
      metadata: JSON.stringify({ tenant_id: tenant }),
    });
  } catch (e) {
    console.error('sim-call: dispatch failed:', e?.message ?? e);
    process.exit(1);
  }
}

if (!JOIN_FIRST) {
  await dispatchAgent();
  process.exit(0);
}

console.log('  Waiting up to 3 minutes for you to join...');
console.log('');

const humanDeadline = Date.now() + 180_000;
let human = null;
while (Date.now() < humanDeadline) {
  const participants = await rooms.listParticipants(room).catch(() => []);
  human = participants.find((p) => p.identity === identity) ?? null;
  if (human) break;
  await new Promise((r) => setTimeout(r, 500));
}

if (!human) {
  console.error('  Nobody joined in 3 minutes. Room closed. Ask for a new URL.');
  await rooms.deleteRoom(room).catch(() => {});
  process.exit(1);
}

console.log(`  You joined as ${human.identity}. Dispatching agent...`);
await dispatchAgent();

const agentDeadline = Date.now() + 15_000;
let agentHere = false;
while (Date.now() < agentDeadline) {
  const participants = await rooms.listParticipants(room).catch(() => []);
  if (participants.some((p) => p.identity !== identity)) {
    agentHere = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 400));
}

if (!agentHere) {
  console.error('  Agent did not join the room. Worker may be restarting.');
  process.exit(1);
}

console.log('  Agent is in the room. Talk now.');
console.log('');
