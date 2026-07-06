'use client';

import React from 'react';
import { PhoneForwarded, Bell } from 'lucide-react';
import { Input } from '../ui/Input';

interface ForwardCallsSectionProps {
  forwardPhone: string;
  ownerPhone: string;
  forwardLoops: boolean;
  onForwardPhoneChange: (val: string) => void;
  onOwnerPhoneChange: (val: string) => void;
}

export function ForwardCallsSection({
  forwardPhone,
  ownerPhone,
  forwardLoops,
  onForwardPhoneChange,
  onOwnerPhoneChange,
}: ForwardCallsSectionProps) {
  return (
    <>
      <section className="space-y-4">
        <h2
          className="text-lg font-bold flex items-center"
          style={{ color: 'var(--text-primary)' }}
        >
          <PhoneForwarded className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
          Forward Calls to a Person
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          When a caller needs a real person, the assistant can transfer the live call to this number
          (e.g. your cell). Leave blank to have the assistant take a message instead.
        </p>
        <Input
          type="tel"
          label="Forward calls to"
          value={forwardPhone}
          onChange={(e) => onForwardPhoneChange(e.target.value)}
          placeholder="Ex: +1 312 555 0100"
        />
        {forwardLoops && (
          <p className="text-sm" style={{ color: 'var(--danger, #dc2626)' }}>
            This can&apos;t be the same as your forwarded-from number or the assistant&apos;s own
            number — the call would loop back to the assistant.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2
          className="text-lg font-bold flex items-center"
          style={{ color: 'var(--text-primary)' }}
        >
          <Bell className="w-5 h-5 mr-2" style={{ color: 'var(--accent-soft)' }} />
          Owner Notification Phone
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          When a caller leaves a message, the AI will send you an SMS alert at this number. Leave
          blank to disable SMS notifications.
        </p>
        <Input
          type="tel"
          label="Notification number"
          value={ownerPhone}
          onChange={(e) => onOwnerPhoneChange(e.target.value)}
          placeholder="Ex: +1 630 555 0100"
        />
      </section>
    </>
  );
}
