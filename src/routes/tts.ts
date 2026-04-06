import { Readable } from 'node:stream';
import { logEvent, logError, type AppRequest } from '../middleware';

const XAI_TTS_URL = 'https://api.x.ai/v1/tts';
const FETCH_TIMEOUT_MS = 15_000;

interface VapiVoiceRequest {
  message: {
    type: 'voice-request';
    text: string;
    sampleRate: number;
    timestamp?: number;
  };
}

export function registerTtsRoutes(
  app: any,
  xaiApiKey: string,
  xaiTtsSecret: string,
  xaiTtsVoice: string
) {
  app.post('/tts/synthesize', async (req: AppRequest, reply: any) => {
    // Auth: Vapi sends the secret from the custom-voice server config
    const authHeader = req.headers['x-vapi-secret'] as string | undefined;
    if (!xaiTtsSecret || authHeader !== xaiTtsSecret) {
      req.log.warn({ url: req.url, ip: req.ip }, 'TTS proxy auth failed — invalid or missing secret');
      return reply.status(401).send({ success: false, error: 'Unauthorized' });
    }

    if (!xaiApiKey) {
      return reply.status(503).send({ success: false, error: 'TTS not configured (missing XAI_API_KEY)' });
    }

    // Parse Vapi voice-request payload
    const body = req.body as VapiVoiceRequest;
    if (!body?.message?.text || body.message.type !== 'voice-request') {
      return reply.status(400).send({
        success: false,
        error: 'Invalid payload — expected Vapi voice-request',
      });
    }

    const { text, sampleRate } = body.message;
    const validSampleRates = [8000, 16000, 22050, 24000];
    const targetSampleRate = validSampleRates.includes(sampleRate) ? sampleRate : 24000;

    let xaiRes: Response;
    try {
      xaiRes = await fetch(XAI_TTS_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${xaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice_id: xaiTtsVoice,
          output_format: {
            codec: 'pcm',
            sample_rate: targetSampleRate,
          },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(req, 'tts_xai_fetch_failed', err, { text_length: text.length });
      return reply.status(502).send({
        success: false,
        error: `TTS upstream failed: ${msg}`,
      });
    }

    if (!xaiRes.ok) {
      const errText = await xaiRes.text().catch(() => 'unknown');
      logError(req, 'tts_xai_error', new Error(errText), {
        status: xaiRes.status,
        text_length: text.length,
      });
      return reply.status(502).send({
        success: false,
        error: `TTS upstream error (${xaiRes.status}): ${errText}`,
      });
    }

    if (!xaiRes.body) {
      return reply.status(502).send({
        success: false,
        error: 'TTS upstream returned empty body',
      });
    }

    logEvent(req, 'tts_synthesized', {
      voice: xaiTtsVoice,
      sample_rate: targetSampleRate,
      text_length: text.length,
    });

    // Stream PCM audio back to Vapi — no buffering
    reply.raw.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Transfer-Encoding': 'chunked',
    });

    const reader = xaiRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(value);
      }
    } catch (streamErr: unknown) {
      logError(req, 'tts_stream_error', streamErr, { text_length: text.length });
    } finally {
      reply.raw.end();
    }
  });
}
