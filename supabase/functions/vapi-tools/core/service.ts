import { IRepository } from "./interfaces.ts";
import { AvailabilityError, ValidationError } from "./errors.ts";
import { Logger } from "./logger.ts";
import { selectAssignments, type ServiceRequirements, type TimeWindow, type AssignmentOption, type SchedulingDiagnostics } from "./scheduling.ts";

export class AISecretaryService {
  private repo: IRepository;

  constructor(repo: IRepository) {
    this.repo = repo;
  }

  /**
   * Warm up the DB connection pool. Called on call-start event
   * so the pool is ready before the first tool call.
   */
  async warmUp(logger: Logger): Promise<void> {
    logger.info("Warming up DB pool");
    await this.repo.ping();
    logger.info("DB pool warm");
  }

  /**
   * Enhanced context lookup that detects the tenant based on the inbound phone number
   * if tenantId is not provided.
   */
  async getCustomerContextWithRouting(
    phone: string, 
    logger: Logger, 
    inboundPhone?: string, 
    explicitTenantId?: string
  ) {
    let tenantId = explicitTenantId;

    // 1. Route based on phone number if tenantId isn't known
    if (!tenantId && inboundPhone) {
      const tenant = await this.repo.findTenantByPhone(inboundPhone, logger);
      if (tenant) {
        tenantId = tenant.id;
        logger.info({ tenantId, tenantName: tenant.name }, "Auto-routed call to tenant");
      }
    }

    if (!tenantId) {
      logger.error({ inboundPhone }, "Could not resolve tenant for call");
      return { result: "Service temporarily unavailable. Please try again later." };
    }

    // 2. Proceed with normal context lookup
    return this.getCustomerContext(phone, tenantId, logger);
  }

  async getCustomerContext(phone: string, tenantId: string, logger: Logger) {
    logger.info({ phone, tenantId }, "Getting customer context");
    const customer = await this.repo.findCustomerByPhone(tenantId, phone, logger);
    if (!customer) {
        logger.info({ phone }, "Customer not found in CRM");
        return { result: "New caller - no history found." };
    }

    const summaries = await this.repo.getRecentSummaries(customer.id, tenantId, logger);
    logger.info({ customerId: customer.id, summaryCount: summaries.length }, "Retrieved customer history");
    
    return {
      result: {
        name: customer.name || "Unknown",
        history: summaries.map((s) => s.summary).join("; ") || "No history"
      }
    };
  }

  async checkAvailability(tenantId: string, resourceId: string, startTime: string, endTime: string, logger: Logger) {
    logger.info({ resourceId, startTime, endTime }, "Checking availability");
    if (isNaN(Date.parse(startTime)) || isNaN(Date.parse(endTime))) {
      logger.warn({ startTime, endTime }, "Invalid date format provided");
      throw new ValidationError("Invalid date format provided for availability check.");
    }
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (end <= start) {
      logger.warn({ startTime, endTime }, "End time is not after start time");
      throw new ValidationError("End time must be after start time.");
    }
    const hasOverlap = await this.repo.checkOverlap(resourceId, tenantId, startTime, endTime, logger);
    logger.info({ available: !hasOverlap }, "Availability check result");
    return { result: { available: !hasOverlap } };
  }

  /**
   * Pure-selector based scheduling helper: given a tenant, service
   * requirements, and a time window, compute all valid
   * (resource, employee?) assignment options using IRepository
   * primitives. This is not yet wired to Vapi tools, but exercised
   * via unit tests with an in-memory IRepository implementation.
   */
  async getSchedulingOptions(
    tenantId: string,
    requirements: ServiceRequirements,
    window: TimeWindow,
    logger: Logger,
  ): Promise<{ result: { options: AssignmentOption[]; diagnostics: SchedulingDiagnostics } }> {
    logger.info({ tenantId, requirements, window }, "Computing scheduling options");

    const [resources, employees, shifts, existing] = await Promise.all([
      this.repo.getSchedulingResources(tenantId, logger),
      this.repo.getSchedulingEmployees(tenantId, logger),
      this.repo.getEmployeeShifts(tenantId, logger),
      this.repo.getExistingAppointments(tenantId, window, logger),
    ]);

    const { options, diagnostics } = selectAssignments({
      requirements,
      window,
      resources,
      employees,
      shifts,
      existingAppointments: existing,
    });

    logger.info({ optionCount: options.length, diagnostics }, "Scheduling options computed");
    return { result: { options, diagnostics } };
  }

  async bookAppointment(args: {
    tenant_id: string;
    resource_id: string;
    phone: string;
    name?: string;
    start_time: string;
    end_time: string;
    description: string;
    call_id: string;
    location?: string;
    employee_id?: string;
  }, logger: Logger) {
    logger.info({ phone: args.phone, time: args.start_time, location: args.location, employee_id: args.employee_id }, "Starting booking flow");
    
    let customer = await this.repo.findCustomerByPhone(args.tenant_id, args.phone, logger);
    let customerId = customer?.id;

    if (!customerId) {
      logger.info({ phone: args.phone }, "Creating new customer record for booking");
      customerId = await this.repo.createCustomer(args.tenant_id, args.phone, args.name || "Valued Customer", logger);
    }

    const bookingResult = await this.repo.bookAtomic({
      tenantId: args.tenant_id,
      resourceId: args.resource_id,
      customerId,
      startTime: args.start_time,
      endTime: args.end_time,
      description: args.description,
      callId: args.call_id,
      location: args.location,
      employeeId: args.employee_id
    }, logger);

    if (!bookingResult.success) {
      logger.warn({ error: bookingResult.error_message }, "Booking failed due to conflict");
      throw new AvailabilityError(bookingResult.error_message);
    }

    logger.info({ appointmentId: bookingResult.appointment_id }, "Booking successful");
    return { result: bookingResult };
  }

  /**
   * Single-query booking: finds best resource/employee and books in one DB round trip.
   * Uses book_with_scheduling_atomic() RPC — customer upsert, skill/shift matching,
   * conflict checking, and appointment insert all in one transaction.
   */
  async bookWithScheduling(args: {
    tenant_id: string;
    phone: string;
    name?: string;
    description: string;
    call_id: string;
    location?: string;
    requirements: ServiceRequirements;
    window: TimeWindow;
  }, logger: Logger) {
    logger.info({ tenantId: args.tenant_id, requirements: args.requirements, window: args.window }, "Starting atomic scheduling booking");

    const result = await this.repo.bookWithSchedulingAtomic({
      tenantId: args.tenant_id,
      phone: args.phone,
      customerName: args.name,
      description: args.description,
      callId: args.call_id,
      location: args.location,
      windowFrom: args.window.from.toISOString(),
      windowTo: args.window.to.toISOString(),
      requiredSkills: args.requirements.requiredEmployeeSkills,
      requiredCapabilities: args.requirements.requiredResourceCapabilities,
      preferredResourceId: args.requirements.preferredResourceId || undefined,
      serviceType: args.requirements.serviceType,
    }, logger);

    if (!result.success) {
      logger.warn({ error: result.error_message, code: result.error_code }, "Atomic booking failed");
      throw new AvailabilityError(
        result.error_message || "No available scheduling options",
        result.error_code || "NO_AVAILABILITY"
      );
    }

    logger.info({
      appointmentId: result.appointment_id,
      resource: result.resource_name,
      employee: result.employee_name,
    }, "Atomic booking successful");

    return {
      result: {
        success: true,
        appointment_id: result.appointment_id,
        resource_name: result.resource_name,
        employee_name: result.employee_name,
        booked_start: result.booked_start,
        booked_end: result.booked_end,
        error_message: null,
      }
    };
  }

  /**
   * Performs semantic search to answer business policy/FAQ questions.
   */
  async getCompanyPolicyAnswer(
    tenantId: string,
    question: string,
    logger: Logger,
    getEmbedding: (text: string) => Promise<number[]>,
    normalizeForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>
  ) {
    logger.info({ tenantId, question }, "Answering company policy question");

    // 1. Normalize query to semantic core, then generate embedding (Phase 12E)
    let normalizedQuestion = question;
    if (normalizeForEmbedding) {
      try {
        normalizedQuestion = await normalizeForEmbedding(question, { context: 'customer phone inquiry' });
      } catch (err) {
        logger.warn({ err }, "Normalization failed, falling back to raw question");
      }
    }
    logger.info({ normalizedQuestion }, "Query for embedding");
    const embedding = await getEmbedding(normalizedQuestion);

    // 2. Search knowledge base
    const matches = await this.repo.searchKnowledgeBase(tenantId, embedding, logger);

    if (matches.length === 0) {
      logger.info("No knowledge base matches found");
      return { 
        result: "I'm sorry, I don't have information on that specific topic. Let me check with the team for you." 
      };
    }

    // 3. Combine results into a context string for the LLM
    const context = matches.map(m => m.content).join("\n\n---\n\n");
    logger.info({ matchCount: matches.length }, "Knowledge base search successful");

    return { result: context };
  }

  /**
   * Layer 1: Database facts — returns the service catalog for a tenant.
   * No RAG, no hallucination possible. The AI reads these details to callers.
   */
  async getServiceCatalog(tenantId: string, logger: Logger) {
    logger.info({ tenantId }, "Fetching service catalog");
    const services = await this.repo.getServiceCatalog(tenantId, logger);
    if (services.length === 0) {
      return { result: "This business has not configured their service catalog yet." };
    }
    const formatted = services.map(s => {
      const parts = [s.name];
      if (s.subtitle) parts.push(`— ${s.subtitle}`);
      if (s.description) parts.push(s.description);
      parts.push(`Duration: ${s.duration_minutes} minutes`);
      if (s.price && Number(s.price) > 0) parts.push(`Price: $${Number(s.price).toFixed(2)}`);
      return parts.join(". ");
    }).join("\n");
    logger.info({ serviceCount: services.length }, "Service catalog returned");
    return { result: formatted };
  }
}
