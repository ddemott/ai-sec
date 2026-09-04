'use client';

import React from 'react';
import { X } from 'lucide-react';
import type { BusinessTemplate } from '../../lib/types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface TemplatePreviewModalProps {
  template: BusinessTemplate;
  currentBusinessType: string | null;
  applying: boolean;
  onClose: () => void;
  onApply: (template: BusinessTemplate) => void;
}

export function TemplatePreviewModal({
  template,
  currentBusinessType,
  applying,
  onClose,
  onApply,
}: TemplatePreviewModalProps) {
  const isActive = currentBusinessType === template.business_type;

  return (
    <Modal isOpen={true} onClose={onClose} title="">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{template.display_name}</h2>
            <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-wider">
              {template.category || 'Business Template'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3 space-y-1">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
            Dashboard Labels
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div>
              <span className="text-gray-400">Resources called:</span>{' '}
              <span className="font-medium">{template.resource_plural || 'Resources'}</span>
            </div>
            <div>
              <span className="text-gray-400">Staff called:</span>{' '}
              <span className="font-medium">{template.employee_plural || 'Employees'}</span>
            </div>
            <div>
              <span className="text-gray-400">Bookings called:</span>{' '}
              <span className="font-medium">{template.booking_label || 'Appointments'}</span>
            </div>
            <div>
              <span className="text-gray-400">Default resource:</span>{' '}
              <span className="font-medium">{template.default_resource_name || 'Station 1'}</span>
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
            AI System Prompt
          </p>
          <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3 text-sm font-mono leading-relaxed max-h-40 overflow-y-auto">
            {template.system_prompt_template}
          </div>
        </div>

        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
            Greeting Message
          </p>
          <div className="bg-gray-50 dark:bg-gray-800/30 rounded-lg p-3 text-sm italic">
            &quot;{template.first_message}&quot;
          </div>
        </div>

        {template.example_services && template.example_services.length > 0 && (
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Suggested Services
            </p>
            <div className="flex flex-wrap gap-1.5">
              {template.example_services.map((svc, index) => (
                <span
                  key={`${svc.name}-${index}`}
                  title={svc.description ?? undefined}
                  className="text-xs px-2 py-1 rounded-full"
                  style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent-soft)' }}
                >
                  {svc.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div
          className="flex items-center justify-between pt-3 border-t"
          style={{ borderColor: 'var(--border-soft)' }}
        >
          <p className="text-xs text-gray-400">
            {isActive
              ? 'This is your current template.'
              : 'Applying will overwrite your AI persona, voice, and first message.'}
          </p>
          <Button
            onClick={() => onApply(template)}
            disabled={isActive || applying}
            isLoading={applying}
          >
            {isActive ? 'Already applied' : 'Apply to my business'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
