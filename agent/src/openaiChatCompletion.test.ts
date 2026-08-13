import { describe, it, expect } from 'vitest';
import { parseChatCompletion } from './openaiChatCompletion.js';

// WHO: callSummary + callClassify, both of which raw-fetch chat.completions.
// WHAT: parseChatCompletion walks an unknown JSON body and returns only a
//       string content + numeric usage — never throws, never leaks `any`.
// WHEN: once per post-call OpenAI response.
// WHERE: agent/src/openaiChatCompletion.ts.
// WHY: the previous `const data: any` was 16 of 18 agent lint warnings, and
//      a malformed body used to read `.choices[0]` through that any.

describe('parseChatCompletion', () => {
  it('reads content + usage from a well-formed body', () => {
    expect(
      parseChatCompletion({
        choices: [{ message: { content: '  booked  ' } }],
        usage: { prompt_tokens: 50, completion_tokens: 8 },
      })
    ).toEqual({
      content: '  booked  ',
      usage: { inputTokens: 50, outputTokens: 8 },
    });
  });

  it('returns null content when choices/message/content are missing', () => {
    expect(parseChatCompletion({})).toEqual({ content: null });
    expect(parseChatCompletion({ choices: [] })).toEqual({ content: null });
    expect(parseChatCompletion({ choices: [{}] })).toEqual({ content: null });
    expect(parseChatCompletion({ choices: [{ message: {} }] })).toEqual({ content: null });
    expect(parseChatCompletion({ choices: [{ message: { content: 12 } }] })).toEqual({
      content: null,
    });
  });

  it('returns null content for non-object bodies', () => {
    expect(parseChatCompletion(null)).toEqual({ content: null });
    expect(parseChatCompletion('nope')).toEqual({ content: null });
    expect(parseChatCompletion(['x'])).toEqual({ content: null });
  });

  it('treats non-numeric usage fields as 0 and omits usage when absent', () => {
    expect(
      parseChatCompletion({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: '50', completion_tokens: NaN },
      })
    ).toEqual({ content: 'ok', usage: { inputTokens: 0, outputTokens: 0 } });
    expect(parseChatCompletion({ choices: [{ message: { content: 'ok' } }] })).toEqual({
      content: 'ok',
    });
  });
});
