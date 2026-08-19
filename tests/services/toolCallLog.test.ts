import { describe, expect, it } from 'vitest';

import { summarizeToolResult } from '../../agent/src/toolCallLog';

describe('toolCallLog summarizeToolResult', () => {
  it('preserves submission_id for intake submission joins', () => {
    const result = summarizeToolResult(
      JSON.stringify({ success: true, submission_id: 'sub_123', duplicate: false })
    );

    expect(result).toContain('success=true');
    expect(result).toContain('submission_id=sub_123');
  });
});