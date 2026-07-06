'use client';

import React from 'react';
import { Phone, Edit2, Save, X, Trash2, ChevronLeft } from 'lucide-react';
import { Button } from '../ui/Button';
import { formatPhone } from '../../lib/phone';
import type { Customer } from '@/lib/types';

interface EditForm {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  timezone: string;
  notes: string;
}

interface CustomerDetailHeaderProps {
  selectedCustomer: Customer | null;
  isCreating: boolean;
  isEditing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onCreate: () => void;
  onDelete: () => void;
  onCloseMobile: () => void;
}

export function CustomerDetailHeader({
  selectedCustomer,
  isCreating,
  isEditing,
  saving,
  onEdit,
  onCancelEdit,
  onSave,
  onCreate,
  onDelete,
  onCloseMobile,
}: CustomerDetailHeaderProps) {
  return (
    <header
      className="p-4 md:p-8 flex items-center justify-between"
      style={{
        borderBottom: '1px solid var(--border-soft)',
        backgroundColor: 'var(--bg-raised)',
      }}
    >
      <div className="flex items-center">
        <button
          onClick={onCloseMobile}
          aria-label="Back to customer list"
          className="md:hidden p-2 -ml-2 mr-2"
          style={{ color: 'var(--accent-soft)' }}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center space-x-4">
          <div
            className="w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center text-xl md:text-2xl font-bold"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--primary-text)' }}
          >
            {isCreating ? '+' : selectedCustomer?.name?.charAt(0) || '?'}
          </div>
          <div>
            <h1 className="text-xl md:text-3xl font-display">
              {isCreating ? 'New Customer' : selectedCustomer?.name || 'Unknown'}
            </h1>
            {!isCreating && (
              <p
                className="text-sm md:text-base flex items-center"
                style={{ color: 'var(--text-secondary)' }}
              >
                <Phone className="w-4 h-4 mr-2" /> {formatPhone(selectedCustomer?.phone)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        {!isEditing && !isCreating ? (
          <>
            <Button variant="danger" size="sm" onClick={onDelete} title="Delete Customer">
              <Trash2 className="w-5 h-5" />
            </Button>
            <Button variant="secondary" onClick={onEdit}>
              <Edit2 className="w-4 h-4 mr-2" /> Edit Info
            </Button>
          </>
        ) : (
          <div className="flex space-x-2">
            <Button variant="ghost" onClick={onCancelEdit} aria-label="Cancel editing">
              <X className="w-5 h-5" />
            </Button>
            <Button onClick={isCreating ? onCreate : onSave} isLoading={saving}>
              {!saving && <Save className="w-4 h-4 mr-2" />}
              {isCreating ? 'Create Customer' : 'Save Changes'}
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}

// Re-export the EditForm type so sub-components can share it
export type { EditForm };
