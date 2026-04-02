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
   * Returns the service catalog for a tenant (Layer 1: database facts, no RAG).
   */
  getServiceCatalog(
    tenantId: string,
    logger: Logger
  ): Promise<Array<{ id: number; name: string; subtitle: string; description: string; duration_minutes: number; price: number | null }>>;

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

  /**
   * Single-query find-and-book: customer upsert + resource/employee matching + booking.
   * Replaces the 4-query getSchedulingOptions + bookAtomic flow.
   */
  bookWithSchedulingAtomic(params: {
    tenantId: string;
    phone: string;
    customerName?: string;
    description: string;
    callId: string;
    location?: string;
    startTime?: string;
    endTime?: string;
    windowFrom?: string;
    windowTo?: string;
    requiredSkills?: string[];
    requiredCapabilities?: string[];
    preferredResourceId?: string;
    preferredEmployeeId?: string;
    serviceType?: string;
    durationMinutes?: number;
  }, logger: Logger): Promise<{
    success: boolean;
    appointment_id: string | null;
    resource_id: string | null;
    resource_name: string | null;
    employee_id: string | null;
    employee_name: string | null;
    booked_start: string | null;
    booked_end: string | null;
    customer_id: string | null;
    error_message: string | null;
    error_code: string | null;
  }>;

  /**
   * Returns raw data for computing available slots: service info, shifts for the day, existing appointments.
   */
  getAvailableSlots(
    tenantId: string,
    serviceType: string,
    date: string,
    logger: Logger
  ): Promise<{
    service: { name: string; duration_minutes: number; price: number | null } | null;
    shifts: Array<{ start_time: string; end_time: string }>;
    appointments: Array<{ start_time: string; end_time: string }>;
  }>;

  setLogger(logger: Logger): void;
  close(): Promise<void>;
}
