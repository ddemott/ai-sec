import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { jsonContentTypeParser } from '../../src/jsonContentTypeParser';
import { registerCallerSimulatorRoutes } from '../../src/routes/callerSimulator';

function buildApp(startSession = vi.fn()): {
  app: FastifyInstance;
  startSession: ReturnType<typeof vi.fn>;
} {
  const app = Fastify({ logger: false });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, jsonContentTypeParser);
  registerCallerSimulatorRoutes(app as never, startSession as never);
  return { app, startSession };
}

/**
 * WHO: browser caller using the public launcher page
 * WHAT: serve launcher HTML + start a LiveKit-backed caller session safely
 * WHEN: GET /call-simulator and POST /call-simulator/start
 * WHERE: src/routes/callerSimulator.ts
 * WHY: route is public entry point for repeatable browser-based live call testing
 */
describe('caller simulator routes', () => {
  it('serves the browser caller test page', async () => {
    const { app } = buildApp();

    const res = await app.inject({ method: 'GET', url: '/call-simulator' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Start caller session');
    expect(res.body).toContain('Open voice call');
  });

  it('starts a caller session and returns join metadata', async () => {
    const startSession = vi.fn(async () => ({
      join_url:
        'https://meet.livekit.io/custom?liveKitUrl=wss%3A%2F%2Fexample.livekit.cloud&token=abc123',
      livekit_url: 'wss://example.livekit.cloud',
      access_token: 'abc123',
      room: 'sim-call-1750000000000',
      tenant: 'tenant-123',
      agent: 'secretary-hq-agent',
      expires_in_minutes: 30,
    }));
    const { app } = buildApp(startSession);

    const res = await app.inject({
      method: 'POST',
      url: '/call-simulator/start',
      headers: { 'content-type': 'application/json' },
      payload: { tenant_id: 'tenant-123', agent_name: 'secretary-hq-agent' },
    });

    expect(res.statusCode).toBe(200);
    expect(startSession).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      agentName: 'secretary-hq-agent',
    });
    expect(JSON.parse(res.body)).toMatchObject({
      success: true,
      room: 'sim-call-1750000000000',
      tenant: 'tenant-123',
      agent: 'secretary-hq-agent',
    });
  });

  it('rejects non-string overrides with 400', async () => {
    const { app, startSession } = buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/call-simulator/start',
      headers: { 'content-type': 'application/json' },
      payload: { tenant_id: { bad: true } },
    });

    expect(res.statusCode).toBe(400);
    expect(startSession).not.toHaveBeenCalled();
    expect(JSON.parse(res.body)).toEqual({
      success: false,
      error: 'tenant_id must be a string when provided',
    });
  });

  it('treats blank string overrides as omitted', async () => {
    const startSession = vi.fn(async () => ({
      join_url:
        'https://meet.livekit.io/custom?liveKitUrl=wss%3A%2F%2Fexample.livekit.cloud&token=abc123',
      livekit_url: 'wss://example.livekit.cloud',
      access_token: 'abc123',
      room: 'sim-call-1750000000000',
      tenant: 'tenant-123',
      agent: 'secretary-hq-agent',
      expires_in_minutes: 30,
    }));
    const { app } = buildApp(startSession);

    const res = await app.inject({
      method: 'POST',
      url: '/call-simulator/start',
      headers: { 'content-type': 'application/json' },
      payload: { tenant_id: '   ', agent_name: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(startSession).toHaveBeenCalledWith({ tenantId: undefined, agentName: undefined });
  });
});
