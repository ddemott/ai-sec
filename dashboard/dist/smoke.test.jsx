import React from 'react';
import { expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Providers } from '../app/providers';

// Mock all context providers so components can render without real API calls
vi.mock('@/lib/ThemeContext', () => ({
    ThemeProvider: ({ children }) => children,
    useTheme: () => ({ theme: 'light', setTheme: vi.fn(), themeInfo: { id: 'light', name: 'Light', isDark: false, preview: {} } }),
    THEMES: [],
}));

vi.mock('@/lib/VocabularyContext', () => ({
    VocabularyProvider: ({ children }) => children,
    useVocabulary: () => ({
        resource_label: 'Resource', resource_plural: 'Resources',
        employee_label: 'Employee', employee_plural: 'Employees',
        booking_label: 'Appointment',
    }),
}));

// Lazy import Home after mocks are set up
test('Dashboard Home Page Smoke Test', async () => {
    const { default: Home } = await import('./app/page');
    render(<Providers><Home /></Providers>);
    // When not logged in, the login portal renders
    expect(screen.getByText(/SecretaryHQ Portal/i)).toBeTruthy();
    expect(screen.getByText(/Sign In to Dashboard/i)).toBeTruthy();
});
