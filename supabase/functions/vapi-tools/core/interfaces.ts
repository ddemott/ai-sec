import { Logger } from "./logger.ts";
import type { ResourceCandidate, EmployeeCandidate, ExistingAppointment, TimeWindow } from "./scheduling.ts";

export interface IRepository {
  ping(): Promise<void>;
  findCustomerByPhone(tenantId: string, phone: string, logger: Logger): Promise<{ id: string; name: string } | null>;
  createCustomer(tenantId: string, phone: string, name: string, logger: Logger): Promise<string>;
  getRecentSummaries(customerId: string, tenantId: string, logger: Logger, limit?: number): Promise<Array<{ summary: string; created_at: string }>>;
  checkOverlap(resourceId: string, tenantId: string, start: string, end: string, logger: Logger): Promise<boolean>;
  /**
   * Scheduling primitives for selector-based availability.
   * Initial implementation can be in-memory or stubbed; DB-backed
   * repository will be wired up incrementally.
   */
  getSchedulingResources(tenantId: string, logger: Logger): Promise<ResourceCandidate[]>;
  getSchedulingEmployees(tenantId: string, logger: Logger): Promise<EmployeeCandidate[]>;
  getExistingAppointments(
    tenantId: string,
    window: TimeWindow,
    logger: Logger,
  ): Promise<ExistingAppointment[]>;
  bookAtomic(params: {
    tenantId: string;
    resourceId: string;
    customerId: string;
    startTime: string;
    endTime: string;
    description: string;
    callId: string;
    location?: string; // New field
  }, logger: Logger): Promise<{ success: boolean; appointment_id: string; error_message: string }>;
  setLogger(logger: Logger): void;
}
