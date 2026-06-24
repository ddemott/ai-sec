// Live-watch LiveKit rooms. Emits a line whenever a room appears, gains/loses a
// participant, or disappears — so a real inbound PSTN call shows up the instant
// Telnyx forwards it (a `call-*` room + the agent joining = calls come through).
import { RoomServiceClient } from 'livekit-server-sdk';

const url = process.env.LIVEKIT_URL;
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;
if (!url || !key || !secret) { console.error('missing LIVEKIT creds'); process.exit(2); }
const rooms = new RoomServiceClient(url.replace(/^ws/, 'http'), key, secret);

const seen = new Map(); // name -> participant count
console.log(`[watch] armed on ${url} — place the call now`);
for (;;) {
  let list = [];
  try { list = await rooms.listRooms(); } catch (e) { console.log('[watch] listRooms error:', e?.message ?? e); await sleep(2000); continue; }
  const now = new Map(list.map((r) => [r.name, r.numParticipants]));
  for (const [name, n] of now) {
    if (!seen.has(name)) {
      let parts = [];
      try { parts = await rooms.listParticipants(name); } catch {}
      const ids = parts.map((p) => p.identity).join(', ') || '(none yet)';
      console.log(`[ROOM UP] ${name} participants=${n} [${ids}]`);
    } else if (seen.get(name) !== n) {
      console.log(`[ROOM Δ] ${name} participants ${seen.get(name)} -> ${n}`);
    }
  }
  for (const name of seen.keys()) if (!now.has(name)) console.log(`[ROOM DOWN] ${name}`);
  seen.clear();
  for (const [k, v] of now) seen.set(k, v);
  await sleep(1500);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
