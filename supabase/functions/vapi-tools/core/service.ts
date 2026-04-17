import { IRepository } from "./interfaces.ts";
import { AvailabilityError, ValidationError } from "./errors.ts";
import { Logger } from "./logger.ts";
import { selectAssignments, type ServiceRequirements, type TimeWindow, type AssignmentOption, type SchedulingDiagnostics, type ShiftOverride } from "./scheduling.ts";

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
   * Returns the IANA timezone for a tenant (e.g. "America/Chicago").
   * Falls back to America/Chicago if not set.
   */
  async getTenantTimezone(tenantId: string, logger: Logger): Promise<string> {
    return this.repo.getTenantTimezone(tenantId, logger);
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
    // BUG-031: Use timezone-aware RPC instead of raw overlap check
    const result = await this.repo.checkAvailabilityWithTz(tenantId, resourceId, startTime, endTime, logger);
    logger.info({ available: result.available, timezone: result.tenant_timezone }, "Availability check result");
    return {
      result: {
        available: result.available,
        tenant_timezone: result.tenant_timezone,
        local_start: result.local_start,
        local_end: result.local_end,
      }
    };
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

    // Compute the date string for override lookup
    const dateStr = window.from.toISOString().substring(0, 10);

    const [resources, employees, shifts, existing, effectiveShifts] = await Promise.all([
      this.repo.getSchedulingResources(tenantId, logger),
      this.repo.getSchedulingEmployees(tenantId, logger),
      this.repo.getEmployeeShifts(tenantId, logger),
      this.repo.getExistingAppointments(tenantId, window, logger),
      this.repo.getEffectiveShiftsForDate(tenantId, dateStr, logger),
    ]);

    // Convert effective shifts to ShiftOverride format for the scheduling algorithm
    const shiftOverrides: ShiftOverride[] = effectiveShifts
      .filter(s => s.is_off || (s.start_time && s.end_time))
      .map(s => ({
        employee_id: s.employee_id,
        shift_date: dateStr,
        start_time: s.start_time,
        end_time: s.end_time,
        is_off: s.is_off,
      }));

    const { options, diagnostics } = selectAssignments({
      requirements,
      window,
      resources,
      employees,
      shifts,
      shiftOverrides,
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
   * When the knowledge base has no answer, logs the unanswered question
   * and returns a helpful response offering to take a message for the owner.
   */
  async getCompanyPolicyAnswer(
    tenantId: string,
    question: string,
    logger: Logger,
    getEmbedding: (text: string) => Promise<number[]>,
    normalizeForEmbedding?: (text: string, options?: { context?: string }) => Promise<string>,
    callerContext?: { phone?: string; callId?: string }
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
      logger.info({ question }, "No knowledge base matches — logging unanswered question");

      // Log the unanswered question so the owner can see KB gaps
      try {
        await this.repo.logUnansweredQuestion(
          tenantId,
          question,
          callerContext?.phone || null,
          callerContext?.callId || null,
          null,
          logger
        );
      } catch (err) {
        logger.warn({ err }, "Failed to log unanswered question (non-fatal)");
      }

      return {
        result: "I don't have specific information on that topic right now. I'd be happy to take a message so the owner can get back to you, or if there's anything else I can help with — like booking an appointment or answering questions about our services — I'm here for you."
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
  /**
   * Returns available time slots for a specific service on a given date.
   * Includes service duration/price and human-readable open windows.
   * The AI uses this to proactively tell callers when they can come in.
   */
  async getAvailableSlots(tenantId: string, serviceType: string, date: string, logger: Logger) {
    logger.info({ tenantId, serviceType, date }, "Computing available slots");

    const data = await this.repo.getAvailableSlots(tenantId, serviceType, date, logger);

    // Format the date for spoken output (e.g., "Wednesday, April 2nd")
    const dateObj = new Date(date + "T12:00:00");
    const dayName = dateObj.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

    if (!data.service) {
      logger.warn({ serviceType }, "Service not found in catalog");
      return { result: `I couldn't find a service matching "${serviceType}" in our catalog. Would you like to hear our list of services?` };
    }

    const { name: serviceName, duration_minutes, price } = data.service;
    const serviceInfo = price && Number(price) > 0
      ? `${serviceName} takes about ${duration_minutes} minutes and costs $${Number(price).toFixed(0)}.`
      : `${serviceName} takes about ${duration_minutes} minutes.`;

    if (data.shifts.length === 0) {
      logger.info({ date, dayName }, "No shifts scheduled for this day");
      return { result: `${serviceInfo} Unfortunately, we don't have anyone scheduled to work on ${dayName}. Would you like to try a different day?` };
    }

    // Merge overlapping shifts into coverage windows
    const coverage = mergeIntervals(data.shifts.map(s => ({
      start: timeToMinutes(s.start_time),
      end: timeToMinutes(s.end_time),
    })));

    // Subtract existing appointments
    const booked = data.appointments.map(a => ({
      start: dateTimeToMinutes(a.start_time),
      end: dateTimeToMinutes(a.end_time),
    }));
    const open = subtractIntervals(coverage, booked);

    // Filter to slots that can fit the service duration
    const usable = open.filter(slot => (slot.end - slot.start) >= duration_minutes);

    // Check if requested date is today — filter out past times
    const now = new Date();
    const isToday = date === now.toLocaleDateString("en-CA"); // YYYY-MM-DD format
    const currentMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : 0;
    const futureSlots = isToday
      ? usable.filter(s => s.end > currentMinutes).map(s => ({
          start: Math.max(s.start, currentMinutes),
          end: s.end,
        })).filter(s => (s.end - s.start) >= duration_minutes)
      : usable;

    if (futureSlots.length === 0) {
      logger.info({ date }, "No available slots after filtering");
      return { result: `${serviceInfo} Unfortunately, we're fully booked on ${dayName}. Would you like to try a different day?` };
    }

    // Format slots for speech
    const slotStrings = futureSlots.map(s => {
      if (s.start === coverage[0]?.start && s.end === coverage[coverage.length - 1]?.end) {
        return `all day from ${minutesToTime(s.start)} to ${minutesToTime(s.end)}`;
      }
      return `${minutesToTime(s.start)} to ${minutesToTime(s.end)}`;
    });

    const openHours = `${minutesToTime(coverage[0].start)} to ${minutesToTime(coverage[coverage.length - 1].end)}`;
    const slotsText = slotStrings.length === 1
      ? slotStrings[0]
      : slotStrings.slice(0, -1).join(", ") + ", and " + slotStrings[slotStrings.length - 1];

    logger.info({ slotCount: futureSlots.length, serviceName }, "Available slots computed");
    return {
      result: `${serviceInfo} On ${dayName}, our hours are ${openHours}. We have openings ${slotsText}. What time works best for you?`
    };
  }

  /**
   * Links orphaned call transcripts to customers by matching call_id with appointments.
   */
  async linkOrphanedTranscripts(tenantId: string, logger: Logger): Promise<number> {
    return this.repo.linkOrphanedTranscripts(tenantId, logger);
  }

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

// ── Interval math helpers for slot computation ───────────────────────

interface Interval { start: number; end: number }

/** Convert "HH:MM" or "HH:MM:SS" time string to minutes since midnight */
function timeToMinutes(t: string): number {
  const parts = t.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/** Convert ISO datetime string to minutes since midnight (in local date context) */
function dateTimeToMinutes(dt: string): number {
  const d = new Date(dt);
  return d.getHours() * 60 + d.getMinutes();
}

/** Convert minutes since midnight to spoken time (e.g., 780 → "1:00 PM") */
function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return min === 0 ? `${hour12} ${period}` : `${hour12}:${String(min).padStart(2, "0")} ${period}`;
}

/** Merge overlapping/adjacent intervals into non-overlapping coverage blocks */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

/** Subtract booked intervals from coverage, returning remaining open windows */
function subtractIntervals(coverage: Interval[], booked: Interval[]): Interval[] {
  let open = [...coverage.map(c => ({ ...c }))];
  for (const b of booked) {
    const next: Interval[] = [];
    for (const o of open) {
      if (b.end <= o.start || b.start >= o.end) {
        // No overlap
        next.push(o);
      } else {
        // Overlap — split
        if (b.start > o.start) next.push({ start: o.start, end: b.start });
        if (b.end < o.end) next.push({ start: b.end, end: o.end });
      }
    }
    open = next;
  }
  return open;
}
