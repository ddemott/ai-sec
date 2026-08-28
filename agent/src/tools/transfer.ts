import { llm } from '@livekit/agents';
import type { ToolMap } from './types.js';
import type { ToolBuildDeps } from './deps.js';
export function transferTools(d: ToolBuildDeps): ToolMap {
  const { transfer, outcome } = d;
  return {
    transfer_call: llm.tool({
      description:
        'Transfer the live call to a real person (the business owner / staff cell). Use ONLY when the caller clearly needs a human — a personal call for the owner, an urgent issue you cannot handle, or an explicit request to be connected to someone. Before calling this, tell the caller you are connecting them (e.g. "One moment, connecting you now."). On success the call leaves this assistant; on failure or when transfer is unavailable, apologize briefly and offer to take a message.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        // No transfer wiring on this call (missing LiveKit creds or the SIP
        // participant never joined) — tell the LLM to fall back to a message.
        if (!transfer?.execute) {
          return JSON.stringify({
            error: 'Transfer is not available right now. Offer to take a message instead.',
          });
        }
        const result = await transfer.execute(transfer.forwardPhone);
        if (result.ok) {
          outcome?.recordTransfer();
          return 'Transfer started — the caller is being connected to a team member now. Do not keep talking; the call is leaving this assistant.';
        }
        if (result.reason === 'not_configured') {
          return JSON.stringify({
            error:
              'No transfer number is set up for this business, so you cannot connect the caller. Offer to take a message instead.',
          });
        }
        return JSON.stringify({
          error:
            'The transfer did not go through. Apologize briefly and offer to take a message instead.',
        });
      },
    }),
  };
}
