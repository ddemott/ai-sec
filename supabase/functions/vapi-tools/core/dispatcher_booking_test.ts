// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { Dispatcher } from "./dispatcher.ts";
import { baseLogger } from "./logger.ts";

class FakeService {
  public lastCall: any = null;

  async bookWithScheduling(args: any, _logger: any) {
    this.lastCall = args;
    return { result: { success: true, appointment_id: "appt-123", option: { resourceId: "suzy" } } };
  }
}

Deno.test({
  name: "Dispatcher routes book_with_scheduling to service.bookWithScheduling",
  sanitizeOps: false,
  async fn() {
    const fakeService = new FakeService();
    const dispatcher = new Dispatcher(fakeService as any);

    const message = {
      type: "tool-calls",
      toolCalls: [
        {
          function: {
            name: "book_with_scheduling",
            arguments: JSON.stringify({
              tenant_id: "tenant-1",
              call_id: "call-123",
              phone: "+15555550123",
              name: "Caller",
              description: "Haircut",
              location: "Main St",
              requirements: {
                serviceType: "haircut",
                requiredResourceCapabilities: ["cut"],
                preferredResourceId: "suzy",
              },
              window: {
                from: "2026-06-01T10:00:00Z",
                to: "2026-06-01T11:00:00Z",
              },
            }),
          },
        },
      ],
    };

    const response = await dispatcher.dispatch(message, baseLogger);
    const body = await response.json();

    // Response is passed through from the service
    assertEquals(body, { result: { success: true, appointment_id: "appt-123", option: { resourceId: "suzy" } } });

    // Dispatcher passed correct args and converted window to Dates
    assertEquals(fakeService.lastCall.tenant_id, "tenant-1");
    assertEquals(fakeService.lastCall.phone, "+15555550123");
    assertEquals(fakeService.lastCall.requirements.serviceType, "haircut");
    assertEquals(fakeService.lastCall.window.from instanceof Date, true);
    assertEquals(fakeService.lastCall.window.to instanceof Date, true);
  },
});
