import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// TDD guardrail: ensure the Vapi agent template stays valid and complete.
// The legacy agent.json was removed — provisioning now uses agent.template.json
// with Mustache variable substitution via vapiClient.ts.

function loadJson(relativePath: string): Record<string, unknown> {
  const filePath = path.resolve(process.cwd(), relativePath)
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Structural validation for the template (agent.template.json)
// ---------------------------------------------------------------------------

describe('Vapi agent template (agent.template.json) — structural validation', () => {
  const templatePath = 'vapi/agent.template.json'

  it('is valid JSON (parse does not throw)', () => {
    const filePath = path.resolve(process.cwd(), templatePath)
    const raw = fs.readFileSync(filePath, 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('has all required top-level fields', () => {
    const template = loadJson(templatePath)
    const requiredFields = [
      'name',
      'transcriber',
      'model',
      'voice',
      'firstMessage',
      'endCallMessage',
      'serverUrl',
      'serverUrlSecret',
    ]
    for (const field of requiredFields) {
      expect(template, `missing top-level field: ${field}`).toHaveProperty(field)
    }
  })

  it('serverUrl placeholder is the expected template variable', () => {
    const template = loadJson(templatePath)
    const url = template.serverUrl as string
    expect(url).toBe('{{SERVER_URL}}')
  })

  it('voice configuration has provider and voiceId placeholders', () => {
    const template = loadJson(templatePath)
    const voice = template.voice as Record<string, unknown>
    expect(voice).toBeDefined()
    expect(voice).toHaveProperty('provider')
    expect(voice).toHaveProperty('voiceId')
  })

  it('model configuration has provider, model name, messages, and tools', () => {
    const template = loadJson(templatePath)
    const model = template.model as Record<string, unknown>
    expect(model).toBeDefined()
    expect(model).toHaveProperty('provider')
    expect(model).toHaveProperty('model')
    expect(model).toHaveProperty('messages')
    expect(model).toHaveProperty('tools')
    expect(Array.isArray(model.messages)).toBe(true)
    expect(Array.isArray(model.tools)).toBe(true)
    expect((model.messages as unknown[]).length).toBeGreaterThan(0)
  })

  it('contains expected Mustache placeholders', () => {
    const filePath = path.resolve(process.cwd(), templatePath)
    const raw = fs.readFileSync(filePath, 'utf8')
    const expectedPlaceholders = [
      '{{TENANT_NAME}}',
      '{{TENANT_ID}}',
      '{{SERVER_URL}}',
      '{{SERVER_URL_SECRET}}',
      '{{VOICE_PROVIDER}}',
      '{{VOICE_ID}}',
      '{{CURRENT_DATE}}',
    ]
    for (const p of expectedPlaceholders) {
      expect(raw, `missing placeholder: ${p}`).toContain(p)
    }
  })

  it('does not contain hardcoded values that should be placeholders', () => {
    // WHO: provisioning flow | WHAT: template must not have tenant-specific values
    // WHEN: any provisioning | WHERE: agent.template.json
    // WHY: BUG-049 — old agent.json had hardcoded tenant ID and stale date
    const filePath = path.resolve(process.cwd(), templatePath)
    const raw = fs.readFileSync(filePath, 'utf8')
    expect(raw).not.toContain('dynatire-poc-id')
    expect(raw).not.toContain('f234e471-0e60-4163-86c9-93cfd9338e3a')
    expect(raw).not.toContain('Feb 28, 2026')
    expect(raw).not.toContain('truck-1')
  })

  it('model tools array has expected tool names', () => {
    const template = loadJson(templatePath)
    const model = template.model as Record<string, unknown>
    const tools = model.tools as string[]
    expect(tools).toContain('get_customer_context')
    expect(tools).toContain('book_with_scheduling')
    expect(tools).toContain('get_company_policy_answer')
    expect(tools).toContain('get_available_slots')
  })
})
