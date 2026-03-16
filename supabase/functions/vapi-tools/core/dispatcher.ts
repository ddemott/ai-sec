import { Logger } from "./logger.ts";
import { AISecretaryService } from "./service.ts";

export type MessageHandler = (message: any, logger: Logger) => Promise<Response>;

/**
 * Dispatches Vapi server messages to the appropriate logic handlers.
 */
export class Dispatcher {
  private handlers: Map<string, MessageHandler> = new Map();
  private service: AISecretaryService;
  private getEmbedding: (text: string) => Promise<number[]>;

  constructor(service: AISecretaryService, getEmbedding: (text: string) => Promise<number[]>) {
    this.service = service;
    this.getEmbedding = getEmbedding;
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

  private async handleToolCall(message: any, logger: Logger): Promise<Response> {
    if (!message.toolCalls || message.toolCalls.length === 0) {
      return new Response(JSON.stringify({ error: "No tool calls provided" }), { status: 400 });
    }

    const toolCall = message.toolCalls[0];
    const { name, arguments: argsString, parsedArgs } = toolCall.function;

    // Use pre-parsed args from entry-point validation when available (BUG-044)
    let args = parsedArgs;
    if (!args) {
      try {
        args = JSON.parse(argsString);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON in arguments" }), { status: 400 });
      }
    }

    // Create a specific logger for this tool execution
    const toolLogger = logger.child({ tenantId: args.tenant_id, callId: args.call_id, tool: name });

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
      case "book_appointment":
        response = await this.service.bookAppointment({
          ...args,
          employee_id: args.employee_id
        }, toolLogger);
        break;
      case "get_scheduling_options": {
        const window = {
          from: new Date(args.window.from),
          to: new Date(args.window.to),
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
          from: new Date(args.window.from),
          to: new Date(args.window.to),
        };
        response = await this.service.bookWithScheduling(
          {
            tenant_id: args.tenant_id,
            phone: args.phone,
            name: args.name,
            description: args.description,
            call_id: args.call_id,
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
          this.getEmbedding
        );
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown tool: ${name}` }), { status: 400 });
    }

    return new Response(JSON.stringify(response), { status: 200 });
  }

  private async handleCallStarted(message: any, logger: Logger): Promise<Response> {
    logger.info({ callId: message.call.id }, "Call started event received");
    return new Response(null, { status: 200 });
  }

  private async handleCallEnded(message: any, logger: Logger): Promise<Response> {
    logger.info({ callId: message.call.id, reason: message.call.endedReason }, "Call ended event received");
    return new Response(null, { status: 200 });
  }
}
