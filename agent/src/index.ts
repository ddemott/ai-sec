import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
} from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';

export default defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    await ctx.connect();

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new deepgram.STT({ apiKey: config.DEEPGRAM_API_KEY, model: 'nova-3' }),
      llm: new openai.LLM({ apiKey: config.OPENAI_API_KEY, model: 'gpt-4o-mini' }),
      tts: new openai.TTS({ apiKey: config.OPENAI_API_KEY }),
    });

    const agent = new voice.Agent({
      instructions:
        'You are Clara, a friendly AI receptionist for a service business. ' +
        'Keep responses concise and conversational. This is a phone call, ' +
        'so do not use markdown, bullet points, or formatting.',
    });

    await session.start({ agent, room: ctx.room });
    session.say('Thanks for calling. How can I help you today?', { allowInterruptions: true });
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
