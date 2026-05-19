'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Appointment } from './types';

export interface AppointmentForm {
  customer_id: string;
  resource_id: string;
  employee_id: string;
  description: string;
  start_time: string;
  end_time: string;
  location: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone: string;
  customer_notes: string;
}

const EMPTY_FORM: AppointmentForm = {
  customer_id: '',
  resource_id: '',
  employee_id: '',
  description: '',
  start_time: '',
  end_time: '',
  location: '',
  customer_first_name: '',
  customer_last_name: '',
  customer_phone: '',
  customer_notes: '',
};

interface AppointmentDetailState {
  selectedAppointment: Appointment | null;
  isCreating: boolean;
  isEditing: boolean;
  showDetailOnMobile: boolean;
  saving: boolean;
  error: string;
  form: AppointmentForm;
  showConfirmModal: boolean;

  setSelectedAppointment: (a: Appointment | null) => void;
  setIsCreating: (v: boolean) => void;
  setIsEditing: (v: boolean) => void;
  setShowDetailOnMobile: (v: boolean) => void;
  setSaving: (v: boolean) => void;
  setError: (v: string) => void;
  setForm: (f: AppointmentForm | ((prev: AppointmentForm) => AppointmentForm)) => void;
  setShowConfirmModal: (v: boolean) => void;
  resetForm: () => void;
}

const AppointmentDetailContext = createContext<AppointmentDetailState | null>(null);

export function AppointmentDetailProvider({ children }: { children: React.ReactNode }) {
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<AppointmentForm>(EMPTY_FORM);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const resetForm = useCallback(() => setForm(EMPTY_FORM), []);

  return (
    <AppointmentDetailContext.Provider
      value={{
        selectedAppointment,
        isCreating,
        isEditing,
        showDetailOnMobile,
        saving,
        error,
        form,
        showConfirmModal,
        setSelectedAppointment,
        setIsCreating,
        setIsEditing,
        setShowDetailOnMobile,
        setSaving,
        setError,
        setForm,
        setShowConfirmModal,
        resetForm,
      }}
    >
      {children}
    </AppointmentDetailContext.Provider>
  );
}

export function useAppointmentDetail() {
  const ctx = useContext(AppointmentDetailContext);
  if (!ctx) throw new Error('useAppointmentDetail must be used within AppointmentDetailProvider');
  return ctx;
}
