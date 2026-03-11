import { IRepository } from "./interfaces.ts";
import { AvailabilityError, ValidationError } from "./errors.ts";
import { Logger } from "./logger.ts";
import { selectAssignments, type ServiceRequirements, type TimeWindow, type AssignmentOption } from "./scheduling.ts";

export class AISecretaryService {
  private repo: IRepository;

  constructor(repo: IRepository) {
    this.repo = repo;
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
  ): Promise<{ result: { options: AssignmentOption[] } }> {
    logger.info({ tenantId, requirements, window }, "Computing scheduling options");

    const [resources, employees, existing] = await Promise.all([
      this.repo.getSchedulingResources(tenantId, logger),
      this.repo.getSchedulingEmployees(tenantId, logger),
      this.repo.getExistingAppointments(tenantId, window, logger),
    ]);

    const options = selectAssignments({
      requirements,
      window,
      resources,
      employees,
      existingAppointments: existing,
    });

    logger.info({ optionCount: options.length }, "Scheduling options computed");
    return { result: { options } };
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
   * Experimental: booking flow driven by selector-derived options.
   * Uses getSchedulingOptions to choose the first viable assignment
   * and then calls bookAtomic. Currently only used in unit tests
   * with fake repositories.
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
    logger.info({ tenantId: args.tenant_id, requirements: args.requirements, window: args.window }, "Starting selector-driven booking");

    const optionsResult = await this.getSchedulingOptions(args.tenant_id, args.requirements, args.window, logger);
    const options = optionsResult.result.options;

    if (!options.length) {
      logger.warn({ tenantId: args.tenant_id }, "No scheduling options available");
      throw new AvailabilityError("No available scheduling options");
    }

    const chosen = options[0];

    let customer = await this.repo.findCustomerByPhone(args.tenant_id, args.phone, logger);
    let customerId = customer?.id;

    if (!customerId) {
      customerId = await this.repo.createCustomer(args.tenant_id, args.phone, args.name || "Valued Customer", logger);
    }

    const bookingResult = await this.repo.bookAtomic({
      tenantId: args.tenant_id,
      resourceId: chosen.resourceId,
      customerId,
      startTime: args.window.from.toISOString(),
      endTime: args.window.to.toISOString(),
      description: args.description,
      callId: args.call_id,
      location: args.location,
      employeeId: chosen.employeeId,
    }, logger);

    if (!bookingResult.success) {
      logger.warn({ error: bookingResult.error_message }, "Selector booking failed due to conflict");
      throw new AvailabilityError(bookingResult.error_message);
    }

    logger.info({ appointmentId: bookingResult.appointment_id }, "Selector booking successful");
    return { result: { ...bookingResult, option: chosen } };
  }
}
