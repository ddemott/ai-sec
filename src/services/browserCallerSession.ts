import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SIM_CALL_TIMEOUT_MS = 15_000;
const JOIN_URL_PATTERN = /(https:\/\/meet\.livekit\.io\/custom\?[^\s]+)/;
const FIELD_PATTERNS = {
  room: /^\s*room:\s+(.+)$/m,
  tenant: /^\s*tenant:\s+(.+)$/m,
  agent: /^\s*agent:\s+(.+)$/m,
} as const;

export interface BrowserCallerSession {
  join_url: string;
  livekit_url: string;
  access_token: string;
  room: string;
  tenant: string;
  agent: string;
  expires_in_minutes: number;
  e2e_stub?: boolean;
}

export type BrowserCallerSessionRunner = (
  scriptPath: string,
  env: NodeJS.ProcessEnv
) => Promise<{ stdout: string; stderr: string }>;

function resolveSimCallScriptPath(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'agent', 'scripts', 'sim-call.mjs'),
    path.resolve(__dirname, '..', '..', '..', 'agent', 'scripts', 'sim-call.mjs'),
  ];
  const found = candidates.find((scriptPath) => fs.existsSync(scriptPath));
  if (!found) {
    throw new Error('sim-call.mjs not found in expected agent/scripts directories');
  }
  return found;
}

function parseField(output: string, pattern: RegExp, fieldName: string): string {
  const match = output.match(pattern);
  const value = match?.[1]?.trim();
  if (!value) {
    throw new Error(`sim-call output missing ${fieldName}`);
  }
  return value;
}

export function parseSimCallOutput(output: string): BrowserCallerSession {
  const joinUrl = output.match(JOIN_URL_PATTERN)?.[1]?.trim();
  if (!joinUrl) {
    throw new Error('sim-call output missing join URL');
  }

  const parsedJoinUrl = new URL(joinUrl);
  const livekitUrl = parsedJoinUrl.searchParams.get('liveKitUrl')?.trim();
  const accessToken = parsedJoinUrl.searchParams.get('token')?.trim();
  if (!livekitUrl) {
    throw new Error('sim-call output missing liveKitUrl');
  }
  if (!accessToken) {
    throw new Error('sim-call output missing token');
  }

  return {
    join_url: joinUrl,
    livekit_url: livekitUrl,
    access_token: accessToken,
    room: parseField(output, FIELD_PATTERNS.room, 'room'),
    tenant: parseField(output, FIELD_PATTERNS.tenant, 'tenant'),
    agent: parseField(output, FIELD_PATTERNS.agent, 'agent'),
    expires_in_minutes: 30,
  };
}

async function defaultRunner(
  scriptPath: string,
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [scriptPath], {
    env,
    maxBuffer: 1024 * 1024,
    timeout: SIM_CALL_TIMEOUT_MS,
  });
}

export async function startBrowserCallerSession(
  args: { tenantId?: string; agentName?: string },
  runner: BrowserCallerSessionRunner = defaultRunner
): Promise<BrowserCallerSession> {
  if (process.env.BROWSER_CALLER_E2E_STUB === '1') {
    const tenant = args.tenantId || 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';
    const agent = args.agentName || 'secretary-hq-agent';
    const room = `sim-call-e2e-${Date.now()}`;
    return {
      join_url: `https://example.invalid/call-simulator-stub?room=${encodeURIComponent(room)}`,
      livekit_url: 'wss://example.invalid/livekit-stub',
      access_token: 'e2e-stub-token',
      room,
      tenant,
      agent,
      expires_in_minutes: 30,
      e2e_stub: true,
    };
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (args.tenantId) env.SIM_TENANT = args.tenantId;
  // Blank means "use the real worker default" so production launcher calls hit
  // the worker name the script and Railway service already agree on.
  // Local branch testing must opt in explicitly via ?agent=secretary-hq-agent-dev
  // (or by typing that value into the field) so there is no silent prod routing.
  env.AGENT_NAME = args.agentName || 'secretary-hq-agent';

  const { stdout } = await runner(resolveSimCallScriptPath(), env);
  return parseSimCallOutput(stdout);
}
