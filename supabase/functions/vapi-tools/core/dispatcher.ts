import { Logger } from "./logger.ts";
import { AISecretaryService } from "./service.ts";

export type MessageHandler = (message: any, logger: Logger) => Promise<Response>;

/**
 * Normalize and validate a phone number.
 * - 10 digits → prepend +1 (US number without country code)
 * - 11+ digits starting with 1 → prepend +
 * - Already has + → use as-is
 * Returns null if invalid (fewer than 10 digits).
 * 
 * FIXED 2026-04-01: Added length validation to prevent "+1" from being accepted
 */
function normalizePhone(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  
  // CRITICAL: Reject if too short (less than 10 digits)
  // Prevents "+1" or "1" from being treated as valid
  if (digits.length < 10) return null;
  
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return phone.startsWith("+") ? phone : `+${digits}`;
  return null;
}

function isValidPhone(phone: string | undefined | null): boolean {
  return normalizePhone(phone) !== null;
}

/**
 * If a datetime string has no timezone indicator (Z or +/-offset),
 * assume it's Central Time and append the offset.
 * CDT = -05:00, CST = -06:00. We use -05:00 (CDT) for summer months as a reasonable default.
 */
function assumeCentralTime(dt: string): string {
  if (!dt) return dt;
  // Already has timezone info
  if (/Z$/i.test(dt) || /[+-]\d{2}:\d{2}$/.test(dt) || /[+-]\d{4}$/.test(dt)) return dt;
  // Naive datetime — assume Central Time (CDT -05:00 Mar-Nov, CST -06:00 Nov-Mar)
  // Parse month to decide offset
  const match = dt.match(/^\d{4}-(\d{2})/);
  if (match) {
    const month = parseInt(match[1]);
    const offset = (month >= 3 && month <= 10) ? "-05:00" : "-06:00";
    return dt + offset;
  }
  return dt + "-05:00";
}

/**
 * Dispatches Vapi server messages to the appropriate logic handlers.
 */
export class Dispatcher {
  private handlers: Map<string, MessageHandler> = new Map();
  private service: AISecretaryService;
  private getEmbedding: (text: string) => Promise<number[]>;
  private normalizeForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>;
  /** Caller phone captured from call-started event, used for tool calls where Vapi doesn't send it */
  private callerPhone: string = "";

  constructor(
    service: AISecretaryService,
    getEmbedding: (text: string) => Promise<number[]>,
    normalizeForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>
  ) {
    this.service = service;
    this.getEmbedding = getEmbedding;
    this.normalizeForEmbedding = normalizeForEmbedding;
    this.registerDefaults();
  }

  private registerDefaults() {
    this.handlers.set("tool-calls", this.handleToolCall.bind(this));
    this.handlers.set("call-started", this.handleCallStarted.bind(this));
    this.handlers.set("end-of-call-report", this.handleCallEnded.bind(this));
  }

  async dispatch(message: any, logger: Logger): Promise<Response> {
    const handler = this.handlers.get(message.type);
    if (handler) {
      return await handler(message, logger);
    }
    return new Response(null, { status: 200 }); // Default 200 for unhandled types
  }

  /**
   * Wrap a tool result in the Vapi-expected format.
   * Vapi requires { results: [{ toolCallId, result: string }] }
   */
  private vapiToolResponse(toolCallId: string, result: unknown): Response {
    const resultStr = typeof result === "string" ? result : JSON.stringify(result);
    return new Response(JSON.stringify({
      results: [{
        toolCallId,
        result: resultStr,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  private async handleToolCall(message: any, logger: Logger): Promise<Response> {
    if (!message.toolCalls || message.toolCalls.length === 0) {
      return new Response(JSON.stringify({ error: "No tool calls provided" }), { status: 400 });
    }

    const toolCall = message.toolCalls[0];
    if (!toolCall?.function) {
      return new Response(JSON.stringify({ error: "Malformed tool call — missing function" }), { status: 400 });
    }
    const toolCallId = toolCall.id;
    const { name, arguments: argsString, parsedArgs } = toolCall.function;

    // Use pre-parsed args from entry-point validation when available (BUG-044)
    let args = parsedArgs;
    if (!args) {
      try {
        args = JSON.parse(argsString);
      } catch (e) {
        return this.vapiToolResponse(toolCallId, "ERROR: Invalid arguments provided.");
      }
    }

    // Create a specific logger for this tool execution
    const toolLogger = logger.child({ tenantId: args.tenant_id, callId: args.call_id, tool: name });

    toolLogger.info({
      storedCallerPhone: this.callerPhone,
      argsPhone: args.phone,
    }, "Phone number sources");

    try {
      let response;
      switch (name) {
        case "get_customer_context": {
          const inboundPhone = message.call?.phoneNumber;
          response = await this.service.getCustomerContextWithRouting(
            args.phone,
            toolLogger,
            inboundPhone,
            args.tenant_id
          );
          break;
        }
        case "check_availability":
          response = await this.service.checkAvailability(args.tenant_id, args.resource_id, args.start_time, args.end_time, toolLogger);
          break;
        case "book_appointment": {
          response = await this.service.bookAppointment({
            ...args,
            phone: this.callerPhone || normalizePhone(args.phone) || args.phone || "",
            call_id: args.call_id || message.call?.id || "",
            employee_id: args.employee_id
          }, toolLogger);
          break;
        }
        case "get_scheduling_options": {
          const window = {
            from: new Date(assumeCentralTime(args.window.from)),
            to: new Date(assumeCentralTime(args.window.to)),
          };
          response = await this.service.getSchedulingOptions(
            args.tenant_id,
            args.requirements,
            window,
            toolLogger,
          );
          break;
        }
        case "book_with_scheduling": {
          const window = {
            from: new Date(assumeCentralTime(args.window.from)),
            to: new Date(assumeCentralTime(args.window.to)),
          };
          // Use phone captured from call-started event, fall back to LLM arg
          // Vapi does NOT send customer info in tool-call messages — only in call-started
          const phoneToUse = this.callerPhone || normalizePhone(args.phone) || args.phone || "";
          
          // VALIDATE phone before booking (prevent "+1" or empty phone from being stored)
          if (!phoneToUse || !isValidPhone(phoneToUse)) {
            toolLogger.warn({ 
              callerPhone: this.callerPhone, 
              argsPhone: args.phone,
              phoneToUse 
            }, "❌ Cannot book - no valid phone number available");
            
            return this.vapiToolResponse(
              toolCallId,
              "I'm sorry, I'm having trouble identifying your phone number. Could you please call back?"
            );
          }
          
          response = await this.service.bookWithScheduling(
            {
              tenant_id: args.tenant_id,
              phone: phoneToUse,
              name: args.name,
              description: args.description,
              call_id: args.call_id || message.call?.id || "",
              location: args.location,
              requirements: args.requirements,
              window,
            },
            toolLogger,
          );
          break;
        }
        case "get_company_policy_answer":
          response = await this.service.getCompanyPolicyAnswer(
            args.tenant_id,
            args.question,
            toolLogger,
            this.getEmbedding,
            this.normalizeForEmbedding
          );
          break;
        case "get_service_catalog":
          response = await this.service.getServiceCatalog(args.tenant_id, toolLogger);
          break;
        case "get_available_slots":
          response = await this.service.getAvailableSlots(args.tenant_id, args.service_type, args.date, toolLogger);
          break;
        default:
          return this.vapiToolResponse(toolCallId, `ERROR: Unknown tool ${name}.`);
      }

      // Extract the result value — service methods return { result: ... }
      const resultValue = response?.result ?? response;
      return this.vapiToolResponse(toolCallId, resultValue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      toolLogger.error({ err: error }, `Tool ${name} failed`);
      
      // If it's an AvailabilityError with error code, return structured error
      if (error.name === "AvailabilityError" && "code" in error) {
        return this.vapiToolResponse(toolCallId, {
          success: false,
          error_message: error.message,
          error_code: (error as any).code
        });
      }
      
      // Return error as plain conversational string so the LLM relays it naturally
      return this.vapiToolResponse(toolCallId, error.message);
    }
  }

  private async handleCallStarted(message: any, logger: Logger): Promise<Response> {
    logger.info({ callId: message.call?.id }, "Call started event received");

    // Capture caller phone from the call object — this is the ONLY place Vapi sends it
    const rawPhone = message.call?.customer?.number || message.call?.phoneNumber || "";
    const normalized = normalizePhone(rawPhone);
    
    logger.info({ 
      rawPhone, 
      normalized,
      customerObject: message.call?.customer,
      callObject: message.call
    }, "Phone capture attempt");

    if (normalized) {
      this.callerPhone = normalized;
      logger.info({ callerPhone: this.callerPhone }, "✅ Valid caller phone captured from call-started");
    } else if (rawPhone) {
      logger.warn({ rawPhone }, "⚠️ Invalid phone format received - phone will be empty in bookings");
      this.callerPhone = ""; // Clear invalid phone instead of storing "+1"
    } else {
      logger.warn("⚠️ No phone number received from Vapi");
      this.callerPhone = "";
    }

    // Warm up DB pool while the greeting plays — eliminates cold start on first tool call
    try {
      await this.service.warmUp(logger);
    } catch (err) {
      logger.error({ err }, "Pool warm-up failed (non-fatal)");
    }

    return new Response(null, { status: 200 });
  }

  private async handleCallEnded(message: any, logger: Logger): Promise<Response> {
    logger.info({ callId: message.call?.id, reason: message.call?.endedReason }, "Call ended event received");

    // Link any orphaned transcripts to their customers now that the call is complete
    const tenantId = message.call?.assistantOverrides?.metadata?.tenant_id
      || message.call?.metadata?.tenant_id;
    if (tenantId) {
      try {
        const linked = await this.service.linkOrphanedTranscripts(tenantId, logger);
        if (linked > 0) {
          logger.info({ tenantId, linked }, "Linked orphaned transcripts after call ended");
        }
      } catch (err) {
        logger.error({ err }, "Failed to link orphaned transcripts (non-fatal)");
      }
    }

    return new Response(null, { status: 200 });
  }
}
