// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { AISecretaryService } from "./service.ts";
import type { IRepository } from "./interfaces.ts";
import { baseLogger } from "./logger.ts";
import type {
  ResourceCandidate,
  EmployeeCandidate,
  ExistingAppointment,
  TimeWindow,
  ServiceRequirements,
  AssignmentOption,
} from "./scheduling.ts";

class FakeSchedulingRepo implements IRepository {
  constructor(
    private readonly resources: ResourceCandidate[],
    private readonly employees: EmployeeCandidate[] = [],
    private readonly existing: ExistingAppointment[] = [],
    private readonly shifts: any[] = []
  ) {}

  // Core methods not used in these tests
  ping(): Promise<void> { return Promise.resolve(); }
  findCustomerByPhone(): Promise<any> { return Promise.resolve(null); }
  createCustomer(): Promise<string> { return Promise.resolve("fake-customer-id"); }
  getRecentSummaries(): Promise<any[]> { return Promise.resolve([]); }
  checkOverlap(): Promise<boolean> { return Promise.resolve(false); }
  bookAtomic(): Promise<any> { return Promise.resolve({ success: true, appointment_id: "appt-1", error_message: "" }); }
  setLogger(): void {}
  close(): Promise<void> { return Promise.resolve(); }
  
  createEmployee(): Promise<number> { return Promise.resolve(1); }
  updateEmployee(): Promise<boolean> { return Promise.resolve(true); }
  deleteEmployee(): Promise<boolean> { return Promise.resolve(true); }
  getEmployees(): Promise<any[]> { return Promise.resolve([]); }
  
  createService(): Promise<number> { return Promise.resolve(1); }
  updateService(): Promise<boolean> { return Promise.resolve(true); }
  deleteService(): Promise<boolean> { return Promise.resolve(true); }
  getServices(): Promise<any[]> { return Promise.resolve([]); }

  assignEmployeeToService(): Promise<boolean> { return Promise.resolve(true); }
  assignResourceToService(): Promise<boolean> { return Promise.resolve(true); }
  removeEmployeeFromService(): Promise<boolean> { return Promise.resolve(true); }
  removeResourceFromService(): Promise<boolean> { return Promise.resolve(true); }
  getServiceEmployees(): Promise<number[]> { return Promise.resolve([]); }
  getServiceResources(): Promise<string[]> { return Promise.resolve([]); }
  searchKnowledgeBase(): Promise<any[]> { return Promise.resolve([]); }

  // New scheduling primitives used by getSchedulingOptions
  async getSchedulingResources(_tenantId: string): Promise<ResourceCandidate[]> {
    return this.resources;
  }

  async getSchedulingEmployees(_tenantId: string): Promise<EmployeeCandidate[]> {
    return this.employees;
  }

  async getEmployeeShifts(_tenantId: string): Promise<any[]> {
    return this.shifts;
  }

  async getExistingAppointments(_tenantId: string, _window: TimeWindow): Promise<ExistingAppointment[]> {
    return this.existing;
  }
}

function window(from: string, to: string): TimeWindow {
  return { from: new Date(from), to: new Date(to) };
}

Deno.test({
  name: "getSchedulingOptions prefers requested stylist when available",
  sanitizeOps: false,
  async fn() {
    const resources: ResourceCandidate[] = [
      { id: "suzy", type: "STYLIST", capabilities: ["cut"] },
      { id: "alex", type: "STYLIST", capabilities: ["cut"] },
    ];

    const repo = new FakeSchedulingRepo(resources);
    const service = new AISecretaryService(repo);

    const requirements: ServiceRequirements = {
      serviceType: "haircut",
      requiredResourceCapabilities: ["cut"],
      preferredResourceId: "suzy",
    };

    const res = await service.getSchedulingOptions(
      "tenant-1",
      requirements,
      window("2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z"),
      baseLogger,
    );

    assertEquals(res.result.options, [{ resourceId: "suzy" }] as AssignmentOption[]);
  },
});

Deno.test({
  name: "getSchedulingOptions returns bay + mechanic pairs for alignment",
  sanitizeOps: false,
  async fn() {
    const resources: ResourceCandidate[] = [
      { id: "bay1", type: "BAY", capabilities: ["oil-change"] },
      { id: "bay4", type: "BAY", capabilities: ["alignment", "tire-change"] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: "101", skills: ["oil-change"] },
      { id: "102", skills: ["alignment", "oil-change"] },
    ];

    const shifts = [
      { employee_id: 101, day_of_week: 4, start_time: "08:00", end_time: "18:00" }, // Thursday
      { employee_id: 102, day_of_week: 4, start_time: "08:00", end_time: "18:00" },
    ];

    const repo = new FakeSchedulingRepo(resources, employees, [], shifts);
    const service = new AISecretaryService(repo);

    const requirements: ServiceRequirements = {
      serviceType: "alignment",
      requiredResourceCapabilities: ["alignment"],
      requiredEmployeeSkills: ["alignment"],
    };

    const res = await service.getSchedulingOptions(
      "tenant-1",
      requirements,
      window("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"), // 2026-10-01 is a Thursday (4)
      baseLogger,
    );

    assertEquals(res.result.options, [{ resourceId: "bay4", employeeId: "102" }] as AssignmentOption[]);
  },
});

Deno.test({
  name: "getSchedulingOptions excludes employees when off-shift",
  sanitizeOps: false,
  async fn() {
    const resources: ResourceCandidate[] = [{ id: "bay1", capabilities: ["alignment"] }];
    const employees: EmployeeCandidate[] = [{ id: "102", skills: ["alignment"] }];
    
    // Employee 102 only works Mondays (1), but request is for Thursday (4)
    const shifts = [{ employee_id: 102, day_of_week: 1, start_time: "08:00", end_time: "18:00" }];

    const repo = new FakeSchedulingRepo(resources, employees, [], shifts);
    const service = new AISecretaryService(repo);

    const requirements: ServiceRequirements = {
      serviceType: "alignment",
      requiredEmployeeSkills: ["alignment"],
    };

    const res = await service.getSchedulingOptions(
      "tenant-1",
      requirements,
      window("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"), // Thursday
      baseLogger,
    );

    assertEquals(res.result.options.length, 0);
  },
});
