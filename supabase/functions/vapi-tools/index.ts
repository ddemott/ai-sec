import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { PostgresRepository } from "./db/repository.ts";
import { AISecretaryService } from "./core/service.ts";
import { DomainError } from "./core/errors.ts";
import { createLogger } from "./core/logger.ts";
import { Dispatcher } from "./core/dispatcher.ts";
import { createGetEmbedding } from "../../../shared/getEmbedding.ts";
import { createNormalizer } from "../../../shared/normalizeForEmbedding.ts";

// --- Environment Validation ---
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const VAPI_SECRET = Deno.env.get("VAPI_SERVER_URL_SECRET") || "unset";
const DB_URL = Deno.env.get("DATABASE_URL") || "";

if (!OPENAI_API_KEY) console.warn("WARNING: OPENAI_API_KEY not set — embeddings and normalization will fail");
if (!DB_URL) console.warn("WARNING: No database URL configured — all DB operations will fail");
if (VAPI_SECRET === "unset") console.warn("WARNING: VAPI_SERVER_URL_SECRET not set — webhook auth disabled");

const getEmbedding = createGetEmbedding(OPENAI_API_KEY);
const normalizeForEmbedding = createNormalizer(OPENAI_API_KEY);

export const repo = new PostgresRepository();
const service = new AISecretaryService(repo);
const dispatcher = new Dispatcher(service, getEmbedding, normalizeForEmbedding);

// Validation Schemas
const GetContextSchema = z.object({
  phone: z.string().min(5),
  tenant_id: z.string().uuid()
});

const CheckAvailabilitySchema = z.object({
  tenant_id: z.string().uuid(),
  resource_id: z.string().uuid(),
  start_time: z.string(),
  end_time: z.string()
});

const BookAppointmentSchema = z.object({
  tenant_id: z.string().uuid(),
  resource_id: z.string().uuid(),
  phone: z.string().default(""),
  name: z.string().optional(),
  start_time: z.string(),
  end_time: z.string(),
  description: z.string().default("Booking via SecretaryHQ"),
  call_id: z.string().default(""),
  location: z.string().optional(),
  employee_id: z.string().or(z.number()).optional().transform(v => v?.toString())
});

const GetPolicyAnswerSchema = z.object({
  tenant_id: z.string().uuid(),
  question: z.string().min(1)
});

const GetSchedulingOptionsSchema = z.object({
  tenant_id: z.string().uuid(),
  requirements: z.object({
    serviceType: z.string().min(1),
    requiredResourceCapabilities: z.array(z.string()).optional(),
    requiredEmployeeSkills: z.array(z.string()).optional(),
  }),
  window: z.object({
    from: z.string(),
    to: z.string(),
  }),
});

const BookWithSchedulingSchema = z.object({
  tenant_id: z.string().uuid(),
  phone: z.string().default(""),
  name: z.string().optional(),
  description: z.string().default("Booking via SecretaryHQ"),
  call_id: z.string().default(""),
  location: z.string().optional(),
  requirements: z.object({
    serviceType: z.string().min(1),
    requiredResourceCapabilities: z.array(z.string()).optional(),
    requiredEmployeeSkills: z.array(z.string()).optional(),
    preferredResourceId: z.string().optional(),
  }),
  window: z.object({
    from: z.string(),
    to: z.string(),
  }),
});

const GetServiceCatalogSchema = z.object({
  tenant_id: z.string().uuid()
});

/** Create a JSON response with correlation headers for tracing */
function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
  });
}

export async function handler(req: Request): Promise<Response> {
  const { method, headers } = req;
  const requestId = headers.get("x-request-id") || crypto.randomUUID();

  if (method === "OPTIONS") return new Response("ok", { status: 200 });

  // SECURITY: Verify webhook secret
  const incomingSecret = headers.get("x-vapi-secret");
  if (VAPI_SECRET !== "unset" && incomingSecret !== VAPI_SECRET) {
    console.error(JSON.stringify({
      event: "unauthorized_request",
      requestId,
      incomingSecret: incomingSecret ? `${incomingSecret.slice(0, 8)}...` : null,
      timestamp: new Date().toISOString(),
    }));
    return jsonResponse({ error: "Unauthorized" }, 401, requestId);
  }

  // Track toolCallId outside try/catch so error handler can build Vapi-compatible responses
  let toolCallId: string | undefined;

  try {
    const body = await req.json();
    const { message } = body;

    // Log the full request for debugging live call issues
    console.error(JSON.stringify({
      event: "vapi_webhook_received",
      requestId,
      messageType: message?.type,
      toolCallName: message?.toolCalls?.[0]?.function?.name,
      toolCallId: message?.toolCalls?.[0]?.id,
      callId: message?.call?.id,
      customerNumber: message?.call?.customer?.number,
      timestamp: new Date().toISOString(),
    }));

    // Capture toolCallId early for error responses
    toolCallId = message?.toolCalls?.[0]?.id;

    // Create a base logger for this request
    const logger = createLogger({ requestId });

    if (!message || !message.type) {
        return jsonResponse({ result: { success: false, error: "Invalid message format" } }, 200, requestId);
    }

    // Validate tool-call arguments at the entry point (single validation pass — BUG-044)
    if (message.type === "tool-calls" && message.toolCalls?.length > 0) {
      const toolCall = message.toolCalls[0];
      const { name, arguments: argsString } = toolCall.function;

      let args;
      try {
        // Vapi may send arguments as a string (needs parsing) or as an object (already parsed)
        args = typeof argsString === "string" ? JSON.parse(argsString) : argsString;
      } catch (e) {
        console.error(JSON.stringify({
          event: "json_parse_failed",
          requestId,
          argsType: typeof argsString,
          argsPreview: String(argsString).slice(0, 300),
          timestamp: new Date().toISOString(),
        }));
        return jsonResponse({ results: [{ toolCallId, result: "Sorry, there was an issue processing that request. Could you try again?" }] }, 200, requestId);
      }

      // Validate with Zod — typed args are passed to dispatcher via toolCall
      const schemas: Record<string, z.ZodType> = {
        get_customer_context: GetContextSchema,
        check_availability: CheckAvailabilitySchema,
        book_appointment: BookAppointmentSchema,
        get_company_policy_answer: GetPolicyAnswerSchema,
        get_service_catalog: GetServiceCatalogSchema,
        get_scheduling_options: GetSchedulingOptionsSchema,
        book_with_scheduling: BookWithSchedulingSchema,
      };
      const schema = schemas[name];
      if (schema) {
        args = schema.parse(args);
      }

      // Store parsed args back so dispatcher doesn't re-parse
      toolCall.function.parsedArgs = args;
    }

    const response = await dispatcher.dispatch(message, logger);

    // Log the response for debugging
    const responseBody = await response.clone().text();
    console.error(JSON.stringify({
      event: "vapi_webhook_response",
      requestId,
      status: response.status,
      bodyLength: responseBody.length,
      bodyPreview: responseBody.slice(0, 300),
      timestamp: new Date().toISOString(),
    }));

    return response;

  } catch (e) {
    const err = e as Error;

    const vapiError = (errorMsg: string) => {
      if (toolCallId) {
        // Plain conversational string so the LLM relays it naturally to the caller
        return jsonResponse({ results: [{ toolCallId, result: errorMsg }] }, 200, requestId);
      }
      return jsonResponse({ result: { success: false, error: errorMsg } }, 200, requestId);
    };

    if (err instanceof z.ZodError) {
      return vapiError(`Validation failed: ${err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }

    if (err instanceof DomainError) {
      return vapiError(err.message);
    }

    console.error(JSON.stringify({
      event: "edge_function_critical_error",
      requestId,
      error_message: err.message,
      error_name: err.name,
      error_stack: err.stack?.split('\n').slice(0, 5).join('\n'),
      timestamp: new Date().toISOString(),
    }));
    return vapiError("Internal server error");
  }
}

Deno.serve(handler);
