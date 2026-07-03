/**
 * TenantCreateForm + TenantCard — UX-review a11y pass (super-admin surface).
 *
 * Pins the fixes: the create form's owner-credential inputs were placeholder-only
 * (now aria-labelled), and the tenant list row was a click-only <div> (now a
 * keyboard-operable role="button" with an accessible name + aria-pressed).
 *
 * 5W for failures: WHO the platform super-admin (Dale) managing tenants; WHAT the
 * new-business form + the tenant list rows; WHERE TenantCreateForm / TenantCard;
 * WHY unlabeled fields and a mouse-only list row block keyboard/AT operation.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { TenantCreateForm } from './TenantCreateForm';
import { TenantCard } from './TenantCard';

const newBusiness = {
  tenant_name: '',
  business_type: '',
  owner_first_name: '',
  owner_last_name: '',
  owner_email: '',
  owner_pass: '',
};

describe('TenantCreateForm a11y', () => {
  test('owner-credential inputs are reachable by accessible name', () => {
    render(
      <TenantCreateForm newBusiness={newBusiness as never} templates={[]} onChange={vi.fn()} />
    );
    expect(screen.getByLabelText('Owner first name')).toBeInTheDocument();
    expect(screen.getByLabelText('Owner last name')).toBeInTheDocument();
    expect(screen.getByLabelText('Owner email')).toBeInTheDocument();
    expect(screen.getByLabelText('Owner password')).toBeInTheDocument();
  });
});

describe('TenantCard a11y', () => {
  const tenant = { tenant_id: 'abc12345', name: 'Bella Salon', business_type: 'salon' };

  function renderCard(onSelect = vi.fn()) {
    render(
      <TenantCard
        tenant={tenant as never}
        isSelected={false}
        isDragging={false}
        index={0}
        onSelect={onSelect}
        onDragStart={vi.fn()}
        onDragOver={vi.fn()}
        onDragEnd={vi.fn()}
      />
    );
    return onSelect;
  }

  test('is a keyboard-operable button with an accessible name', () => {
    const onSelect = renderCard();
    const card = screen.getByRole('button', { name: /Select Bella Salon/i });
    expect(card).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalled();
  });
});
