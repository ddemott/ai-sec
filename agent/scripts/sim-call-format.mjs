// Shared stdout banner for sim-call.mjs.
// Backend `parseSimCallOutput` requires a Meet URL plus room / tenant / agent
// lines. All four MUST appear before the process exits (dashboard waits ≤15s).

/**
 * @param {{ joinUrl: string, room: string, tenant: string, agent: string, joinFirst?: boolean }} args
 */
export function formatSimCallBanner({ joinUrl, room, tenant, agent, joinFirst = false }) {
  const lead = joinFirst
    ? [
        '  Open this URL NOW. Allow mic (and camera if the page asks).',
        '  Agent joins AFTER you appear in the room — no 20s race.',
      ]
    : ['  Agent dispatched. Open this URL, allow the mic, and talk to the agent:'];

  return [
    '',
    ...lead,
    '',
    '  ' + joinUrl,
    '',
    `  room:    ${room}`,
    `  tenant:  ${tenant}`,
    `  agent:   ${agent}`,
    '  (real STT/LLM/TTS/booking — no phone. Token valid 30 min.)',
    '',
  ].join('\n');
}
