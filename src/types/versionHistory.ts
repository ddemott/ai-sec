/**
 * Version History Types
 *
 * Types for the audit trail and soft delete system that allows:
 * - Full history of record changes
 * - Field-level restore from any version
 * - Soft delete with restore capability
 * - Merge/copy fields between records
 */

export type ChangeType = 'create' | 'update' | 'delete' | 'restore' | 'sync' | 'merge';

export type ChangeSource =
  | 'local'
  | 'hubspot'
  | 'jobber'
  | 'square'
  | 'servicetitan'
  | 'voice_call'
  | 'system'
  | 'api';

export type VersionedTable =
  | 'customers'
  | 'appointments'
  | 'voice_sessions'
  | 'employees'
  | 'services'
  | 'resources';

export interface RecordVersion {
  record_version_id: string;
  tenant_id: string;
  table_name: VersionedTable;
  record_id: string;
  version_number: number;
  data: Record<string, unknown>;
  changed_fields: string[];
  previous_values: Record<string, unknown>;
  change_type: ChangeType;
  change_source: ChangeSource;
  changed_by: string | null;
  change_summary: string | null;
  changed_at: string;
}

export interface VersionComparison {
  field_name: string;
  value_a: unknown;
  value_b: unknown;
}

export interface RecordHistoryResponse {
  record_id: string;
  table_name: VersionedTable;
  current_version: number;
  versions: RecordVersion[];
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface DeletedRecord {
  id: string;
  tenant_id: string;
  table_name: VersionedTable;
  name: string | null;
  phone: string | null;
  email: string | null;
  deleted_at: string;
  deleted_by: string | null;
  version_count: number;
  last_data: Record<string, unknown>;
}

export interface DeletedRecordsResponse {
  records: DeletedRecord[];
  total: number;
}

export interface RestoreFieldsRequest {
  table_name: VersionedTable;
  record_id: string;
  source_version: number;
  fields: string[];
  restored_by?: string;
  change_source?: ChangeSource;
}

export interface RestoreDeletedRequest {
  table_name: VersionedTable;
  record_id: string;
  restored_by?: string;
  change_source?: ChangeSource;
}

export interface CopyFieldsRequest {
  table_name: VersionedTable;
  source_record_id: string;
  target_record_id: string;
  fields: string[];
  copied_by?: string;
  change_source?: ChangeSource;
}

export interface SoftDeleteRequest {
  table_name: VersionedTable;
  record_id: string;
  deleted_by?: string;
  change_source?: ChangeSource;
}

export interface FieldRestoreOption {
  field: string;
  current_value: unknown;
  versions: Array<{
    version_number: number;
    value: unknown;
    changed_at: string;
    change_source: ChangeSource;
  }>;
}

export interface RecordRestorePreview {
  record_id: string;
  table_name: VersionedTable;
  fields: FieldRestoreOption[];
}

export interface RecentChange {
  record_version_id: string;
  tenant_id: string;
  table_name: VersionedTable;
  record_id: string;
  version_number: number;
  change_type: ChangeType;
  change_source: ChangeSource;
  changed_by: string | null;
  change_summary: string | null;
  changed_at: string;
  record_name: string | null;
  record_phone: string | null;
}

export interface RecentChangesResponse {
  changes: RecentChange[];
  total: number;
}

// Helper to format change source for display
export function formatChangeSource(source: ChangeSource): string {
  const labels: Record<ChangeSource, string> = {
    local: 'Manual Edit',
    hubspot: 'HubSpot Sync',
    jobber: 'Jobber Sync',
    square: 'Square Sync',
    servicetitan: 'ServiceTitan Sync',
    voice_call: 'Voice Call',
    system: 'System',
    api: 'API',
  };
  return labels[source] || source;
}

// Helper to format change type for display
export function formatChangeType(type: ChangeType): string {
  const labels: Record<ChangeType, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    restore: 'Restored',
    sync: 'Synced',
    merge: 'Merged',
  };
  return labels[type] || type;
}

// Helper to get icon/color for change type
export function getChangeTypeStyle(type: ChangeType): { color: string; icon: string } {
  const styles: Record<ChangeType, { color: string; icon: string }> = {
    create: { color: 'green', icon: 'plus' },
    update: { color: 'blue', icon: 'edit' },
    delete: { color: 'red', icon: 'trash' },
    restore: { color: 'purple', icon: 'undo' },
    sync: { color: 'orange', icon: 'refresh' },
    merge: { color: 'cyan', icon: 'merge' },
  };
  return styles[type] || { color: 'gray', icon: 'circle' };
}
