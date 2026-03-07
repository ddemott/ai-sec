/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SettingsView from './components/SettingsView'

// Simple in-memory resources store for mocking
let mockResources: Array<{ id: string; name: string; description?: string | null; is_active?: boolean }> = []

// Build a fetch mock that supports resources GET/CREATE/UPDATE
function buildFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.includes('/resources?tenant_id=')) {
      return {
        ok: true,
        json: async () => mockResources,
      } as any
    }

    if (url.endsWith('/resources/create') && init?.method === 'POST') {
      const body = init.body ? JSON.parse(init.body as string) : {}
      const newRes = {
        id: `res-${mockResources.length + 1}`,
        name: body.name,
        description: body.description ?? null,
        is_active: true,
      }
      mockResources.push(newRes)
      return {
        ok: true,
        json: async () => ({ success: true, resource: newRes }),
      } as any
    }

    if (url.includes('/resources/') && url.endsWith('/update') && init?.method === 'POST') {
      const body = init.body ? JSON.parse(init.body as string) : {}
      const id = url.split('/resources/')[1].split('/')[0]
      mockResources = mockResources.map(r =>
        r.id === id ? { ...r, ...('is_active' in body ? { is_active: body.is_active } : {}) } : r
      )
      return {
        ok: true,
        json: async () => ({ success: true }),
      } as any
    }

    return {
      ok: true,
      json: async () => ({}),
    } as any
  })

  return fetchMock
}

beforeEach(() => {
  mockResources = [
    { id: 'res-1', name: 'Resource 1', description: 'Primary unit', is_active: true },
  ]

  window.localStorage.setItem('tenantId', 'tenant-owner-1')

  const fetchMock = buildFetchMock()
  vi.spyOn(globalThis, 'fetch' as any).mockImplementation(fetchMock as any)
})

test('SettingsView (owner): shows resources list and creation form', async () => {
  render(<SettingsView />)

  // Should render business settings header
  await screen.findByText(/Business Settings/i)
  await screen.findByText(/Resources & Capacity Units/i)

  // Existing resource from mock should appear
  await screen.findByText(/Resource 1/i)
})

test('SettingsView (owner): can add a new resource', async () => {
  render(<SettingsView />)

  // Wait for initial resources to load
  await screen.findByText(/Resource 1/i)

  const [nameInput] = screen.getAllByPlaceholderText(/Resource Name/i)
  const [descInput] = screen.getAllByPlaceholderText(/Optional description/i)
  const [addButton] = screen.getAllByRole('button', { name: /Add Resource/i })

  fireEvent.change(nameInput, { target: { value: 'Resource 2' } })
  fireEvent.change(descInput, { target: { value: 'Secondary unit' } })
  fireEvent.click(addButton)

  await waitFor(() => {
    expect(screen.getByText(/Resource 2/i)).toBeTruthy()
  })
})

test('SettingsView (owner): can toggle resource active state', async () => {
  render(<SettingsView />)

  const [toggleButton] = await screen.findAllByRole('button', { name: /Active/i })
  fireEvent.click(toggleButton)

  await waitFor(() => {
    // After toggle, button text should indicate inactive state
    expect(screen.getByRole('button', { name: /Inactive/i })).toBeTruthy()
  })
})
