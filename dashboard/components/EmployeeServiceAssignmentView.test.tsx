import { describe, test, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import EmployeeManagementView from './EmployeeManagementView';

// Mock fetch
global.fetch = vi.fn();

describe('EmployeeManagementView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a');
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => []
    });
  });

  test('renders employee form and list', async () => {
    render(<EmployeeManagementView />);
    expect(await screen.findByRole('heading', { name: /Employees/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/First name/i)).toBeInTheDocument();
  });
});

import ServiceAssignmentView from './ServiceAssignmentView';

// Mock SessionContext for useActiveTenantId
vi.mock('@/lib/SessionContext', () => ({
  useSessionContext: () => ({
    tenantId: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
    userName: 'Test User',
    isAdmin: false,
    managedTenantId: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
    managedTenantName: 'DynaTire',
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    selectManagedTenant: vi.fn(),
    tenantsVersion: 0,
    notifyTenantsChanged: vi.fn(),
  }),
  useActiveTenantId: () => 'f234e471-0e60-4163-86c9-93cfd9338e3a',
  SessionProvider: ({ children }: any) => children,
}))


describe('ServiceAssignmentView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a');
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => []
    });
  });

  test('renders service assignment UI', async () => {
    render(<ServiceAssignmentView />);
    expect(await screen.findByText(/Service Catalog/i)).toBeInTheDocument();
  });
});
