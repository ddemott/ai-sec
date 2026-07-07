'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { Customer } from '@/lib/types';
import { formatPhone } from '../../lib/phone';

interface CustomerListItemProps {
  customer: Customer;
  isSelected: boolean;
  isFocused: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

export function CustomerListItem({
  customer,
  isSelected,
  isFocused,
  onClick,
  onMouseEnter,
}: CustomerListItemProps) {
  return (
    <div
      id={`crm-customer-row-${customer.customer_id}`}
      role="option"
      tabIndex={isFocused ? 0 : -1}
      aria-selected={isSelected}
      ref={(el) => {
        if (el && isFocused && document.activeElement !== el) el.focus();
      }}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`p-4 cursor-pointer transition flex justify-between items-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${isSelected ? 'border-l-4' : ''}`}
      style={{
        borderBottom: '1px solid var(--border-soft)',
        ...(isSelected
          ? { backgroundColor: 'var(--bg-surface)', borderLeftColor: 'var(--accent)' }
          : isFocused
            ? { backgroundColor: 'var(--accent-muted)' }
            : {}),
      }}
    >
      <div>
        <p
          className="text-sm font-semibold"
          style={{ color: isSelected ? 'var(--accent-soft)' : 'var(--text-primary)' }}
        >
          {customer.name || 'Unknown'}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          {formatPhone(customer.phone)}
        </p>
      </div>
      <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
    </div>
  );
}
