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

  const result = selectAssignments({
    requirements: {
      serviceType: "haircut",
      requiredResourceCapabilities: ["cut"],
      preferredResourceId: "suzy",
    },
    window: window("2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z"),
    resources,
  });

  assertEquals(result, [{ resourceId: "suzy" }]);
});

Deno.test("Scheduling selector (Deno) – auto shop alignment requires bay + skilled mechanic", () => {
  const resources: ResourceCandidate[] = [
    { id: "bay1", type: "BAY", capabilities: ["oil-change"] },
    { id: "bay4", type: "BAY", capabilities: ["alignment", "tire-change"] },
  ];

  const employees: EmployeeCandidate[] = [
    { id: "john", skills: ["oil-change"], onShift: true },
    { id: "rick", skills: ["alignment", "oil-change"], onShift: true },
  ];

  const result = selectAssignments({
    requirements: {
      serviceType: "alignment",
      requiredResourceCapabilities: ["alignment"],
      requiredEmployeeSkills: ["alignment"],
    },
    window: window("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"),
    resources,
    employees,
  });

  assertEquals(result, [{ resourceId: "bay4", employeeId: "rick" }]);
});

Deno.test("Scheduling selector (Deno) – no options when bay busy", () => {
  const resources: ResourceCandidate[] = [
    { id: "bay4", type: "BAY", capabilities: ["alignment"] },
  ];

  const employees: EmployeeCandidate[] = [
    { id: "rick", skills: ["alignment"], onShift: true },
  ];

  const existing: ExistingAppointment[] = [
    appt("bay4", "2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"),
  ];

  const result = selectAssignments({
    requirements: {
      serviceType: "alignment",
      requiredResourceCapabilities: ["alignment"],
      requiredEmployeeSkills: ["alignment"],
    },
    window: window("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"),
    resources,
    employees,
    existingAppointments: existing,
  });

  assertEquals(result, []);
});
