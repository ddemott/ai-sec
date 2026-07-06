import { useState, useCallback } from 'react';
import { Api } from './api';
import { showToast } from '../components/ui/Toast';
import { useConfirm } from './useConfirm';
import type { SchedulerAppointment } from '../components/scheduler/useSchedulerData';

interface UseSchedulerActionsOptions {
  tenantId: string | null;
  appointments: SchedulerAppointment[];
  selectedDate: Date;
  refreshScheduler: () => Promise<void> | void;
  refreshStaticData: () => Promise<void> | void;
  onPopoverClose?: () => void;
}

export function useSchedulerActions({
  tenantId,
  appointments,
  selectedDate,
  refreshScheduler,
  refreshStaticData,
  onPopoverClose,
}: UseSchedulerActionsOptions) {
  const { state: confirmState, confirm: confirmAction, close: closeConfirm } = useConfirm();

  const [quickBookOpen, setQuickBookOpen] = useState(false);
  const [quickBookPrefill, setQuickBookPrefill] = useState<{
    employeeId?: string;
    resourceId?: string;
    hour?: number;
    endHour?: number;
    date?: Date;
  }>({});

  const [pendingEditAppointmentId, setPendingEditAppointmentId] = useState<string | null>(null);

  const undoCancel = useCallback(
    async (appointmentId: string) => {
      if (!tenantId) return;
      try {
        const res = await Api.appointments.reactivate(appointmentId, tenantId);
        if (res.success) {
          showToast('Appointment restored', 'success');
          void refreshScheduler();
          void refreshStaticData();
        } else if (res.error_code === 'TIMESLOT_OCCUPIED') {
          showToast(
            'That time slot is no longer available. Book a new appointment instead.',
            'error'
          );
        } else {
          showToast(res.error || 'Could not restore appointment', 'error');
        }
      } catch {
        showToast('Connection error — could not restore appointment', 'error');
      }
    },
    [tenantId, refreshScheduler, refreshStaticData]
  );

  const handlePopoverEdit = useCallback((appointmentId: string) => {
    setPendingEditAppointmentId(appointmentId);
  }, []);

  const handlePopoverCancel = useCallback(
    (appointmentId: string) => {
      if (!tenantId) return;
      confirmAction({
        title: 'Cancel appointment?',
        message:
          'The slot will free up, but the record stays for history. You can restore it later from Customers.',
        confirmLabel: 'Cancel appointment',
        confirmVariant: 'danger',
        onConfirm: async () => {
          closeConfirm();
          try {
            const res = await Api.appointments.cancel(appointmentId, tenantId);
            if (res.success) {
              showToast('Appointment canceled', 'success', {
                label: 'Undo',
                onClick: () => {
                  void undoCancel(appointmentId);
                },
              });
              onPopoverClose?.();
              void refreshScheduler();
              void refreshStaticData();
            } else {
              showToast(res.error || 'Failed to cancel appointment', 'error');
            }
          } catch {
            showToast('Connection error — could not cancel appointment', 'error');
          }
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenantId, refreshScheduler, refreshStaticData, confirmAction, closeConfirm, undoCancel]
  );

  const handleQuickBooked = useCallback(() => {
    void refreshScheduler();
  }, [refreshScheduler]);

  const handleAppointmentDelete = useCallback(
    (appointmentId: string) => {
      if (!tenantId) return;
      confirmAction({
        title: 'Cancel appointment?',
        message:
          'The slot will free up, but the record stays for history. You can restore it later from Customers.',
        confirmLabel: 'Cancel appointment',
        confirmVariant: 'danger',
        onConfirm: async () => {
          closeConfirm();
          try {
            const res = await Api.appointments.cancel(appointmentId, tenantId);
            if (res.success) {
              showToast('Appointment canceled', 'success', {
                label: 'Undo',
                onClick: () => {
                  void undoCancel(appointmentId);
                },
              });
              void refreshScheduler();
            } else {
              showToast(res.error || 'Failed to cancel appointment', 'error');
            }
          } catch {
            showToast('Connection error — could not cancel appointment', 'error');
          }
        },
      });
    },
    [tenantId, refreshScheduler, confirmAction, closeConfirm, undoCancel]
  );

  const handleAppointmentMove = useCallback(
    async (appointmentId: string, deltaMinutes: number) => {
      if (!tenantId || deltaMinutes === 0) return;
      const appt = appointments.find((a) => a.appointment_id === appointmentId);
      if (!appt) return;
      const newStart = new Date(
        new Date(appt.start_time).getTime() + deltaMinutes * 60_000
      ).toISOString();
      const newEnd = new Date(
        new Date(appt.end_time).getTime() + deltaMinutes * 60_000
      ).toISOString();
      try {
        const res = await Api.appointments.update(appointmentId, tenantId, {
          start_time: newStart,
          end_time: newEnd,
        });
        if (res.success) {
          showToast(
            `Moved to ${new Date(newStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
            'success'
          );
          void refreshScheduler();
        } else {
          showToast(res.error || 'Could not move appointment', 'error');
          void refreshScheduler();
        }
      } catch {
        showToast('Connection error — appointment not moved', 'error');
        void refreshScheduler();
      }
    },
    [tenantId, appointments, refreshScheduler]
  );

  const handleNewQuickBook = useCallback(
    (prefill?: {
      employeeId?: string;
      resourceId?: string;
      hour?: number;
      endHour?: number;
      date?: Date;
    }) => {
      setQuickBookPrefill({ date: selectedDate, ...prefill });
      setQuickBookOpen(true);
    },
    [selectedDate]
  );

  return {
    confirmState,
    closeConfirm,
    quickBookOpen,
    setQuickBookOpen,
    quickBookPrefill,
    pendingEditAppointmentId,
    setPendingEditAppointmentId,
    handlePopoverEdit,
    handlePopoverCancel,
    handleQuickBooked,
    handleAppointmentDelete,
    handleAppointmentMove,
    handleNewQuickBook,
  };
}
