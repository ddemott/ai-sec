import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// TDD guardrail: ensure the checked-in Vapi base agent configuration
// stays aligned with the deployment TODO (Server URL + secret).

describe('Vapi base agent configuration', () => {
  it('uses the deployed Supabase function URL and shared secret', () => {
    const agentPath = path.resolve(process.cwd(), 'vapi/agent.json')
    const raw = fs.readFileSync(agentPath, 'utf8')
    const agent = JSON.parse(raw) as {
      serverUrl?: string
      serverUrlSecret?: string
    }

    expect(agent.serverUrl).toBe(
      'https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools',
    )

    expect(agent.serverUrlSecret).toBe('734987fcfcchsd82')
  })
})
