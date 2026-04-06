import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VapiClient } from './services/vapiClient';

// --- Unit tests for TTS proxy route and VapiClient custom-voice config ---

describe('TTS Proxy', () => {
  describe('VapiClient custom-voice configuration', () => {
    it('uses custom-voice provider when backendUrl and xaiTtsSecret are set', () => {
      const client = new VapiClient(
        'vapi-key',
        'https://edge.example.com/vapi-tools',
        'server-secret',
        'https://backend.example.com',
        'tts-secret',
        'ara'
      );

      const payload = client.buildAssistantPayload({
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test Biz',
        business_type: 'auto-shop',
        voice_id: 'some-voice',
        system_prompt: 'You are a receptionist.',
        first_message: 'Hello!',
        default_resource_id: '00000000-0000-0000-0000-000000000002',
      });

      expect(payload.voice).toEqual({
        provider: 'custom-voice',
        server: {
          url: 'https://backend.example.com/tts/synthesize',
          secret: 'tts-secret',
          timeoutSeconds: 15,
        },
        fallbackPlan: {
          voices: [{ provider: 'vapi', voiceId: 'Elliot' }],
        },
      });
    });

    it('falls back to Vapi built-in voice when backendUrl is missing', () => {
      const client = new VapiClient(
        'vapi-key',
        'https://edge.example.com/vapi-tools',
        'server-secret',
        '',  // no backend URL
        'tts-secret',
        'ara'
      );

      const payload = client.buildAssistantPayload({
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test Biz',
        business_type: 'auto-shop',
        voice_id: 'some-voice',
        system_prompt: 'You are a receptionist.',
        first_message: 'Hello!',
        default_resource_id: '00000000-0000-0000-0000-000000000002',
      });

      expect(payload.voice).toEqual({ provider: 'vapi', voiceId: 'Elliot' });
    });

    it('falls back to Vapi built-in voice when xaiTtsSecret is missing', () => {
      const client = new VapiClient(
        'vapi-key',
        'https://edge.example.com/vapi-tools',
        'server-secret',
        'https://backend.example.com',
        '',  // no TTS secret
        'ara'
      );

      const payload = client.buildAssistantPayload({
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test Biz',
        business_type: 'auto-shop',
        voice_id: 'some-voice',
        system_prompt: 'You are a receptionist.',
        first_message: 'Hello!',
        default_resource_id: '00000000-0000-0000-0000-000000000002',
      });

      expect(payload.voice).toEqual({ provider: 'vapi', voiceId: 'Elliot' });
    });

    it('defaults to Vapi built-in when constructed with no TTS params', () => {
      const client = new VapiClient(
        'vapi-key',
        'https://edge.example.com/vapi-tools',
        'server-secret'
      );

      const payload = client.buildAssistantPayload({
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test Biz',
        business_type: 'auto-shop',
        voice_id: 'some-voice',
        system_prompt: 'You are a receptionist.',
        first_message: 'Hello!',
        default_resource_id: '00000000-0000-0000-0000-000000000002',
      });

      expect(payload.voice).toEqual({ provider: 'vapi', voiceId: 'Elliot' });
    });
  });

  describe('TTS route handler logic', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('rejects requests without valid secret', async () => {
      // Import the route registration function
      const { registerTtsRoutes } = await import('./routes/tts');

      // Create a minimal mock Fastify app
      const handlers: Record<string, Function> = {};
      const mockApp = {
        post: (path: string, handler: Function) => { handlers[path] = handler; },
      };

      registerTtsRoutes(mockApp, 'xai-key', 'correct-secret', 'ara');

      const handler = handlers['/tts/synthesize'];
      expect(handler).toBeDefined();

      const mockReq = {
        headers: { 'x-vapi-secret': 'wrong-secret' },
        url: '/tts/synthesize',
        ip: '127.0.0.1',
        log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() },
        body: { message: { type: 'voice-request', text: 'Hello', sampleRate: 24000 } },
      };

      let statusCode = 0;
      let responseBody: any;
      const mockReply = {
        status: (code: number) => {
          statusCode = code;
          return { send: (body: any) => { responseBody = body; } };
        },
        send: (body: any) => { responseBody = body; },
      };

      await handler(mockReq, mockReply);
      expect(statusCode).toBe(401);
      expect(responseBody.error).toBe('Unauthorized');
    });

    it('rejects invalid payload (missing text)', async () => {
      const { registerTtsRoutes } = await import('./routes/tts');

      const handlers: Record<string, Function> = {};
      const mockApp = {
        post: (path: string, handler: Function) => { handlers[path] = handler; },
      };

      registerTtsRoutes(mockApp, 'xai-key', 'test-secret', 'ara');

      const handler = handlers['/tts/synthesize'];

      const mockReq = {
        headers: { 'x-vapi-secret': 'test-secret' },
        url: '/tts/synthesize',
        ip: '127.0.0.1',
        log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() },
        body: { message: { type: 'wrong-type', text: '', sampleRate: 24000 } },
      };

      let statusCode = 0;
      let responseBody: any;
      const mockReply = {
        status: (code: number) => {
          statusCode = code;
          return { send: (body: any) => { responseBody = body; } };
        },
        send: (body: any) => { responseBody = body; },
      };

      await handler(mockReq, mockReply);
      expect(statusCode).toBe(400);
      expect(responseBody.error).toContain('Invalid payload');
    });

    it('returns 503 when XAI_API_KEY is not configured', async () => {
      const { registerTtsRoutes } = await import('./routes/tts');

      const handlers: Record<string, Function> = {};
      const mockApp = {
        post: (path: string, handler: Function) => { handlers[path] = handler; },
      };

      registerTtsRoutes(mockApp, '', 'test-secret', 'ara');  // empty API key

      const handler = handlers['/tts/synthesize'];

      const mockReq = {
        headers: { 'x-vapi-secret': 'test-secret' },
        url: '/tts/synthesize',
        ip: '127.0.0.1',
        log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() },
        body: { message: { type: 'voice-request', text: 'Hello world', sampleRate: 24000 } },
      };

      let statusCode = 0;
      let responseBody: any;
      const mockReply = {
        status: (code: number) => {
          statusCode = code;
          return { send: (body: any) => { responseBody = body; } };
        },
        send: (body: any) => { responseBody = body; },
      };

      await handler(mockReq, mockReply);
      expect(statusCode).toBe(503);
      expect(responseBody.error).toContain('TTS not configured');
    });

    it('returns 502 when xAI API fetch fails', async () => {
      const { registerTtsRoutes } = await import('./routes/tts');

      const handlers: Record<string, Function> = {};
      const mockApp = {
        post: (path: string, handler: Function) => { handlers[path] = handler; },
      };

      registerTtsRoutes(mockApp, 'xai-key', 'test-secret', 'ara');

      // Mock fetch to throw network error
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const handler = handlers['/tts/synthesize'];

      const mockReq = {
        headers: { 'x-vapi-secret': 'test-secret' },
        url: '/tts/synthesize',
        ip: '127.0.0.1',
        log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() },
        body: { message: { type: 'voice-request', text: 'Hello world', sampleRate: 24000 } },
      };

      let statusCode = 0;
      let responseBody: any;
      const mockReply = {
        status: (code: number) => {
          statusCode = code;
          return { send: (body: any) => { responseBody = body; } };
        },
        send: (body: any) => { responseBody = body; },
      };

      await handler(mockReq, mockReply);
      expect(statusCode).toBe(502);
      expect(responseBody.error).toContain('Connection refused');
    });

    it('returns 502 when xAI API returns non-OK status', async () => {
      const { registerTtsRoutes } = await import('./routes/tts');

      const handlers: Record<string, Function> = {};
      const mockApp = {
        post: (path: string, handler: Function) => { handlers[path] = handler; },
      };

      registerTtsRoutes(mockApp, 'xai-key', 'test-secret', 'ara');

      // Mock fetch to return 429
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });

      const handler = handlers['/tts/synthesize'];

      const mockReq = {
        headers: { 'x-vapi-secret': 'test-secret' },
        url: '/tts/synthesize',
        ip: '127.0.0.1',
        log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() },
        body: { message: { type: 'voice-request', text: 'Hello world', sampleRate: 24000 } },
      };

      let statusCode = 0;
      let responseBody: any;
      const mockReply = {
        status: (code: number) => {
          statusCode = code;
          return { send: (body: any) => { responseBody = body; } };
        },
        send: (body: any) => { responseBody = body; },
      };

      await handler(mockReq, mockReply);
      expect(statusCode).toBe(502);
      expect(responseBody.error).toContain('429');
    });

    it('streams PCM audio on successful xAI response', async () => {
      const { registerTtsRoutes } = await import('./routes/tts');

      const handlers: Record<string, Function> = {};
      const mockApp = {
        post: (path: string, handler: Function) => { handlers[path] = handler; },
      };

      registerTtsRoutes(mockApp, 'xai-key', 'test-secret', 'ara');

      // Mock fetch to return a readable stream
      const audioChunk = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      let readCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: audioChunk };
          }
          return { done: true, value: undefined };
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const handler = handlers['/tts/synthesize'];

      const mockReq = {
        headers: { 'x-vapi-secret': 'test-secret' },
        url: '/tts/synthesize',
        ip: '127.0.0.1',
        log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: vi.fn() },
        body: { message: { type: 'voice-request', text: 'Hello world', sampleRate: 24000 } },
      };

      const chunks: Uint8Array[] = [];
      let headWritten = false;
      let headStatus = 0;
      let headHeaders: Record<string, string> = {};
      const mockReply = {
        raw: {
          writeHead: (status: number, headers: Record<string, string>) => {
            headWritten = true;
            headStatus = status;
            headHeaders = headers;
          },
          write: (chunk: Uint8Array) => { chunks.push(chunk); },
          end: vi.fn(),
        },
        status: (code: number) => ({
          send: () => {},
        }),
        send: () => {},
      };

      await handler(mockReq, mockReply);

      expect(headWritten).toBe(true);
      expect(headStatus).toBe(200);
      expect(headHeaders['Content-Type']).toBe('application/octet-stream');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(audioChunk);
      expect(mockReply.raw.end).toHaveBeenCalled();
    });
  });
});
