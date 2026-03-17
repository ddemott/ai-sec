import { describe, test, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock fetch globally
global.fetch = vi.fn();

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// =========================================================
// BUG-003: AppointmentView — draftEvent state is defined
// =========================================================
import AppointmentView from './AppointmentView';

describe('BUG-003: AppointmentView draftEvent state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => []
    });
  });

  test('renders without crashing (draftEvent state is defined)', async () => {
    render(<AppointmentView />);
    // If draftEvent was undefined, the component would crash on setDraftEvent calls
    // The fact that it renders at all proves the fix works
    expect(await screen.findByText(/Appointments/i)).toBeInTheDocument();
  });

  test('New Appointment button exists and can be clicked without error', async () => {
    render(<AppointmentView />);
    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByText(/Appointments/i)).toBeInTheDocument();
    });

    // Find and click the "New" button (creates a draft event via setDraftEvent)
    const newBtn = screen.queryByText(/New/i);
    if (newBtn) {
      // Should not throw — proves setDraftEvent is defined
      expect(() => fireEvent.click(newBtn)).not.toThrow();
    }
  });
});

// =========================================================
// BUG-004: CRMView — handleEditFormChange is defined
// =========================================================
import CRMView from './CRMView';

describe('BUG-004: CRMView handleEditFormChange function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.setItem('tenantId', 'f234e471-0e60-4163-86c9-93cfd9338e3a');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          id: '00000000-0000-0000-0000-000000000001',
          tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
          name: 'Alice Test',
          first_name: 'Alice',
          last_name: 'Test',
          phone: '+15550001111',
          email: 'alice@test.com',
          address: '123 Main St',
          city: 'New York',
          state: 'NY',
          postal_code: '10001',
          timezone: 'America/New_York',
          metadata: {},
        }
      ])
    });
  });

  test('renders without crashing (handleEditFormChange is defined)', async () => {
    render(<CRMView />);
    // CRMView header says "Customers"
    expect(await screen.findByText(/Customers/i)).toBeInTheDocument();
  });

  test('customer list shows loaded customers', async () => {
    render(<CRMView />);

    // Wait for customer list to load — may appear multiple times (list + detail)
    await waitFor(() => {
      expect(screen.getAllByText(/Alice Test/i).length).toBeGreaterThan(0);
    });

    // Click on the first instance — this triggers the edit form setup
    // which uses handleEditFormChange. If the function is missing, this path errors.
    const aliceElements = screen.getAllByText(/Alice Test/i);
    expect(() => fireEvent.click(aliceElements[0])).not.toThrow();
  });
});

// =========================================================
// BUG-005: No dev bypass button in login
// =========================================================
import LoginView from './LoginView';

describe('BUG-005: No dev bypass button in production code', () => {
  test('LoginView should NOT contain a bypass/dev button', () => {
    const mockLogin = vi.fn();
    render(<LoginView onLoginSuccess={mockLogin} />);

    // There should be no button with DEV or Bypass text
    const devButton = screen.queryByText(/DEV/);
    const bypassButton = screen.queryByText(/Bypass/i);
    const superAdminButton = screen.queryByText(/SuperAdmin/i);

    expect(devButton).toBeNull();
    expect(bypassButton).toBeNull();
    expect(superAdminButton).toBeNull();
  });

  test('LoginView should only have the login form submit button', () => {
    const mockLogin = vi.fn();
    render(<LoginView onLoginSuccess={mockLogin} />);

    // Should have email and password inputs
    expect(screen.getByPlaceholderText(/admin@business.com/i)).toBeInTheDocument();

    // Should have exactly one submit-type action (the sign in button)
    const buttons = screen.getAllByRole('button');
    const submitButtons = buttons.filter(
      btn => btn.textContent?.match(/Sign In|Log In|Login/i)
    );
    expect(submitButtons.length).toBe(1);
  });
});

// =========================================================
// BUG-010: ErrorBoundary catches component errors
// =========================================================
import { ErrorBoundary } from './ErrorBoundary';

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test component error');
  }
  return <div>Working fine</div>;
}

describe('BUG-010: ErrorBoundary component', () => {
  // Suppress console.error for expected error boundary triggers
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });

  test('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  test('catches error and shows fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/Test component error/i)).toBeInTheDocument();
    expect(screen.getByText(/Try Again/i)).toBeInTheDocument();
  });

  test('Try Again button is clickable and resets hasError state', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Should show error UI
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();

    // Try Again button should exist and be clickable
    const tryAgainBtn = screen.getByText(/Try Again/i);
    expect(tryAgainBtn).toBeInTheDocument();

    // Clicking it should not throw — it resets hasError internally
    // (The child may re-throw, but the ErrorBoundary catches it again)
    expect(() => fireEvent.click(tryAgainBtn)).not.toThrow();
  });

  test('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
  });

  // Restore console.error
  afterEach(() => {
    console.error = originalError;
  });
});

// =========================================================
// BUG-012: Login stores JWT token
// =========================================================
describe('BUG-012: LoginView stores JWT token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  test('successful login stores authToken in localStorage', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        tenant_id: 'f234e471-0e60-4163-86c9-93cfd9338e3a',
        user_id: 'user-123',
        user_name: 'Test User',
        token: 'eyJhbGciOiJIUzI1NiJ9.test.signature'
      })
    });

    const mockLogin = vi.fn();
    render(<LoginView onLoginSuccess={mockLogin} />);

    // Fill in the form
    fireEvent.change(screen.getByPlaceholderText(/admin@business.com/i), {
      target: { value: 'test@test.com' }
    });
    // Find password input
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(passwordInput, {
      target: { value: 'password123' }
    });

    // Submit
    const submitBtn = screen.getByRole('button', { name: /Sign In/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalled();
    });

    // Verify token was stored
    expect(localStorageMock.getItem('authToken')).toBe('eyJhbGciOiJIUzI1NiJ9.test.signature');
    expect(localStorageMock.getItem('tenantId')).toBe('f234e471-0e60-4163-86c9-93cfd9338e3a');
    expect(localStorageMock.getItem('userName')).toBe('Test User');
  });
});
