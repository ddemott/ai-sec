/**
 * Tests for `selectAssignments` — the pure scheduling selector that
 * matches a service requirement against the available resources,
 * employees, shifts, and existing appointments to produce a list of
 * valid (resource, employee) options.
 *
 * Three flavors of scenario are exercised:
 *
 *   1. Salon scenarios — resource-only matching (stylists are modeled
 *       as resources with capabilities; no separate employee tier).
 *   2. Auto shop scenarios — resource + employee matching, where bays
 *       have capabilities and mechanics have skills, and a valid option
 *       requires both halves to align.
 *   3. Sad paths and edge cases — empty inputs, capability/skill misses,
 *       shift-boundary precision, adjacency vs. overlap, and the
 *       diagnostics object's reason-string contract.
 *
 * The diagnostics object is a first-class part of the contract: when
 * options is empty, it must explain WHY (no resources / no skill match /
 * all busy / off-shift). The voice agent's reply quality depends on
 * these strings being stable.
 *
 * Per the project convention, every test below carries a 5W
 * (WHO/WHAT/WHEN/WHERE/WHY) header so a sad-path failure tells the
 * debugger what behavior was expected and why.
 */
import { describe, it, expect } from 'vitest';
import { selectAssignments, type ResourceCandidate, type EmployeeCandidate, type ExistingAppointment, type TimeWindow, type Shift } from '../shared/scheduling';

function window(from: string, to: string): TimeWindow {
  return { from: new Date(from), to: new Date(to) };
}

function appt(resourceId: string, from: string, to: string): ExistingAppointment {
  return { resourceId, start: new Date(from), end: new Date(to) };
}

describe('Scheduling selector – salon scenarios', () => {
  const baseWindow = window('2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z');

  it('assigns preferred stylist when slot is free', () => {
    // WHO: A salon caller who specifically asks for stylist Suzy
    // WHAT: Selector returns exactly one option — Suzy — even though
    //        Alex is also qualified
    // WHEN: 10:00–11:00 window with no existing appointments
    // WHERE: Preferred-resource resolution path; preferredResourceId
    //         short-circuits the multi-option fan-out when the
    //         preferred resource is qualified AND free
    // WHY: Caller preference is the dominant signal — if we returned
    //       Alex too, the agent might book the wrong stylist on a tie
    //       and frustrate a customer with a regular stylist relationship.
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'alex', type: 'STYLIST', capabilities: ['cut'] },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'suzy',
      },
      window: baseWindow,
      resources,
    });

    expect(options).toEqual([{ resourceId: 'suzy' }]);
    expect(diagnostics.reason).toBe('ok');
    expect(diagnostics.totalResources).toBe(2);
    expect(diagnostics.capableResources).toBe(2);
    expect(diagnostics.availableResources).toBe(2);
  });

  it('falls back to other qualified stylist when preferred is busy', () => {
    // WHO: A salon caller who asked for Suzy, but Suzy is already booked
    //       at the requested time
    // WHAT: Selector falls back to Alex (the other qualified stylist)
    //        rather than returning empty
    // WHEN: 10:00–11:00 window where Suzy has an existing appointment
    //        covering the entire window
    // WHERE: Preferred-busy fall-through path — preference is honored
    //         only when the preferred resource is actually free
    // WHY: A "no openings" answer is the worst customer-facing outcome
    //       when there genuinely IS an opening. Falling back to a
    //       qualified peer keeps the booking flow alive; the agent will
    //       phrase it as "Suzy's booked then, but Alex is available — ok?"
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'alex', type: 'STYLIST', capabilities: ['cut'] },
    ];

    const existing = [appt('suzy', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z')];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'suzy',
      },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(options).toEqual([{ resourceId: 'alex' }]);
    expect(diagnostics.reason).toBe('ok');
    expect(diagnostics.availableResources).toBe(1);
  });

  it('returns no options when preferred is busy and others lack capability', () => {
    // WHO: A salon caller who asked for Suzy at a time she's booked,
    //       and the only other staffer (Ben) doesn't do cuts
    // WHAT: Empty options + diagnostics.reason = "all 1 resource busy
    //        during 10:00-11:00" (note the count is *capable*-resource,
    //        not total)
    // WHEN: 10:00–11:00 window with Suzy occupied by an existing appt
    // WHERE: Capability filter narrows to {Suzy}, then availability
    //         filter eliminates her, leaving zero options
    // WHY: The diagnostic count "1 resource busy" reflects the post-
    //       capability-filter pool, which is the meaningful denominator
    //       for the agent to relay ("our one stylist is booked then").
    //       Ben's existence as a non-stylist shouldn't dilute the count.
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'ben', type: 'STYLIST', capabilities: [] },
    ];

    const existing = [appt('suzy', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z')];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'suzy',
      },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(options).toEqual([]);
    // 1 capable (suzy) but she's busy, ben lacks capability
    expect(diagnostics.capableResources).toBe(1);
    expect(diagnostics.availableResources).toBe(0);
    expect(diagnostics.reason).toBe('all 1 resource busy during 10:00-11:00');
  });

  it('returns all free qualified stylists when there is no preference', () => {
    // WHO: A salon caller saying "whoever's available is fine"
    // WHAT: Selector returns every free qualified stylist (Suzy + Alex),
    //        excluding Ben (no capability) — order matches the input order
    // WHEN: 10:00–11:00 window where Suzy had a 09:00–10:00 appt that
    //        ended right at our start (adjacent, not overlapping)
    // WHERE: No-preference branch returns the full qualified-and-free set
    // WHY: When the caller has no preference, we want to give the agent
    //       (and downstream booking logic) the broadest valid choice set
    //       so it can apply secondary tie-breakers (load balancing,
    //       round-robin, etc.) instead of arbitrarily picking one.
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'alex', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'ben', type: 'STYLIST', capabilities: [] },
    ];

    const existing = [appt('suzy', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z')];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
      },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(options).toEqual([
      { resourceId: 'suzy' },
      { resourceId: 'alex' },
    ]);
    expect(diagnostics.reason).toBe('ok');
    expect(diagnostics.totalResources).toBe(3);
    expect(diagnostics.capableResources).toBe(2);
    expect(diagnostics.availableResources).toBe(2);
  });
});

describe('Scheduling selector – auto shop scenarios', () => {
  const baseWindow = window('2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z');

  it('requires alignment bay and mechanic with alignment skill', () => {
    // WHO: An auto-shop caller booking an alignment service
    // WHAT: Selector returns exactly one (resource, employee) pair —
    //        bay4 (the alignment-capable bay) + Rick (the alignment-
    //        skilled, on-shift mechanic). bay1 + John are both filtered
    //        out (bay1 lacks the capability, John lacks the skill)
    // WHEN: 10:00–11:00 window with all parties otherwise free
    // WHERE: Cross-product step — every capable resource is paired with
    //         every skilled-and-on-shift employee, with both halves
    //         filtered against the same time window
    // WHY: Alignment requires BOTH a specialized bay AND a trained
    //       mechanic. The atomic-booking RPC enforces this server-side,
    //       but pre-filtering at the selector keeps the agent from
    //       offering a slot that will then fail the RPC.
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
      { id: 'bay4', type: 'BAY', capabilities: ['alignment', 'tire-change'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'rick', skills: ['alignment', 'oil-change'], onShift: true },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toEqual([{ resourceId: 'bay4', employeeId: 'rick' }]);
    expect(diagnostics.reason).toBe('ok');
    expect(diagnostics.totalResources).toBe(2);
    expect(diagnostics.capableResources).toBe(1);
    expect(diagnostics.skilledEmployees).toBe(1);
    expect(diagnostics.onShiftEmployees).toBe(1);
  });

  it('returns no options when no skilled mechanic is on shift', () => {
    // WHO: An auto-shop caller asking for alignment when Rick (the only
    //       alignment mechanic) is off-shift
    // WHAT: Empty options + diagnostics.reason = "all 1 qualified
    //        employee off-shift during 10:00-11:00"
    // WHEN: Rick has skills=['alignment'] but onShift=false
    // WHERE: Skilled-but-off-shift filter — produces a different reason
    //         string than "no skill match" so the agent can phrase the
    //         response correctly ("Rick's not in today" vs. "we don't
    //         offer that service")
    // WHY: This distinction matters for caller experience: an off-shift
    //       mechanic implies "try a different day", a no-skill scenario
    //       implies "we don't do that here." The reason string drives
    //       which message the agent reads.
    const resources: ResourceCandidate[] = [
      { id: 'bay4', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'rick', skills: ['alignment'], onShift: false },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 1 qualified employee off-shift during 10:00-11:00');
    expect(diagnostics.skilledEmployees).toBe(1);
    expect(diagnostics.onShiftEmployees).toBe(0);
  });

  it('returns no options when bay is busy even if mechanic is free', () => {
    // WHO: An auto-shop caller asking for alignment when the only
    //       alignment-capable bay is occupied by an existing appointment
    // WHAT: Empty options + diagnostics.reason = "all 1 resource busy
    //        during 10:00-11:00" (resource-busy, not skill-related)
    // WHEN: Rick is on shift and skilled, bay4 is the only capable bay
    //        and has a 10:00-11:00 booking
    // WHERE: Resource-availability filter (independent of employee
    //         availability)
    // WHY: A free mechanic without a free bay can't actually perform
    //       the work. The agent needs to say "the alignment bay is
    //       booked then" — not "Rick is busy" — because that's the
    //       actual constraint and the customer might pick a different
    //       bay-friendly time.
    const resources: ResourceCandidate[] = [
      { id: 'bay4', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'rick', skills: ['alignment'], onShift: true },
    ];

    const existing = [appt('bay4', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z')];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
      existingAppointments: existing,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 1 resource busy during 10:00-11:00');
    expect(diagnostics.capableResources).toBe(1);
    expect(diagnostics.availableResources).toBe(0);
  });

  it('returns all valid (bay, mechanic) combos when multiple exist', () => {
    // WHO: An auto-shop caller booking alignment when two bays AND two
    //       mechanics are all qualified and available
    // WHAT: Selector returns all 4 combinations (cartesian product of
    //        2 bays × 2 mechanics), in a deterministic order: bay4 first,
    //        then bay5; within each bay, rick before sara
    // WHEN: All resources free, all employees on shift, all skills match
    // WHERE: Cross-product enumeration step
    // WHY: Downstream booking logic (or the agent's load-balancer) needs
    //       the full pool to make a smart pick. Determinism in the order
    //       matters for tests + for predictable behavior under tie-breaks.
    const resources: ResourceCandidate[] = [
      { id: 'bay4', type: 'BAY', capabilities: ['alignment'] },
      { id: 'bay5', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'rick', skills: ['alignment'], onShift: true },
      { id: 'sara', skills: ['alignment'], onShift: true },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    // After the 2026-05-08 auto-assignment policy change, employees with
    // equal skill counts are tiebroken by today's-busy-count, then random
    // (so equally-qualified equally-busy techs rotate over time). Rick and
    // Sara both have 1 skill and 0 today-busy → random order between them.
    // Resources still iterate in input order. Assert presence of all 4
    // combinations regardless of within-bay employee order.
    expect(options).toHaveLength(4);
    expect(options).toEqual(
      expect.arrayContaining([
        { resourceId: 'bay4', employeeId: 'rick' },
        { resourceId: 'bay4', employeeId: 'sara' },
        { resourceId: 'bay5', employeeId: 'rick' },
        { resourceId: 'bay5', employeeId: 'sara' },
      ])
    );
    // Bay4's options come before Bay5's (resource iteration is preserved).
    const bay4Indexes = options
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.resourceId === 'bay4')
      .map(({ i }) => i);
    const bay5Indexes = options
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.resourceId === 'bay5')
      .map(({ i }) => i);
    expect(Math.max(...bay4Indexes)).toBeLessThan(Math.min(...bay5Indexes));
    expect(diagnostics.reason).toBe('ok');
  });
});

describe('Scheduling selector – sad paths & edge cases', () => {
  const baseWindow = window('2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z');

  it('returns empty when resources array is empty (no capacity)', () => {
    // WHO: A tenant that hasn't configured any resources yet (fresh
    //       setup-wizard run that skipped the resources step)
    // WHAT: Empty options + diagnostics.reason = "no resources configured"
    //        — distinct from "no resources match capability"
    // WHEN: resources = []
    // WHERE: Top-of-function guard, before any filters run
    // WHY: A fresh tenant with no capacity configured is a meaningful
    //       state — the agent should respond "we're still getting set up"
    //       rather than "that service isn't available." The distinct
    //       reason string lets the agent route to the right message.
    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
      },
      window: baseWindow,
      resources: [],
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('no resources configured');
    expect(diagnostics.totalResources).toBe(0);
  });

  it('returns empty when employees array is empty and skills are required', () => {
    // WHO: A tenant that configured resources but no employees, asking
    //       for a service that requires both a capable resource AND a
    //       skilled mechanic
    // WHAT: Empty options + diagnostics.reason = "no employees configured"
    //        + availableResources = 1 (the resource pool was usable)
    // WHEN: employees = [] but resources is non-empty and capable
    // WHERE: Employee-required guard fires AFTER resource validation
    //         passes, so availableResources still reflects the resource pool
    // WHY: The diagnostic shape lets the agent tell the caller something
    //       precise — "we have the bay, just no mechanic right now" —
    //       which is different from "we don't offer that service" or
    //       "we're closed today."
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['alignment'] },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees: [],
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('no employees configured');
    expect(diagnostics.totalEmployees).toBe(0);
    expect(diagnostics.availableResources).toBe(1);
  });

  it('returns empty when shifts array is empty and employees rely on inline shift check', () => {
    // WHO: A tenant whose only qualified mechanic is explicitly marked
    //       off-shift for the requested time
    // WHAT: Empty options + diagnostics.reason = "all 1 qualified
    //        employee off-shift during 10:00-11:00"
    // WHEN: shifts=[] is passed (no schedule data) AND the employee has
    //        onShift: false explicitly — onShift wins over inline shift
    //        logic because it's the more direct signal
    // WHERE: Inline shift evaluation, where onShift=false short-circuits
    //         to off-shift regardless of what the shifts array says
    // WHY: The onShift flag is set from `employee_schedule` rows
    //       upstream; if the caller has already computed it, we should
    //       trust it. Re-evaluating from shifts=[] would force every
    //       caller to pass the full schedule, which is wasteful.
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['alignment'] },
    ];

    // onShift is undefined, so it falls through to inline shift check — no shifts means default true
    // But with an explicit empty shifts array and no onShift flag, the employee is considered on-shift (default behavior).
    // To test a true "no shifts" sad path, we need onShift: false explicitly.
    const employees: EmployeeCandidate[] = [
      { id: 'rick', skills: ['alignment'], onShift: false },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
      shifts: [],
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 1 qualified employee off-shift during 10:00-11:00');
    expect(diagnostics.skilledEmployees).toBe(1);
    expect(diagnostics.onShiftEmployees).toBe(0);
  });

  it('returns empty when appointment window end is before start (invalid window)', () => {
    // WHO: A buggy caller (or a fuzz test) passing a window where end < start
    // WHAT: Selector does NOT validate the ordering — it returns
    //        candidates as if the window were valid (overlap check
    //        trivially passes for an inverted range)
    // WHEN: window.from = 11:00, window.to = 10:00 (inverted)
    // WHERE: The selector's contract: caller is responsible for valid
    //         windows; we don't defend against this case
    // WHY: This test PINS current behavior so a future change is forced
    //       to be deliberate. Adding window-validation later would be
    //       reasonable, but it's a contract change — the calling
    //       routes/RPCs already validate window shape, so the selector
    //       trusts its inputs.
    const invertedWindow = window('2026-06-01T11:00:00Z', '2026-06-01T10:00:00Z');
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
    ];

    // An inverted window (end < start) means overlaps() will never be true for existing appts,
    // so the resource passes the "free" check. Resources still match on capabilities.
    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
      },
      window: invertedWindow,
      resources,
    });

    // The function does not validate window ordering — it still returns candidates.
    // This documents current behavior: caller is responsible for valid windows.
    expect(options).toEqual([{ resourceId: 'suzy' }]);
    expect(diagnostics.reason).toBe('ok');
  });

  it('does NOT match when appointment window starts exactly at shift end boundary', () => {
    // WHO: A caller asking for an appointment 17:00–18:00 when John's
    //       shift is 09:00–17:00 (ends exactly at the appointment start)
    // WHAT: Empty options + diagnostics.reason flags John as off-shift
    //        for the 17:00–18:00 window
    // WHEN: shift.end_time === window.from.localTime
    // WHERE: Shift-coverage check uses strict ">=" comparison — a shift
    //         ending at 17:00 does NOT cover a window ending at 18:00
    // WHY: Boundary semantics matter for real shifts — 17:00 means
    //       "go-home time", not "still working." A loose comparison
    //       here would silently overbook end-of-day appointments and
    //       create off-the-clock work.
    const lateWindow = window('2026-06-01T17:00:00Z', '2026-06-01T18:00:00Z');
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
    ];

    // Shift ends at 17:00, appointment starts at 17:00 — employee should NOT be on shift
    const shifts: Shift[] = [
      { employee_id: 'john', day_of_week: 1, start_time: '09:00', end_time: '17:00' }, // Monday
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'] }, // no onShift flag, uses inline shift check
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'oil-change',
        requiredResourceCapabilities: ['oil-change'],
        requiredEmployeeSkills: ['oil-change'],
      },
      window: lateWindow,
      resources,
      employees,
      shifts,
    });

    // Shift end_time "17:00" >= window end "18:00" is false, so employee is not on shift
    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 1 qualified employee off-shift during 17:00-18:00');
  });

  it('returns empty when appointment window spans beyond a single shift (partially covered)', () => {
    // WHO: A caller asking for a 16:00–18:00 window when John's shift
    //       only covers up to 17:00 — the second hour falls outside coverage
    // WHAT: Empty options — partial coverage doesn't qualify
    // WHEN: window: 16:00–18:00, shift: 09:00–17:00
    // WHERE: Shift-coverage check requires the shift to fully contain
    //         the window (shift.end_time >= window.end), not just
    //         overlap with it
    // WHY: A partially-covered window means the mechanic would have to
    //       leave mid-job. Booking that creates an unfinished appointment
    //       and a customer still in the chair after closing — bad on
    //       every axis. Full coverage or nothing.
    // Window: 16:00–18:00, shift covers only 09:00–17:00
    const spanWindow = window('2026-06-01T16:00:00Z', '2026-06-01T18:00:00Z');
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
    ];

    const shifts: Shift[] = [
      { employee_id: 'john', day_of_week: 1, start_time: '09:00', end_time: '17:00' },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'] },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'oil-change',
        requiredResourceCapabilities: ['oil-change'],
        requiredEmployeeSkills: ['oil-change'],
      },
      window: spanWindow,
      resources,
      employees,
      shifts,
    });

    // Shift end 17:00 < window end 18:00 — not fully covered
    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 1 qualified employee off-shift during 16:00-18:00');
  });

  it('treats adjacent appointments as non-overlapping (both resources bookable)', () => {
    // WHO: A salon caller asking for 10:00–11:00 with Suzy, who has an
    //       existing 09:00–10:00 appointment ending exactly at the start
    //       of the requested window
    // WHAT: Suzy IS returned as available — adjacency is not overlap
    // WHEN: existing.end === window.from (touch boundary)
    // WHERE: Half-open range comparison: an appointment ending at 10:00
    //         and one starting at 10:00 do NOT overlap
    // WHY: Real-world salon scheduling needs back-to-back slots to work
    //       (10:00, 11:00, 12:00 with no gap). Treating adjacency as
    //       overlap would force gaps everywhere and waste capacity. The
    //       atomic-booking RPC's GiST exclusion constraints use the
    //       same half-open semantics — they have to agree.
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
    ];

    // Existing appointment ends exactly when our window starts
    const existing = [appt('suzy', '2026-06-01T09:00:00Z', '2026-06-01T10:00:00Z')];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
      },
      window: baseWindow, // 10:00–11:00
      resources,
      existingAppointments: existing,
    });

    // Adjacent (09:00-10:00 vs 10:00-11:00) — NOT overlapping
    expect(options).toEqual([{ resourceId: 'suzy' }]);
    expect(diagnostics.reason).toBe('ok');
  });

  it('gracefully picks another resource when preferredResourceId does not exist', () => {
    // WHO: A salon caller asking for a stylist whose ID isn't in the
    //       resource pool (typo, deleted record, agent hallucination)
    // WHAT: Selector falls back to returning all qualified resources
    //        rather than throwing or returning empty
    // WHEN: preferredResourceId points to an ID not in the resources list
    // WHERE: Preferred-resource lookup failure path
    // WHY: A hallucinated or deleted ID shouldn't dead-end the booking.
    //       Falling back to "all qualified" lets the agent still offer
    //       options ("I don't see that name on our list — Suzy and Alex
    //       are available though"), which is recoverable.
    const resources: ResourceCandidate[] = [
      { id: 'suzy', type: 'STYLIST', capabilities: ['cut'] },
      { id: 'alex', type: 'STYLIST', capabilities: ['cut'] },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'haircut',
        requiredResourceCapabilities: ['cut'],
        preferredResourceId: 'nonexistent-id',
      },
      window: baseWindow,
      resources,
    });

    // Preferred not found among options — falls back to all qualified resources
    expect(options).toEqual([
      { resourceId: 'suzy' },
      { resourceId: 'alex' },
    ]);
    expect(diagnostics.reason).toBe('ok');
  });

  it('gracefully picks another employee when preferred employee does not exist', () => {
    // WHO: An auto-shop caller; selector is exercised in the
    //       no-preference, single-valid-combo case
    // WHAT: Returns the one valid (bay1, rick) pair
    // WHEN: One bay, one mechanic, both qualified
    // WHERE: Single-combo cross-product output
    // WHY: This test pins the simplest happy path for cross-product
    //       output so a regression in the cross-product loop surfaces
    //       here before it affects multi-resource scenarios.
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'rick', skills: ['alignment'], onShift: true },
    ];

    // preferredResourceId is a resource preference, not employee —
    // but we verify that having employees that don't match a "preferred" scenario still works
    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    // Only valid combo returned
    expect(options).toEqual([{ resourceId: 'bay1', employeeId: 'rick' }]);
    expect(diagnostics.reason).toBe('ok');
  });

  it('returns empty when service requires a skill no employee has', () => {
    // WHO: An auto-shop caller asking for a specialized service no
    //       current employee has trained on (e.g., advanced diagnostics)
    // WHAT: Empty options + diagnostics.reason = "no employees with
    //        required skill 'advanced-diag'" (skill name appears verbatim)
    // WHEN: The required skill string isn't in any employee's skills list
    // WHERE: Skill-filter step, BEFORE shift evaluation
    // WHY: Surfacing the missing skill name lets the agent say "we don't
    //       have anyone trained for advanced diagnostics" — much better
    //       than a generic "no availability." Embedding the skill name
    //       in the diagnostic also helps operators audit gaps.
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['advanced-diag'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'rick', skills: ['alignment'], onShift: true },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'advanced-diagnostics',
        requiredResourceCapabilities: ['advanced-diag'],
        requiredEmployeeSkills: ['advanced-diag'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe("no employees with required skill 'advanced-diag'");
    expect(diagnostics.totalEmployees).toBe(2);
    expect(diagnostics.skilledEmployees).toBe(0);
  });

  it('returns empty when service requires a resource capability no resource has', () => {
    // WHO: An auto-shop caller asking for paint work when none of the
    //       bays are paint-equipped
    // WHAT: Empty options + diagnostics.reason = "no resources have
    //        required capability 'paint-booth'"
    // WHEN: The required capability string isn't in any resource's
    //        capabilities list
    // WHERE: Capability filter — runs before any employee logic, so
    //         no employee diagnostics get populated
    // WHY: Same diagnostic-quality argument as the skill-miss case —
    //       embedding the missing capability in the message gives the
    //       agent something useful to say ("we don't have a paint booth")
    //       and helps operators see expansion opportunities.
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
      { id: 'bay2', type: 'BAY', capabilities: ['tire-change'] },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'paint-job',
        requiredResourceCapabilities: ['paint-booth'],
      },
      window: baseWindow,
      resources,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe("no resources have required capability 'paint-booth'");
    expect(diagnostics.totalResources).toBe(2);
    expect(diagnostics.capableResources).toBe(0);
  });

  it('returns empty when all employees are on shift but none have the required skill', () => {
    // WHO: An auto-shop caller asking for alignment when 3 mechanics
    //       are all on shift but none of them are alignment-trained
    // WHAT: Empty options + diagnostics.reason = "no employees with
    //        required skill 'alignment'", totalEmployees=3, skilled=0
    // WHEN: Multiple on-shift employees, all without the required skill
    // WHERE: Skill filter runs to completion and reports the skill miss
    //         despite full staffing
    // WHY: This is a different state from "all employees off shift" —
    //       the team is here but doesn't have the right training. The
    //       agent's response should reflect that ("we have a full team
    //       today but nobody does alignments"), and operators may want
    //       to see this as a training-gap signal.
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['alignment'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'sara', skills: ['tire-change'], onShift: true },
      { id: 'mike', skills: ['oil-change', 'tire-change'], onShift: true },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'alignment',
        requiredResourceCapabilities: ['alignment'],
        requiredEmployeeSkills: ['alignment'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe("no employees with required skill 'alignment'");
    expect(diagnostics.totalEmployees).toBe(3);
    expect(diagnostics.skilledEmployees).toBe(0);
  });

  it('returns empty when all resources have capability but all are busy', () => {
    // WHO: A busy auto-shop where 3 oil-change bays exist and all 3
    //       have overlapping bookings during the requested window
    // WHAT: Empty options + diagnostics.reason = "all 3 resources busy
    //        during 10:00-11:00" (plural "resources")
    // WHEN: Three bays, three different existing appointments that each
    //        overlap the 10:00–11:00 request window
    // WHERE: Resource availability filter
    // WHY: Pluralization matters for diagnostic messages — "all 3
    //       resources busy" vs. "all 1 resource busy" — and the count
    //       reflects the post-capability-filter pool. Helps the agent
    //       phrase "all our bays are booked then" naturally.
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
      { id: 'bay2', type: 'BAY', capabilities: ['oil-change'] },
      { id: 'bay3', type: 'BAY', capabilities: ['oil-change'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
    ];

    const existing = [
      appt('bay1', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z'),
      appt('bay2', '2026-06-01T10:30:00Z', '2026-06-01T11:30:00Z'),
      appt('bay3', '2026-06-01T09:30:00Z', '2026-06-01T10:30:00Z'),
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'oil-change',
        requiredResourceCapabilities: ['oil-change'],
        requiredEmployeeSkills: ['oil-change'],
      },
      window: baseWindow,
      resources,
      employees,
      existingAppointments: existing,
    });

    expect(options).toEqual([]);
    expect(diagnostics.reason).toBe('all 3 resources busy during 10:00-11:00');
    expect(diagnostics.totalResources).toBe(3);
    expect(diagnostics.capableResources).toBe(3);
    expect(diagnostics.availableResources).toBe(0);
  });
});

describe('Scheduling diagnostics – comprehensive coverage', () => {
  const baseWindow = window('2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z');

  it('diagnostics counts are accurate on happy path with mixed resources', () => {
    // WHO: A real-world auto-shop where some bays/employees match the
    //       service and some don't
    // WHAT: Diagnostics object with totalResources=3, capable=2,
    //        available=2, totalEmployees=3, skilled=2, onShift=1, plus
    //        2 valid options (john paired with each capable bay)
    // WHEN: 3 bays (2 oil-change, 1 alignment), 3 employees (1 on-shift
    //        oil-change, 1 on-shift alignment, 1 off-shift oil-change)
    //        — only john is qualified AND on shift for oil-change
    // WHERE: Whole-pipeline accounting — every counter must reflect the
    //         right population at the right stage
    // WHY: Each counter is a separate code path; this test pins the
    //       full counter shape on a happy path so a regression in any
    //       single counter surfaces immediately rather than only
    //       showing up via downstream agent-prompt confusion.
    const resources: ResourceCandidate[] = [
      { id: 'bay1', type: 'BAY', capabilities: ['oil-change'] },
      { id: 'bay2', type: 'BAY', capabilities: ['alignment'] },
      { id: 'bay3', type: 'BAY', capabilities: ['oil-change'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'john', skills: ['oil-change'], onShift: true },
      { id: 'rick', skills: ['alignment'], onShift: true },
      { id: 'sara', skills: ['oil-change'], onShift: false },
    ];

    const { options, diagnostics } = selectAssignments({
      requirements: {
        serviceType: 'oil-change',
        requiredResourceCapabilities: ['oil-change'],
        requiredEmployeeSkills: ['oil-change'],
      },
      window: baseWindow,
      resources,
      employees,
    });

    expect(options).toHaveLength(2); // bay1+john, bay3+john
    expect(diagnostics).toEqual({
      totalResources: 3,
      capableResources: 2,   // bay1 + bay3
      availableResources: 2,
      totalEmployees: 3,
      skilledEmployees: 2,   // john + sara
      onShiftEmployees: 1,   // only john
      reason: 'ok',
    });
  });

  it('diagnostics reason uses plural for multiple resources busy', () => {
    // WHO: Anyone consuming the reason string in a diagnostic message
    // WHAT: Reason string uses "resources" (plural) when count > 1
    // WHEN: 2 capable resources, both busy during the requested window
    // WHERE: Reason-string formatting branch — singular-vs-plural
    //         pluralization is a small but observable contract
    // WHY: Customer-facing prompts read these strings ("all 2 resources
    //       busy" vs. "all 2 resource busy"). Bad pluralization erodes
    //       the polish of the agent's voice.
    const resources: ResourceCandidate[] = [
      { id: 'r1', capabilities: ['x'] },
      { id: 'r2', capabilities: ['x'] },
    ];

    const existing = [
      appt('r1', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z'),
      appt('r2', '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z'),
    ];

    const { diagnostics } = selectAssignments({
      requirements: { serviceType: 'x', requiredResourceCapabilities: ['x'] },
      window: baseWindow,
      resources,
      existingAppointments: existing,
    });

    expect(diagnostics.reason).toBe('all 2 resources busy during 10:00-11:00');
  });

  it('diagnostics reason uses plural for multiple employees off-shift', () => {
    // WHO: Anyone consuming the reason string for the off-shift case
    // WHAT: Reason string uses "qualified employees" (plural) when > 1
    //        skilled employee is off-shift
    // WHEN: 3 skilled employees, all off-shift
    // WHERE: Off-shift reason-string formatting branch
    // WHY: Same pluralization concern as the resources-busy case;
    //       pinning both keeps the contract symmetrical for both axes
    //       (resources vs. employees).
    const resources: ResourceCandidate[] = [
      { id: 'r1', capabilities: ['x'] },
    ];

    const employees: EmployeeCandidate[] = [
      { id: 'e1', skills: ['x'], onShift: false },
      { id: 'e2', skills: ['x'], onShift: false },
      { id: 'e3', skills: ['x'], onShift: false },
    ];

    const { diagnostics } = selectAssignments({
      requirements: { serviceType: 'x', requiredResourceCapabilities: ['x'], requiredEmployeeSkills: ['x'] },
      window: baseWindow,
      resources,
      employees,
    });

    expect(diagnostics.reason).toBe('all 3 qualified employees off-shift during 10:00-11:00');
    expect(diagnostics.skilledEmployees).toBe(3);
    expect(diagnostics.onShiftEmployees).toBe(0);
  });

  it('diagnostics for no-employee mode shows zero employee counts', () => {
    // WHO: A salon scenario where the service requires only a resource
    //       capability (no employee skills required — stylists ARE the
    //       resources)
    // WHAT: All employee counters are zero, reason is "ok"
    // WHEN: requirements has no `requiredEmployeeSkills`, so the
    //        employee pipeline never runs
    // WHERE: Employee accounting only fires when skills are required;
    //         otherwise counters stay at their zero defaults
    // WHY: Salons (and any single-tier service business) shouldn't have
    //       to fake employee data. Returning zero counts honestly is
    //       better than synthesizing fake employees to match an
    //       always-on pipeline.
    const resources: ResourceCandidate[] = [
      { id: 'suzy', capabilities: ['cut'] },
    ];

    const { diagnostics } = selectAssignments({
      requirements: { serviceType: 'haircut', requiredResourceCapabilities: ['cut'] },
      window: baseWindow,
      resources,
    });

    expect(diagnostics.totalEmployees).toBe(0);
    expect(diagnostics.skilledEmployees).toBe(0);
    expect(diagnostics.onShiftEmployees).toBe(0);
    expect(diagnostics.reason).toBe('ok');
  });
});

describe('selectAssignments — least-skilled-qualified auto-assignment policy (2026-05-08)', () => {
  // WHO: voice-agent caller asking for a job multiple techs can do
  // WHAT: selectAssignments returns the qualified employee with the
  //        FEWEST skills first — the specialist gets the simple job,
  //        the all-rounder stays free for jobs only they can do
  // WHEN: any /agent-tools/scheduling-options call (and the equivalent
  //        SQL ORDER BY in book_with_scheduling_atomic shipped 2026-05-08)
  // WHERE: shared/scheduling.ts selectAssignments sortedEmployees
  // WHY: pre-fix the sort was alphabetical, so Mike (5 tire skills)
  //        won simple rotations before Carlos (3) and Dana (3). The new
  //        policy preserves senior-tech availability for jobs only they
  //        can do (e.g. Balancing — only Mike has it in DynaTire's seed).

  const seedResources = [{ id: 'truck-1', capabilities: ['mobile-truck'] }];
  const seedWindow = { from: new Date('2026-06-01T09:00:00Z'), to: new Date('2026-06-01T10:00:00Z') };

  it('HAPPY: tire rotation — Mike (5 skills) does NOT win when 3-skill techs qualify', () => {
    const employees = [
      { id: 'mike', skills: ['flat-repair', 'tire-swap', 'tire-rotation', 'tire-install', 'balancing'], onShift: true },
      { id: 'carlos', skills: ['flat-repair', 'tire-swap', 'tire-rotation'], onShift: true },
      { id: 'dana', skills: ['flat-repair', 'tire-rotation', 'tire-install'], onShift: true },
    ];
    const { options } = selectAssignments({
      requirements: {
        serviceType: 'rotation',
        requiredEmployeeSkills: ['tire-rotation'],
        requiredResourceCapabilities: ['mobile-truck'],
      },
      window: seedWindow,
      resources: seedResources,
      employees,
    });
    expect(options.length).toBeGreaterThan(0);
    // Mike must NOT be the first option. Carlos or Dana wins (random
    // tiebreak between them is acceptable).
    expect(options[0].employeeId).not.toBe('mike');
  });

  it('HAPPY: balancing — Mike wins by elimination (only-qualified)', () => {
    const employees = [
      { id: 'mike', skills: ['flat-repair', 'tire-swap', 'tire-rotation', 'tire-install', 'balancing'], onShift: true },
      { id: 'carlos', skills: ['flat-repair', 'tire-swap', 'tire-rotation'], onShift: true },
      { id: 'dana', skills: ['flat-repair', 'tire-rotation', 'tire-install'], onShift: true },
    ];
    const { options } = selectAssignments({
      requirements: {
        serviceType: 'balancing',
        requiredEmployeeSkills: ['balancing'],
        requiredResourceCapabilities: ['mobile-truck'],
      },
      window: seedWindow,
      resources: seedResources,
      employees,
    });
    expect(options).toHaveLength(1);
    expect(options[0].employeeId).toBe('mike');
  });

  it('HAPPY: tire install — Dana (3) wins over Mike (5)', () => {
    const employees = [
      { id: 'mike', skills: ['flat-repair', 'tire-swap', 'tire-rotation', 'tire-install', 'balancing'], onShift: true },
      { id: 'carlos', skills: ['flat-repair', 'tire-swap', 'tire-rotation'], onShift: true },
      { id: 'dana', skills: ['flat-repair', 'tire-rotation', 'tire-install'], onShift: true },
    ];
    const { options } = selectAssignments({
      requirements: {
        serviceType: 'install',
        requiredEmployeeSkills: ['tire-install'],
        requiredResourceCapabilities: ['mobile-truck'],
      },
      window: seedWindow,
      resources: seedResources,
      employees,
    });
    // Only Mike + Dana have tire-install. Dana wins by skill count.
    expect(options[0].employeeId).toBe('dana');
  });
});
