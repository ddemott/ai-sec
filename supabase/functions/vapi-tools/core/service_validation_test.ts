// @ts-nocheck
import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { AISecretaryService } from "./service.ts";
import type { IRepository } from "./interfaces.ts";
import { ValidationError } from "./errors.ts";
import { baseLogger } from "./logger.ts";

class FakeRepo implements IRepository {
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
  getEmployeeShifts(): Promise<any[]> { return Promise.resolve([]); }
  
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

  getSchedulingResources(): Promise<any[]> { return Promise.resolve([]); }
  getSchedulingEmployees(): Promise<any[]> { return Promise.resolve([]); }
  getExistingAppointments(): Promise<any[]> { return Promise.resolve([]); }
}

Deno.test({
  name: "AISecretaryService.checkAvailability rejects non-ISO dates",
  sanitizeOps: false,
  async fn() {
    const service = new AISecretaryService(new FakeRepo());

    await assertRejects(
      () => service.checkAvailability("tenant-1", "resource-1", "invalid", "2026-10-01", baseLogger),
      ValidationError,
      "Invalid date format provided for availability check.",
    );
  },
});

Deno.test({
  name: "AISecretaryService.checkAvailability rejects end before start",
  sanitizeOps: false,
  async fn() {
    const service = new AISecretaryService(new FakeRepo());

    await assertRejects(
      () => service.checkAvailability(
        "tenant-1",
        "resource-1",
        "2026-10-01T11:00:00Z",
        "2026-10-01T10:00:00Z",
        baseLogger,
      ),
      ValidationError,
      "End time must be after start time.",
    );
  },
});

Deno.test({
  name: "AISecretaryService.checkAvailability passes through to repository on valid range",
  sanitizeOps: false,
  async fn() {
    const service = new AISecretaryService(new FakeRepo());

    const res = await service.checkAvailability(
      "tenant-1",
      "resource-1",
      "2026-10-01T10:00:00Z",
      "2026-10-01T11:00:00Z",
      baseLogger,
    );

    assertEquals(res.result.available, true);
  },
});
