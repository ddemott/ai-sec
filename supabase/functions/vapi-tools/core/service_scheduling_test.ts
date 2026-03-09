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
  ) {}

  // Core methods not used in these tests
  ping(): Promise<void> {
    return Promise.resolve();
  }
  findCustomerByPhone(): Promise<{ id: string; name: string } | null> {
    return Promise.resolve(null);
  }
  createCustomer(): Promise<string> {
    return Promise.resolve("fake-customer-id");
  }
  getRecentSummaries(): Promise<Array<{ summary: string; created_at: string }>> {
    return Promise.resolve([]);
  }
  checkOverlap(): Promise<boolean> {
    return Promise.resolve(false);
  }
  bookAtomic(): Promise<{ success: boolean; appointment_id: string; error_message: string }> {
    return Promise.resolve({ success: true, appointment_id: "appt-1", error_message: "" });
  }
  setLogger(): void {
    // no-op
  }

  // New scheduling primitives used by getSchedulingOptions
  async getSchedulingResources(_tenantId: string): Promise<ResourceCandidate[]> {
    return this.resources;
  }

  async getSchedulingEmployees(_tenantId: string): Promise<EmployeeCandidate[]> {
    return this.employees;
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
      { id: "john", skills: ["oil-change"], onShift: true },
      { id: "rick", skills: ["alignment", "oil-change"], onShift: true },
    ];

    const repo = new FakeSchedulingRepo(resources, employees, []);
    const service = new AISecretaryService(repo);

    const requirements: ServiceRequirements = {
      serviceType: "alignment",
      requiredResourceCapabilities: ["alignment"],
      requiredEmployeeSkills: ["alignment"],
    };

    const res = await service.getSchedulingOptions(
      "tenant-1",
      requirements,
      window("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"),
      baseLogger,
    );

    assertEquals(res.result.options, [{ resourceId: "bay4", employeeId: "rick" }] as AssignmentOption[]);
  },
});
