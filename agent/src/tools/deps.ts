import type { SessionContext } from '../sessionContext.js';
import type { ToolResponse, ToolsClient } from '../toolsClient.js';
import type { CallOutcomeTracker } from '../callOutcome.js';
import type { CallPhase } from '../toolPhases.js';
import type { TransferCapability } from './types.js';

export interface ToolBuildDeps {
  ctx: SessionContext;
  client: ToolsClient;
  transfer?: TransferCapability;
  outcome?: CallOutcomeTracker;
  speakFiller?: (phrase: string) => void;
  hasVerification: boolean;
  canOfferTransfer: boolean;
  transferOrMessage: string;
  gateVerificationAdvice: (res: ToolResponse) => string;
  routeTo: (phase: CallPhase, reply: string) => Promise<string>;
}
