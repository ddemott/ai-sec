/**
 * Narrow the OpenAI chat.completions JSON body. callSummary + callClassify
 * both hit the same endpoint with raw fetch (no SDK), so the response is
 * unknown until we walk it. A typed parse here is what keeps those two
 * files off `any` — the previous `const data: any` is what produced 16 of
 * the 18 agent lint warnings.
 */

export type ChatCompletionUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ParsedChatCompletion = {
  content: string | null;
  usage?: ChatCompletionUsage;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function parseChatCompletion(data: unknown): ParsedChatCompletion {
  if (!isRecord(data)) return { content: null };

  let content: string | null = null;
  const choices = data.choices;
  if (Array.isArray(choices) && choices.length > 0 && isRecord(choices[0])) {
    const message = choices[0].message;
    if (isRecord(message) && typeof message.content === 'string') {
      content = message.content;
    }
  }

  let usage: ChatCompletionUsage | undefined;
  if (isRecord(data.usage)) {
    usage = {
      inputTokens: asTokenCount(data.usage.prompt_tokens),
      outputTokens: asTokenCount(data.usage.completion_tokens),
    };
  }

  return { content, usage };
}
