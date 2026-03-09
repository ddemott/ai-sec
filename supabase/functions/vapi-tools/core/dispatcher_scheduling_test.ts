// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { Dispatcher } from "./dispatcher.ts";
import { baseLogger } from "./logger.ts";

class FakeService {
  public lastCall: any = null;

  async getSchedulingOptions(tenantId: string, requirements: any, window: any, _logger: any) {
    this.lastCall = { tenantId, requirements, window };
    return { result: { options: [{ resourceId: "suzy" }] } };
  }
}

Deno.test({
  name: "Dispatcher routes get_scheduling_options to service.getSchedulingOptions",
  sanitizeOps: false,
  async fn() {
    const fakeService = new FakeService();
    const dispatcher = new Dispatcher(fakeService as any);

    const message = {
      type: "tool-calls",
      toolCalls: [
        {
          function: {
            name: "get_scheduling_options",
            arguments: JSON.stringify({
              tenant_id: "tenant-1",
              call_id: "call-123",
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
    assertEquals(body, { result: { options: [{ resourceId: "suzy" }] } });

    // Dispatcher converted window strings to Date objects
    assertEquals(fakeService.lastCall.tenantId, "tenant-1");
    assertEquals(fakeService.lastCall.requirements.serviceType, "haircut");
    assertEquals(fakeService.lastCall.window.from instanceof Date, true);
    assertEquals(fakeService.lastCall.window.to instanceof Date, true);
  },
});
