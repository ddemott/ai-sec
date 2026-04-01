import { Logger } from "./logger.ts";
import { AISecretaryService } from "./service.ts";

export type MessageHandler = (message: any, logger: Logger) => Promise<Response>;

/**
 * Normalize and validate a phone number.
 * - 10 digits → prepend +1 (US number without country code)
 * - 11+ digits starting with 1 → prepend +
 * - Already has + → use as-is
 * Returns null if invalid (fewer than 10 digits).
 */
function normalizePhone(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
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
          break;
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
        default:
          return this.vapiToolResponse(toolCallId, `ERROR: Unknown tool ${name}.`);
      }

      // Extract the result value — service methods return { result: ... }
      const resultValue = response?.result ?? response;
      return this.vapiToolResponse(toolCallId, resultValue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      toolLogger.error({ err: error }, `Tool ${name} failed`);
      // Return error as plain conversational string so the LLM relays it naturally
      return this.vapiToolResponse(toolCallId, error.message);
    }
  }

  private async handleCallStarted(message: any, logger: Logger): Promise<Response> {
    logger.info({ callId: message.call?.id }, "Call started event received");

    // Capture caller phone from the call object — this is the ONLY place Vapi sends it
    const phone = message.call?.customer?.number || message.call?.phoneNumber || "";
    if (phone) {
      this.callerPhone = normalizePhone(phone) || phone;
      logger.info({ callerPhone: this.callerPhone }, "Caller phone captured from call-started");
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
    logger.info({ callId: message.call.id, reason: message.call.endedReason }, "Call ended event received");
    return new Response(null, { status: 200 });
  }
}
