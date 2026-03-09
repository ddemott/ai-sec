// @ts-nocheck
import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { AISecretaryService } from "./service.ts";
import type { IRepository } from "./interfaces.ts";
import { ValidationError } from "./errors.ts";
import { baseLogger } from "./logger.ts";

class FakeRepo implements IRepository {
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
    // no-op for tests
  }
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
