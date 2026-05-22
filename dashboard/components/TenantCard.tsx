import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge } from './ui/Badge';
import type { TenantFull } from '../lib/types';

interface TenantCardProps {
  tenant: TenantFull;
  isSelected: boolean;
  isDragging: boolean;
  index: number;
  /**
   * Whether this card can be drag-reordered. Defaults true. Disabled while a
   * search filter is active: reorder math operates on the FULL tenants array
   * by index, so dragging within a filtered subset would corrupt the order.
   */
  draggable?: boolean;
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
  draggable = true,
  onSelect,
  onDragStart,
  onDragOver,
  onDragEnd,
}: TenantCardProps) {
  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? () => onDragStart(index) : undefined}
      onDragOver={draggable ? (e) => onDragOver(e, index) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={onSelect}
      data-testid={`tenant-card-${tenant.tenant_id}`}
      className={`p-4 border-b cursor-pointer transition flex justify-between items-center
        ${isSelected ? 'border-l-4 shadow-sm' : ''}
        ${isDragging ? 'opacity-50' : ''}`}
      style={{
        borderBottomColor: 'var(--border-soft)',
        ...(isSelected
          ? { backgroundColor: 'var(--bg-raised)', borderLeftColor: 'var(--accent-soft)' }
          : {}),
      }}
    >
      <div className="flex items-center gap-3">
        <div className="cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <circle cx="3" cy="2" r="1.5" />
            <circle cx="9" cy="2" r="1.5" />
            <circle cx="3" cy="6" r="1.5" />
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="3" cy="10" r="1.5" />
            <circle cx="9" cy="10" r="1.5" />
          </svg>
        </div>
        <div>
          <p
            className="text-sm font-semibold"
            style={{ color: isSelected ? 'var(--accent-soft)' : 'var(--text-primary)' }}
          >
            {tenant.name}
          </p>
          <div className="flex items-center mt-1">
            <Badge variant="secondary" className="mr-2">
              {tenant.business_type}
            </Badge>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-[100px]">
              {tenant.tenant_id.slice(0, 8)}
            </span>
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
    </div>
  );
}
