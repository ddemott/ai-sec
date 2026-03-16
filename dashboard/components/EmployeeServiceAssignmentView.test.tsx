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
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => []
    });
  });

  test('renders employee form and list', async () => {
    render(<EmployeeManagementView />);
    expect(await screen.findByText(/Staff & Services/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Enter full name/i)).toBeInTheDocument();
  });
});

import ServiceAssignmentView from './ServiceAssignmentView';

describe('ServiceAssignmentView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => []
    });
  });

  test('renders service assignment UI', async () => {
    render(<ServiceAssignmentView />);
    expect(await screen.findByText(/Service Catalog/i)).toBeInTheDocument();
  });
});
