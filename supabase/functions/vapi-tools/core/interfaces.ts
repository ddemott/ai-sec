import { Logger } from "./logger.ts";
import type { ResourceCandidate, EmployeeCandidate, ExistingAppointment, TimeWindow } from "./scheduling.ts";

export interface IRepository {
  ping(): Promise<void>;
  findCustomerByPhone(tenantId: string, phone: string, logger: Logger): Promise<{ id: string; name: string } | null>;
  findTenantByPhone(phone: string, logger: Logger): Promise<{ id: string; name: string } | null>;
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
    location?: string;
    employeeId?: string;
  }, logger: Logger): Promise<{ success: boolean; appointment_id: string; error_message: string }>;
  
  // Admin/CRUD Support
  createEmployee(tenantId: string, data: { name: string; skills: string[] }): Promise<number>;
  updateEmployee(tenantId: string, id: number, data: { name?: string; skills?: string[]; is_active?: boolean }): Promise<boolean>;
  deleteEmployee(tenantId: string, id: number): Promise<boolean>;
  getEmployees(tenantId: string, logger: Logger): Promise<any[]>;
  getEmployeeShifts(tenantId: string, logger: Logger): Promise<Array<{ employee_id: number; day_of_week: number; start_time: string; end_time: string }>>;
  
  createService(tenantId: string, data: { name: string; duration_minutes: number; required_skills?: string[]; required_resources?: string[] }): Promise<number>;
  updateService(tenantId: string, id: number, data: { name?: string; duration_minutes?: number; required_skills?: string[]; required_resources?: string[] }): Promise<boolean>;
  deleteService(tenantId: string, id: number): Promise<boolean>;
  getServices(tenantId: string, logger: Logger): Promise<any[]>;

  assignEmployeeToService(serviceId: number, employeeId: number, tenantId: string, logger: Logger): Promise<boolean>;
  assignResourceToService(serviceId: number, resourceId: string, tenantId: string, logger: Logger): Promise<boolean>;
  removeEmployeeFromService(serviceId: number, employeeId: number, logger: Logger): Promise<boolean>;
  removeResourceFromService(serviceId: number, resourceId: string, logger: Logger): Promise<boolean>;
  getServiceEmployees(serviceId: number, logger: Logger): Promise<number[]>;
  getServiceResources(serviceId: number, logger: Logger): Promise<string[]>;

  /**
   * Performs semantic vector search on tenant knowledge docs.
   */
  searchKnowledgeBase(
    tenantId: string, 
    queryEmbedding: number[], 
    logger: Logger, 
    limit?: number, 
    threshold?: number
  ): Promise<Array<{ content: string; similarity: number }>>;

  setLogger(logger: Logger): void;
  close(): Promise<void>;
}
