import { IRepository } from "./interfaces.ts";
import { AvailabilityError, ValidationError } from "./errors.ts";
import { Logger } from "./logger.ts";

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
    const hasOverlap = await this.repo.checkOverlap(resourceId, tenantId, startTime, endTime, logger);
    logger.info({ available: !hasOverlap }, "Availability check result");
    return { result: { available: !hasOverlap } };
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
  }, logger: Logger) {
    logger.info({ phone: args.phone, time: args.start_time, location: args.location }, "Starting booking flow");
    
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
      location: args.location
    }, logger);

    if (!bookingResult.success) {
      logger.warn({ error: bookingResult.error_message }, "Booking failed due to conflict");
      throw new AvailabilityError(bookingResult.error_message);
    }

    logger.info({ appointmentId: bookingResult.appointment_id }, "Booking successful");
    return { result: bookingResult };
  }
}
