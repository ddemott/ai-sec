'use client';

import React from 'react';
import { Users } from 'lucide-react';
import { formatPhone } from '../../lib/phone';
import type { Employee, Service } from '../../lib/types';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

interface EmployeeCardProps {
  employee: Employee;
  services: Service[];
  mappings: { service_id: string; employee_id?: string }[];
  onClick: () => void;
}

export function EmployeeCard({ employee, services, mappings, onClick }: EmployeeCardProps) {
  const assignedServices = mappings
    .filter((m) => m.employee_id === employee.employee_id)
    .map((m) => services.find((s) => s.service_id === m.service_id))
    .filter(Boolean) as Service[];

  return (
    <Card onClick={onClick} className="cursor-pointer hover:shadow-xl transition-all group">
      <div className="flex justify-between items-start mb-4">
        <div
          className="p-3 rounded-2xl shadow-sm border"
          style={{ backgroundColor: 'var(--bg-raised)', borderColor: 'var(--border-soft)' }}
        >
          <Users
            className="w-6 h-6 group-hover:opacity-80 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          />
        </div>
        <Badge variant={employee.is_active ? 'success' : 'secondary'}>
          {employee.is_active ? 'Active' : 'On Leave'}
        </Badge>
      </div>

      <h3 className="text-xl font-bold mb-1">{employee.name}</h3>
      {(employee.phone || employee.email) && (
        <div className="text-xs mb-2 space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
          {employee.phone && <div>{formatPhone(employee.phone)}</div>}
          {employee.email && <div>{employee.email}</div>}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {assignedServices.length > 0 ? (
          assignedServices.map((s) => (
            <Badge key={s.service_id} variant="primary">
              {s.name}
            </Badge>
          ))
        ) : (
          <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
            No services provided
          </span>
        )}
      </div>
    </Card>
  );
}
