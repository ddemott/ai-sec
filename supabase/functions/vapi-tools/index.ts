import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { PostgresRepository } from "./db/repository.ts";
import { AISecretaryService } from "./core/service.ts";
import { DomainError } from "./core/errors.ts";
import { createLogger } from "./core/logger.ts";
import { Dispatcher } from "./core/dispatcher.ts";
import { createGetEmbedding } from "../../../shared/getEmbedding.ts";
import { createNormalizer } from "../../../shared/normalizeForEmbedding.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const getEmbedding = createGetEmbedding(OPENAI_API_KEY);
const normalizeForEmbedding = createNormalizer(OPENAI_API_KEY);

export const repo = new PostgresRepository();
const service = new AISecretaryService(repo);
const dispatcher = new Dispatcher(service, getEmbedding, normalizeForEmbedding);

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
  description: z.string().default("Booking via SecretaryHQ"),
  call_id: z.string().min(1),
  location: z.string().optional(),
  employee_id: z.string().or(z.number()).optional().transform(v => v?.toString())
});

const GetPolicyAnswerSchema = z.object({
  tenant_id: z.string().uuid(),
  question: z.string().min(1)
});

const GetServiceCatalogSchema = z.object({
  tenant_id: z.string().uuid()
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

    // Validate tool-call arguments at the entry point (single validation pass — BUG-044)
    if (message.type === "tool-calls" && message.toolCalls?.length > 0) {
      const toolCall = message.toolCalls[0];
      const { name, arguments: argsString } = toolCall.function;

      let args;
      try {
        args = JSON.parse(argsString);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON in arguments" }), { status: 400 });
      }

      // Validate with Zod — typed args are passed to dispatcher via toolCall
      if (name === "get_customer_context") GetContextSchema.parse(args);
      if (name === "check_availability") CheckAvailabilitySchema.parse(args);
      if (name === "book_appointment") BookAppointmentSchema.parse(args);
      if (name === "get_company_policy_answer") GetPolicyAnswerSchema.parse(args);
      if (name === "get_service_catalog") GetServiceCatalogSchema.parse(args);

      // Store parsed args back so dispatcher doesn't re-parse
      toolCall.function.parsedArgs = args;
    }

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
