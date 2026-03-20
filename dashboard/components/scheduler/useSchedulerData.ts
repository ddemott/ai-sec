import { useState, useEffect, useCallback, useMemo } from 'react';
import { Api } from '../../lib/api';

export interface SchedulerAppointment {
  id: string;
  tenant_id: string;
  resource_id: string;
  customer_id: string;
  employee_id: string | null;
  start_time: string;
  end_time: string;
  description: string;
  status: string;
  location?: string;
  customers?: { name: string; first_name?: string; last_name?: string; phone?: string; metadata?: Record<string, unknown> };
  resources?: { name: string };
}

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDayOfWeek(date: Date): number {
  return date.getDay(); // 0=Sun,1=Mon,...6=Sat
}

interface SchedulerEmployee { id: string | number; name: string }
interface SchedulerResource { id: string | number; name: string }
interface SchedulerShift { employee_id?: string | number; user_id?: string | number; day_of_week: number; start_time?: string; end_time?: string }

export function useSchedulerData(tenantId: string | null, selectedDate: Date, employees: SchedulerEmployee[], resources: SchedulerResource[]) {
  const [appointments, setAppointments] = useState<SchedulerAppointment[]>([]);
  const [shifts, setShifts] = useState<SchedulerShift[]>([]);
  const [loading, setLoading] = useState(false);

  const dateStr = toDateString(selectedDate);

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);

    const startDate = `${dateStr}T00:00:00Z`;
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const endDate = `${toDateString(nextDay)}T00:00:00Z`;

    const [apptRes, shiftRes] = await Promise.allSettled([
      Api.appointments.list(tenantId, { startDate, endDate }),
      Api.shifts.list(tenantId),
    ]);

    if (apptRes.status === 'fulfilled' && Array.isArray(apptRes.value)) {
      setAppointments(apptRes.value);
    } else {
      setAppointments([]);
    }

    if (shiftRes.status === 'fulfilled' && Array.isArray(shiftRes.value)) {
      setShifts(shiftRes.value);
    } else {
      setShifts([]);
    }

    setLoading(false);
  }, [tenantId, dateStr, selectedDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const dayOfWeek = getDayOfWeek(selectedDate);

  const appointmentsByEmployee = useMemo(() => {
    const map = new Map<string, SchedulerAppointment[]>();
    for (const emp of employees) {
      map.set(String(emp.id), []);
    }
    // Add "unassigned" bucket
    map.set('unassigned', []);
    for (const appt of appointments) {
      const key = appt.employee_id ? String(appt.employee_id) : 'unassigned';
      const list = map.get(key);
      if (list) {
        list.push(appt);
      } else {
        // Employee not in current list (maybe deleted), put in unassigned
        const unassigned = map.get('unassigned')!;
        unassigned.push(appt);
      }
    }
    return map;
  }, [appointments, employees]);

  const appointmentsByResource = useMemo(() => {
    const map = new Map<string, SchedulerAppointment[]>();
    for (const res of resources) {
      map.set(String(res.id), []);
    }
    for (const appt of appointments) {
      const key = String(appt.resource_id);
      const list = map.get(key);
      if (list) {
        list.push(appt);
      } else {
        map.set(key, [appt]);
      }
    }
    return map;
  }, [appointments, resources]);

  const shiftsByEmployee = useMemo(() => {
    const map = new Map<string, SchedulerShift[]>();
    for (const emp of employees) {
      map.set(String(emp.id), []);
    }
    for (const shift of shifts) {
      const empId = shift.employee_id != null ? String(shift.employee_id) : (shift.user_id ? String(shift.user_id) : null);
      if (!empId) continue;
      if (shift.day_of_week !== dayOfWeek) continue;
      const list = map.get(empId);
      if (list) {
        list.push(shift);
      } else {
        map.set(empId, [shift]);
      }
    }
    return map;
  }, [shifts, employees, dayOfWeek]);

  return {
    appointments,
    shifts,
    loading,
    appointmentsByEmployee,
    appointmentsByResource,
    shiftsByEmployee,
    refresh: fetchData,
  };
}
