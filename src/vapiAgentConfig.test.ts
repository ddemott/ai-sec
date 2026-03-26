import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// TDD guardrail: ensure the checked-in Vapi base agent configuration
// stays aligned with the deployment TODO (Server URL + secret).

function loadJson(relativePath: string): Record<string, unknown> {
  const filePath = path.resolve(process.cwd(), relativePath)
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

describe('Vapi base agent configuration', () => {
  it('uses the deployed Supabase function URL and shared secret', () => {
    const agent = loadJson('vapi/agent.json') as {
      serverUrl?: string
      serverUrlSecret?: string
    }

    expect(agent.serverUrl).toBe(
      'https://sgibijfchvfuizudrmir.functions.supabase.co/vapi-tools',
    )

    expect(agent.serverUrlSecret).toBe('734987fcfcchsd82')
  })
})

// ---------------------------------------------------------------------------
// Sad-path tests: structural validation for deployed config (agent.json)
// ---------------------------------------------------------------------------

describe('Vapi deployed agent (agent.json) — structural validation', () => {
  const agentPath = 'vapi/agent.json'

  it('is valid JSON (parse does not throw)', () => {
    const filePath = path.resolve(process.cwd(), agentPath)
    const raw = fs.readFileSync(filePath, 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('has all required top-level fields', () => {
    const agent = loadJson(agentPath)
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
      expect(agent, `missing top-level field: ${field}`).toHaveProperty(field)
    }
  })

  it('serverUrl is a valid HTTPS URL', () => {
    const agent = loadJson(agentPath)
    const url = agent.serverUrl as string
    expect(url).toBeTruthy()
    expect(url).toMatch(/^https:\/\//)
    expect(url).not.toMatch(/^http:\/\//)
  })

  it('serverUrl contains the expected /vapi-tools path segment', () => {
    const agent = loadJson(agentPath)
    const url = agent.serverUrl as string
    expect(url).toContain('/vapi-tools')
  })

  it('voice configuration exists and has expected structure', () => {
    const agent = loadJson(agentPath)
    const voice = agent.voice as Record<string, unknown> | undefined
    expect(voice).toBeDefined()
    expect(voice).toHaveProperty('provider')
    expect(voice).toHaveProperty('voiceId')
    expect(typeof voice!.provider).toBe('string')
    expect((voice!.provider as string).length).toBeGreaterThan(0)
    expect(typeof voice!.voiceId).toBe('string')
    expect((voice!.voiceId as string).length).toBeGreaterThan(0)
  })

  it('model configuration exists and has expected structure', () => {
    const agent = loadJson(agentPath)
    const model = agent.model as Record<string, unknown> | undefined
    expect(model).toBeDefined()
    expect(model).toHaveProperty('provider')
    expect(model).toHaveProperty('model')
    expect(model).toHaveProperty('messages')
    expect(typeof model!.provider).toBe('string')
    expect((model!.provider as string).length).toBeGreaterThan(0)
    expect(Array.isArray(model!.messages)).toBe(true)
    expect((model!.messages as unknown[]).length).toBeGreaterThan(0)
  })

  it('does not contain placeholder/TODO strings that should have been replaced', () => {
    const filePath = path.resolve(process.cwd(), agentPath)
    const raw = fs.readFileSync(filePath, 'utf8')
    expect(raw).not.toMatch(/\{\{[A-Z_]+\}\}/)
    expect(raw).not.toMatch(/TODO/i)
    expect(raw).not.toMatch(/FIXME/i)
    expect(raw).not.toMatch(/PLACEHOLDER/i)
  })

  it('model tools array entries are valid strings (deployed config)', () => {
    const agent = loadJson(agentPath)
    const model = agent.model as Record<string, unknown>
    const tools = model.tools as unknown[]
    expect(Array.isArray(tools)).toBe(true)
    // Deployed config may have an empty tools array; if populated, each must be a non-empty string
    for (const tool of tools) {
      expect(typeof tool).toBe('string')
      expect((tool as string).length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Sad-path tests: structural validation for the template (agent.template.json)
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
    expect((model.messages as unknown[]).length).toBeGreaterThan(0)
  })

  it('template tool references are non-empty strings', () => {
    const template = loadJson(templatePath)
    const model = template.model as Record<string, unknown>
    const tools = model.tools as unknown[]
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      expect(typeof tool).toBe('string')
      expect((tool as string).length).toBeGreaterThan(0)
    }
  })

  it('template contains expected placeholder variables (not hard-coded values)', () => {
    const filePath = path.resolve(process.cwd(), templatePath)
    const raw = fs.readFileSync(filePath, 'utf8')
    // The template SHOULD have mustache-style placeholders
    expect(raw).toContain('{{TENANT_NAME}}')
    expect(raw).toContain('{{SERVER_URL}}')
    expect(raw).toContain('{{SERVER_URL_SECRET}}')
    expect(raw).toContain('{{VOICE_PROVIDER}}')
    expect(raw).toContain('{{VOICE_ID}}')
    expect(raw).toContain('{{TENANT_ID}}')
    expect(raw).toContain('{{RESOURCE_ID}}')
  })

  it('system message in template does not contain TODO or FIXME', () => {
    const template = loadJson(templatePath)
    const model = template.model as Record<string, unknown>
    const messages = model.messages as Array<{ role: string; content: string }>
    const systemMsg = messages.find((m) => m.role === 'system')
    expect(systemMsg).toBeDefined()
    expect(systemMsg!.content).not.toMatch(/TODO/i)
    expect(systemMsg!.content).not.toMatch(/FIXME/i)
  })

  it('firstMessage and endCallMessage use tenant name placeholder', () => {
    const template = loadJson(templatePath)
    const firstMsg = template.firstMessage as string
    const endMsg = template.endCallMessage as string
    expect(firstMsg).toContain('{{TENANT_NAME}}')
    expect(endMsg).toContain('{{TENANT_NAME}}')
  })
})
