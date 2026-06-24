// One-off: inspect LiveKit SIP inbound config + current rooms.
import { SipClient, RoomServiceClient } from 'livekit-server-sdk';

const url = process.env.LIVEKIT_URL;
const key = process.env.LIVEKIT_API_KEY;
const secret = process.env.LIVEKIT_API_SECRET;
if (!url || !key || !secret) {
  console.error('missing LIVEKIT creds');
  process.exit(2);
}
const httpUrl = url.replace(/^ws/, 'http');
const sip = new SipClient(httpUrl, key, secret);
const rooms = new RoomServiceClient(httpUrl, key, secret);

console.log('LIVEKIT_URL=', url);

try {
  const trunks = await sip.listSipInboundTrunk();
  console.log('\n=== INBOUND TRUNKS (', trunks.length, ') ===');
  for (const t of trunks) {
    console.log(JSON.stringify({
      id: t.sipTrunkId, name: t.name, numbers: t.numbers,
      allowedNumbers: t.allowedNumbers, krispEnabled: t.krispEnabled,
    }));
  }
} catch (e) { console.error('inbound trunk err:', e?.message ?? e); }

try {
  const rules = await sip.listSipDispatchRule();
  console.log('\n=== DISPATCH RULES (', rules.length, ') ===');
  for (const r of rules) {
    console.log(JSON.stringify({
      id: r.sipDispatchRuleId, name: r.name, trunkIds: r.trunkIds,
      rule: r.rule, roomConfig: r.roomConfig,
    }, null, 0));
  }
} catch (e) { console.error('dispatch rule err:', e?.message ?? e); }

try {
  const rs = await rooms.listRooms();
  console.log('\n=== CURRENT ROOMS (', rs.length, ') ===');
  for (const r of rs) console.log(r.name, 'participants=', r.numParticipants);
} catch (e) { console.error('listRooms err:', e?.message ?? e); }
