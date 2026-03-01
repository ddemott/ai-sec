import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { PostgresRepository } from "./db/repository.ts";
import { AISecretaryService } from "./core/service.ts";
import { DomainError } from "./core/errors.ts";
import { createLogger } from "./core/logger.ts";
import { Dispatcher } from "./core/dispatcher.ts";

const repo = new PostgresRepository();
const service = new AISecretaryService(repo);
const dispatcher = new Dispatcher(service);

const VAPI_SECRET = Deno.env.get("VAPI_SERVER_URL_SECRET") || "unset";

// Validation Schemas
const GetContextSchema = z.object({
  phone: z.string().min(5),
  tenant_id: z.string().uuid()
});

const CheckAvailabilitySchema = z.object({
  tenant_id: z.string().uuid(),
  resource_id: z.string().uuid(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime()
});

const BookAppointmentSchema = z.object({
  tenant_id: z.string().uuid(),
  resource_id: z.string().uuid(),
  phone: z.string().min(5),
  name: z.string().optional(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  description: z.string().default("Booking via AI Secretary"),
  call_id: z.string().min(1),
  location: z.string().optional() // New field
});

export async function handler(req: Request): Promise<Response> {
  const { method, headers } = req;
  const requestId = crypto.randomUUID();
  
  if (method === "OPTIONS") return new Response("ok", { status: 200 });

  // SECURITY: Verify webhook secret
  const incomingSecret = headers.get("x-vapi-secret");
  if (VAPI_SECRET !== "unset" && incomingSecret !== VAPI_SECRET) {
    console.warn(`[UNAUTHORIZED] Request ID: ${requestId}`);
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const body = await req.json();
    const { message } = body;

    // Create a base logger for this request
    const logger = createLogger({ requestId });

    if (!message || !message.type) {
        return new Response(JSON.stringify({ error: "Invalid message format" }), { status: 400 });
    }

    // Since schemas are here in index.ts for now, the dispatcher needs to handle the logic
    // or we move schemas to core. For now, let's keep it simple.
    return await dispatcher.dispatch(message, logger);

  } catch (e) {
    const err = e as Error;
    if (err instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: "Validation failed", details: err.errors }), { status: 400 });
    }
    
    if (err instanceof DomainError) {
      return new Response(JSON.stringify({ result: { success: false, error: err.message } }), { status: 200 });
    }

    console.error(`[CRITICAL ERROR ${requestId}]`, err.message);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 });
  }
}
