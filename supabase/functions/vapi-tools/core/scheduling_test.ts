// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { selectAssignments, type ResourceCandidate, type EmployeeCandidate, type ExistingAppointment, type TimeWindow } from "./scheduling.ts";

function window(from: string, to: string): TimeWindow {
  return { from: new Date(from), to: new Date(to) };
}

function appt(resourceId: string, from: string, to: string): ExistingAppointment {
  return { resourceId, start: new Date(from), end: new Date(to) };
}

Deno.test("Scheduling selector (Deno) – salon preferred stylist when free", () => {
  const resources: ResourceCandidate[] = [
    { id: "suzy", type: "STYLIST", capabilities: ["cut"] },
    { id: "alex", type: "STYLIST", capabilities: ["cut"] },
  ];

  const { options, diagnostics } = selectAssignments({
    requirements: {
      serviceType: "haircut",
      requiredResourceCapabilities: ["cut"],
      preferredResourceId: "suzy",
    },
    window: window("2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z"),
    resources,
  });

  assertEquals(options, [{ resourceId: "suzy" }]);
  assertEquals(diagnostics.reason, "ok");
});

Deno.test("Scheduling selector (Deno) – auto shop alignment requires bay + skilled mechanic", () => {
  const resources: ResourceCandidate[] = [
    { id: "bay1", type: "BAY", capabilities: ["oil-change"] },
    { id: "bay4", type: "BAY", capabilities: ["alignment", "tire-change"] },
  ];

  const employees: EmployeeCandidate[] = [
    { id: "101", skills: ["oil-change"] },
    { id: "102", skills: ["alignment", "oil-change"] },
  ];

  const shifts = [
    { employee_id: 101, day_of_week: 4, start_time: "08:00", end_time: "18:00" }, // Thursday
    { employee_id: 102, day_of_week: 4, start_time: "08:00", end_time: "18:00" },
  ];

  const { options, diagnostics } = selectAssignments({
    requirements: {
      serviceType: "alignment",
      requiredResourceCapabilities: ["alignment"],
      requiredEmployeeSkills: ["alignment"],
    },
    window: window("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"), // Thursday
    resources,
    employees,
    shifts,
  });

  assertEquals(options, [{ resourceId: "bay4", employeeId: "102" }]);
  assertEquals(diagnostics.reason, "ok");
});

Deno.test("Scheduling selector (Deno) – no options when bay busy", () => {
  const resources: ResourceCandidate[] = [
    { id: "bay4", type: "BAY", capabilities: ["alignment"] },
  ];

  const employees: EmployeeCandidate[] = [
    { id: "102", skills: ["alignment"] },
  ];

  const shifts = [
    { employee_id: 102, day_of_week: 4, start_time: "08:00", end_time: "18:00" },
  ];

  const existing: ExistingAppointment[] = [
    appt("bay4", "2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"),
  ];

  const { options, diagnostics } = selectAssignments({
    requirements: {
      serviceType: "alignment",
      requiredResourceCapabilities: ["alignment"],
      requiredEmployeeSkills: ["alignment"],
    },
    window: window("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"),
    resources,
    employees,
    shifts,
    existingAppointments: existing,
  });

  assertEquals(options, []);
  assertEquals(diagnostics.reason, "all 1 resource busy during 10:00-11:00");
});
