import React from 'react';
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmployeeManagementView from './EmployeeManagementView';
import ServiceAssignmentView from './ServiceAssignmentView';

describe('EmployeeManagementView', () => {
  test('renders employee form and list', () => {
    render(<EmployeeManagementView />);
    expect(screen.getByText(/Employee Management/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/Employee Name/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/Skills/i)).toBeDefined();
  });
});

describe('ServiceAssignmentView', () => {
  test('renders service assignment UI', () => {
    render(<ServiceAssignmentView />);
    expect(screen.getByText(/Service Assignment/i)).toBeDefined();
  });
});
