import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge } from './ui/Badge';

type Tenant = {
  id: string;
  name: string;
  business_type: string;
  timezone?: string;
  owner_phone?: string | null;
  inbound_phone?: string | null;
  voice_id?: string | null;
  first_message?: string | null;
  system_prompt?: string | null;
  vapi_assistant_id?: string | null;
  vapi_phone_number_id?: string | null;
  phone_status?: string;
};

interface TenantCardProps {
  tenant: Tenant;
  isSelected: boolean;
  isDragging: boolean;
  index: number;
  onSelect: () => void;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
}

export function TenantCard({
  tenant,
  isSelected,
  isDragging,
  index,
  onSelect,
  onDragStart,
  onDragOver,
  onDragEnd,
}: TenantCardProps) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={`p-4 border-b border-gray-100 dark:border-gray-800 cursor-pointer transition flex justify-between items-center
        ${isSelected ? 'bg-white dark:bg-[#2a2a2a] border-l-4 border-l-blue-600 dark:border-l-blue-400 shadow-sm' : 'hover:bg-gray-100 dark:hover:bg-[#222]'}
        ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className="cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <circle cx="3" cy="2" r="1.5" /><circle cx="9" cy="2" r="1.5" />
            <circle cx="3" cy="6" r="1.5" /><circle cx="9" cy="6" r="1.5" />
            <circle cx="3" cy="10" r="1.5" /><circle cx="9" cy="10" r="1.5" />
          </svg>
        </div>
        <div>
          <p className={`text-sm font-semibold ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>{tenant.name}</p>
          <div className="flex items-center mt-1">
              <Badge variant="secondary" className="mr-2">
                  {tenant.business_type}
              </Badge>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[100px]">{tenant.id.slice(0,8)}</span>
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
    </div>
  );
}
