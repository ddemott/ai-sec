/**
 * Tool definitions for the LiveKit agent.
 *
 * Public surface is unchanged: `buildTools(ctx, client, …)` still returns the
 * same ToolMap. Definitions now live under `./tools/` grouped by capability
 * (knowledge / messaging / identity / scheduling / verification / transfer / sms).
 * wrapTool.ts is the never-freeze contract applied at the compose boundary.
 */
export type { Capability, ToolMap, TransferCapability } from './tools/types.js';
export { CAPABILITY_OF } from './tools/types.js';
export { buildTools } from './tools/buildTools.js';
export { DEFINED_UNREACHABLE_ON_QUESTION_TREE } from './tools/reachability.js';
