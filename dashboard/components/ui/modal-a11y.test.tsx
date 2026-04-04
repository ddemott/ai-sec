/**
 * Tests for Fix #24 + #25: Modal focus trap and form label associations
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { Modal } from './Modal';
import { Input } from './Input';
import { Select } from './Select';

describe('Fix #24: Modal focus trap', () => {
  test('HAPPY: modal has role="dialog" and aria-modal="true"', () => {
    // WHO: Screen reader users
    // WHAT: Modal should announce as a dialog
    // WHY: WCAG requires proper ARIA roles on modal dialogs
    render(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal">
        <p>Content</p>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  test('HAPPY: modal title is linked via aria-labelledby', () => {
    // WHO: Screen reader users
    // WHAT: Dialog should reference its title
    // WHY: Users need to know what the dialog is about
    render(
      <Modal isOpen={true} onClose={() => {}} title="Confirm Delete">
        <p>Are you sure?</p>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
    expect(screen.getByText('Confirm Delete')).toHaveAttribute('id', 'modal-title');
  });

  test('HAPPY: close button has aria-label', () => {
    // WHO: Screen reader users
    // WHAT: Close button should have accessible label
    // WHY: Icon-only buttons need text alternatives
    render(
      <Modal isOpen={true} onClose={() => {}} title="Test">
        <p>Content</p>
      </Modal>
    );

    expect(screen.getByLabelText('Close dialog')).toBeInTheDocument();
  });

  test('HAPPY: Escape key closes modal', () => {
    // WHO: Keyboard users
    // WHAT: Pressing Escape should close the modal
    // WHY: Standard modal behavior per WCAG
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test">
        <p>Content</p>
      </Modal>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('SAD: modal does not render when isOpen=false', () => {
    // WHO: Any user
    // WHAT: Closed modal should not be in the DOM
    // WHY: Hidden modals should not trap focus or be announced
    render(
      <Modal isOpen={false} onClose={() => {}} title="Hidden">
        <p>Should not appear</p>
      </Modal>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('HAPPY: modal content panel stops click propagation', () => {
    // WHO: User clicking inside modal content
    // WHAT: Click should not trigger backdrop close
    // WHY: Only clicking the backdrop (outside) should close
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test">
        <button>Inner Button</button>
      </Modal>
    );

    fireEvent.click(screen.getByText('Inner Button'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('SAD: disableBackdropClose prevents backdrop click from closing', () => {
    // WHO: User in a form modal with disableBackdropClose
    // WHAT: Clicking backdrop should NOT close
    // WHY: Prevents accidental data loss on form modals
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Form" disableBackdropClose>
        <input type="text" />
      </Modal>
    );

    // Click the backdrop (the outer div with role="dialog")
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Fix #25: Form label associations', () => {
  test('HAPPY: Input auto-generates id and links label via htmlFor', () => {
    // WHO: Screen reader users
    // WHAT: Label should be linked to input via htmlFor/id
    // WHY: WCAG requires programmatic label association
    render(<Input label="Email Address" type="email" />);

    const input = screen.getByLabelText('Email Address');
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('id');
  });

  test('HAPPY: Input uses provided id instead of auto-generating', () => {
    // WHO: Developer passing explicit id
    // WHAT: Should use the provided id, not auto-generate
    // WHY: Custom ids needed for aria-describedby or test selectors
    render(<Input label="Name" id="custom-name-id" />);

    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('id', 'custom-name-id');
  });

  test('HAPPY: Input without label does not generate unnecessary id', () => {
    // WHO: Inputs used without visible labels (e.g. search bars)
    // WHAT: Should not auto-generate id when there's no label
    // WHY: Unnecessary ids add DOM noise
    const { container } = render(<Input placeholder="Search..." />);

    const input = container.querySelector('input');
    expect(input).not.toHaveAttribute('id');
  });

  test('HAPPY: Select auto-generates id and links label via htmlFor', () => {
    // WHO: Screen reader users
    // WHAT: Label should be linked to select via htmlFor/id
    // WHY: Same WCAG requirement as Input
    render(
      <Select
        label="Choose Color"
        options={[
          { label: 'Red', value: 'red' },
          { label: 'Blue', value: 'blue' },
        ]}
      />
    );

    const select = screen.getByLabelText('Choose Color');
    expect(select).toBeInTheDocument();
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAttribute('id');
  });

  test('HAPPY: Input shows error with aria-invalid and aria-describedby', () => {
    // WHO: Users with form validation errors
    // WHAT: Error state should be announced by screen readers
    // WHY: WCAG requires error identification
    render(<Input label="Email" id="email-field" error="Invalid email" />);

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'email-field-error');

    const errorMsg = screen.getByRole('alert');
    expect(errorMsg).toHaveTextContent('Invalid email');
  });

  test('SAD: Input without error has no aria-invalid', () => {
    // WHO: Users with valid form state
    // WHAT: Should not have aria-invalid when there's no error
    // WHY: False positives confuse screen reader users
    render(<Input label="Name" />);

    const input = screen.getByLabelText('Name');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  test('HAPPY: Select shows error with aria-invalid and aria-describedby', () => {
    // WHO: Users with validation error on a select field
    // WHAT: Select should announce error state to screen readers
    // WHY: Same WCAG requirement as Input — error identification
    render(
      <Select
        label="State"
        id="state-field"
        error="State is required"
        options={[{ label: 'NY', value: 'NY' }, { label: 'CA', value: 'CA' }]}
      />
    );

    const select = screen.getByLabelText('State');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-describedby', 'state-field-error');

    const errorMsg = screen.getByRole('alert');
    expect(errorMsg).toHaveTextContent('State is required');
  });

  test('SAD: Select without error has no aria-invalid', () => {
    // WHO: Users with valid select state
    // WHAT: Should not have aria-invalid when there's no error
    // WHY: Consistent with Input behavior
    render(
      <Select
        label="Color"
        options={[{ label: 'Red', value: 'red' }]}
      />
    );

    const select = screen.getByLabelText('Color');
    expect(select).not.toHaveAttribute('aria-invalid');
  });
});
