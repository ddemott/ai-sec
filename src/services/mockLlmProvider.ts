import type { LlmProvider } from '../core/providers';

export class MockLlmProvider implements LlmProvider {
  async runSecretaryTurn(input: { tenantId: string; customerPhone: string; message: string }): Promise<{ reply: string }> {
    // Very simple echo-style mock for now.
    return {
      reply: `Thanks for your message. I will book a visit and get back to you shortly. (You said: ${input.message})`,
    };
  }
}
