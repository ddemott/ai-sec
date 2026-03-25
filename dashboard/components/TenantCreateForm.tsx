import React from 'react';
import { Input } from './ui/Input';
import { Select } from './ui/Select';

type Template = {
  business_type: string;
  display_name: string;
};

interface NewBusiness {
  tenant_name: string;
  business_type: string;
  owner_first_name: string;
  owner_last_name: string;
  owner_email: string;
  owner_pass: string;
}

interface TenantCreateFormProps {
  newBusiness: NewBusiness;
  templates: Template[];
  onChange: (updated: NewBusiness) => void;
}

export function TenantCreateForm({ newBusiness, templates, onChange }: TenantCreateFormProps) {
  return (
    <div className="space-y-4">
        <Input
            label="Business Name"
            placeholder="e.g. Elite Salon & Spa"
            value={newBusiness.tenant_name}
            onChange={e => onChange({...newBusiness, tenant_name: e.target.value})}
        />
        <Select
            label="Template Type"
            value={newBusiness.business_type}
            onChange={e => onChange({...newBusiness, business_type: e.target.value})}
            options={templates.map(t => ({ label: t.display_name, value: t.business_type }))}
        />
        <div className="pt-4 border-t space-y-4" style={{ borderColor: 'var(--border-soft)' }}>
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Initial Owner Credentials</h4>
            <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="First Name"
                  value={newBusiness.owner_first_name}
                  onChange={e => onChange({...newBusiness, owner_first_name: e.target.value})}
                />
                <Input
                    type="email"
                    placeholder="Email"
                    value={newBusiness.owner_email}
                    onChange={e => onChange({...newBusiness, owner_email: e.target.value})}
                />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Last Name"
                value={newBusiness.owner_last_name}
                onChange={e => onChange({...newBusiness, owner_last_name: e.target.value})}
              />
              <Input
                type="password"
                placeholder="Owner Password"
                value={newBusiness.owner_pass}
                onChange={e => onChange({...newBusiness, owner_pass: e.target.value})}
              />
            </div>
        </div>
    </div>
  );
}
