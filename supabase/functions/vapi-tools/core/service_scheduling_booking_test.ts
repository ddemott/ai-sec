// @ts-nocheck
import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { AISecretaryService } from "./service.ts";
import type { IRepository } from "./interfaces.ts";
import { baseLogger } from "./logger.ts";
import { AvailabilityError } from "./errors.ts";
import type {
  ResourceCandidate,
  EmployeeCandidate,
  ExistingAppointment,
  TimeWindow,
  ServiceRequirements,
} from "./scheduling.ts";

class FakeBookingRepo implements IRepository {
  private customerId = "cust-1";

  constructor(
    private readonly resources: ResourceCandidate[],
    private readonly employees: EmployeeCandidate[] = [],
    private readonly existing: ExistingAppointment[] = [],
  ) {}

  // Core methods used by booking
  async findCustomerByPhone(_tenantId: string, _phone: string): Promise<{ id: string; name: string } | null> {
    return { id: this.customerId, name: "Test Customer" };
  }

  async createCustomer(): Promise<string> {
    return this.customerId;
  }

  async bookAtomic(params: {
    tenantId: string;
    resourceId: string;
    customerId: string;
    startTime: string;
    endTime: string;
    description: string;
    callId: string;
    location?: string;
  }): Promise<{ success: boolean; appointment_id: string; error_message: string }> {
    return {
      success: true,
      appointment_id: `appt-${params.resourceId}`,
      error_message: "",
    };
  }

  // Unused interface methods in these tests
  ping(): Promise<void> { return Promise.resolve(); }
  getRecentSummaries(): Promise<Array<{ summary: string; created_at: string }>> { return Promise.resolve([]); }
  checkOverlap(): Promise<boolean> { return Promise.resolve(false); }
  setLogger(): void { /* no-op */ }

  // Scheduling primitives
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
  name: "bookWithScheduling picks first option and returns appointment",
  sanitizeOps: false,
  async fn() {
    const resources: ResourceCandidate[] = [
      { id: "suzy", type: "STYLIST", capabilities: ["cut"] },
      { id: "alex", type: "STYLIST", capabilities: ["cut"] },
    ];

    const repo = new FakeBookingRepo(resources);
    const service = new AISecretaryService(repo);

    const requirements: ServiceRequirements = {
      serviceType: "haircut",
      requiredResourceCapabilities: ["cut"],
      preferredResourceId: "suzy",
    };

    const res = await service.bookWithScheduling({
      tenant_id: "tenant-1",
      phone: "+15555550123",
      name: "Caller",
      description: "Haircut booking",
      call_id: "call-123",
      location: "Main St",
      requirements,
      window: window("2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z"),
    }, baseLogger);

    assertEquals(res.result.success, true);
    assertEquals(res.result.option.resourceId, "suzy");
    assertEquals(res.result.appointment_id, "appt-suzy");
  },
});

Deno.test({
  name: "bookWithScheduling throws when no options",
  sanitizeOps: false,
  async fn() {
    const resources: ResourceCandidate[] = [
      { id: "chair1", type: "STATION", capabilities: ["dry"] },
    ];

    const repo = new FakeBookingRepo(resources);
    const service = new AISecretaryService(repo);

    const requirements: ServiceRequirements = {
      serviceType: "haircut",
      requiredResourceCapabilities: ["cut"],
    };

    await assertRejects(
      () => service.bookWithScheduling({
        tenant_id: "tenant-1",
        phone: "+15555550123",
        description: "Haircut booking",
        call_id: "call-123",
        location: "Main St",
        requirements,
        window: window("2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z"),
      }, baseLogger),
      AvailabilityError,
      "No available scheduling options",
    );
  },
});
