import fs from 'node:fs';
import path from 'node:path';
import type { AppFastifyInstance } from '../types/fastify';
import { withHandler } from '../middleware';
import {
  startBrowserCallerSession,
  type BrowserCallerSession,
} from '../services/browserCallerSession';

let callerSimulatorHtmlCache: string | null = null;

function resolvePublicDir(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'public'),
    path.resolve(__dirname, '..', '..', '..', 'public'),
  ];
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'caller-simulator.html')));
  if (!found) {
    throw new Error('caller-simulator.html not found in expected public directories');
  }
  return found;
}

function getCallerSimulatorHtml(): string {
  if (callerSimulatorHtmlCache === null) {
    callerSimulatorHtmlCache = fs.readFileSync(
      path.join(resolvePublicDir(), 'caller-simulator.html'),
      'utf-8'
    );
  }
  return callerSimulatorHtmlCache;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function registerCallerSimulatorRoutes(
  app: AppFastifyInstance,
  startSession: (args: {
    tenantId?: string;
    agentName?: string;
  }) => Promise<BrowserCallerSession> = startBrowserCallerSession
): void {
  app.get('/call-simulator', async (_req, reply) => {
    return reply.type('text/html').send(getCallerSimulatorHtml());
  });

  app.post(
    '/call-simulator/start',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    withHandler(async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const tenantId = readOptionalString(body.tenant_id);
      const agentName = readOptionalString(body.agent_name);

      if (
        'tenant_id' in body &&
        body.tenant_id !== undefined &&
        typeof body.tenant_id !== 'string'
      ) {
        return reply
          .status(400)
          .send({ success: false, error: 'tenant_id must be a string when provided' });
      }
      if (
        'agent_name' in body &&
        body.agent_name !== undefined &&
        typeof body.agent_name !== 'string'
      ) {
        return reply
          .status(400)
          .send({ success: false, error: 'agent_name must be a string when provided' });
      }

      const session = await startSession({ tenantId, agentName });
      return reply.send({ success: true, ...session });
    }, 'Failed to start browser caller session')
  );
}
