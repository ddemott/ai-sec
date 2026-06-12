// sim-agent-liveness.mjs — prove the LiveKit agent worker is registered + picks
// up work RIGHT NOW. Driven by scripts/simulate.sh `status --deep`.
//
// Method (the one proven in the Beth go-live notes): create an explicit agent
// dispatch into a throwaway room and wait for the agent participant to join.
// A participant appearing in a room we just created = the worker is live (only
// the dispatched agent can be there). Cleans the room up afterward.
//
// Reads LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET + SIM_TENANT from the
// environment (the bash wrapper exports them from the repo .env). Resolves
// livekit-server-sdk from agent/node_modules because this file lives under agent/.
//
// Exit 0 = agent joined (worker live). Exit 1 = timeout/no join. Exit 2 = config.

import { AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';

const url = process.env.LIVEKIT_URL;
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;
// Any real tenant works — the agent only needs it to fetch config; the JOIN is
// the signal. Defaults to the Thinking Hammer (Beth) prod tenant.
const tenant = process.env.SIM_TENANT || 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';
const AGENT_NAME = 'ai-secretary-agent';
const TIMEOUT_MS = 10000;

if (!url || !key || !secret) {
  console.error('sim-agent-liveness: missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  process.exit(2);
}

// Server SDK clients want an http(s) host; LIVEKIT_URL is ws(s).
const httpUrl = url.replace(/^ws/, 'http');
const room = `sim-liveness-${Date.now()}`;

const dispatch = new AgentDispatchClient(httpUrl, key, secret);
const rooms = new RoomServiceClient(httpUrl, key, secret);

let exitCode = 1;
try {
  await dispatch.createDispatch(room, AGENT_NAME, {
    metadata: JSON.stringify({ tenant_id: tenant }),
  });

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const participants = await rooms.listParticipants(room).catch(() => []);
    if (participants.length > 0) {
      exitCode = 0;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
} catch (e) {
  console.error('sim-agent-liveness: dispatch error:', e?.message ?? e);
  exitCode = 1;
} finally {
  await rooms.deleteRoom(room).catch(() => {});
}

process.exit(exitCode);
