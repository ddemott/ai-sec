/**
 * Tests for the get_available_slots tool — happy + sad paths.
 *
 * Tests the interval math (merging shifts, subtracting appointments)
 * and the service layer's human-readable output formatting.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// We can't import Deno modules directly, so we test the logic patterns
// by replicating the interval math helpers and testing them.

// ── Interval math helpers (replicated from service.ts for testing) ───

interface Interval { start: number; end: number }

function timeToMinutes(t: string): number {
  const parts = t.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function dateTimeToMinutes(dt: string): number {
  const d = new Date(dt);
  return d.getHours() * 60 + d.getMinutes();
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return min === 0 ? `${hour12} ${period}` : `${hour12}:${String(min).padStart(2, "0")} ${period}`;
}

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

function subtractIntervals(coverage: Interval[], booked: Interval[]): Interval[] {
  let open = [...coverage.map(c => ({ ...c }))];
  for (const b of booked) {
    const next: Interval[] = [];
    for (const o of open) {
      if (b.end <= o.start || b.start >= o.end) {
        next.push(o);
      } else {
        if (b.start > o.start) next.push({ start: o.start, end: b.start });
        if (b.end < o.end) next.push({ start: b.end, end: o.end });
      }
    }
    open = next;
  }
  return open;
}

// ═══════════════════════════════════════════════════════════════════════
// TIME CONVERSION — HAPPY PATHS
// ═══════════════════════════════════════════════════════════════════════

describe("timeToMinutes", () => {
  it("converts 08:00 to 480", () => expect(timeToMinutes("08:00")).toBe(480));
  it("converts 13:30 to 810", () => expect(timeToMinutes("13:30")).toBe(810));
  it("converts 18:00 to 1080", () => expect(timeToMinutes("18:00")).toBe(1080));
  it("converts 00:00 to 0", () => expect(timeToMinutes("00:00")).toBe(0));
  it("handles HH:MM:SS format", () => expect(timeToMinutes("08:00:00")).toBe(480));
});

describe("minutesToTime", () => {
  it("formats 480 as 8 AM", () => expect(minutesToTime(480)).toBe("8 AM"));
  it("formats 810 as 1:30 PM", () => expect(minutesToTime(810)).toBe("1:30 PM"));
  it("formats 1080 as 6 PM", () => expect(minutesToTime(1080)).toBe("6 PM"));
  it("formats 720 as 12 PM (noon)", () => expect(minutesToTime(720)).toBe("12 PM"));
  it("formats 0 as 12 AM (midnight)", () => expect(minutesToTime(0)).toBe("12 AM"));
  it("formats 615 as 10:15 AM", () => expect(minutesToTime(615)).toBe("10:15 AM"));
});

// ═══════════════════════════════════════════════════════════════════════
// INTERVAL MERGING — HAPPY + SAD PATHS
// ═══════════════════════════════════════════════════════════════════════

describe("mergeIntervals", () => {
  it("happy: merges overlapping shifts into one coverage block", () => {
    // Employee A: 8-14, Employee B: 10-18 → merged: 8-18
    const result = mergeIntervals([
      { start: 480, end: 840 },  // 8 AM - 2 PM
      { start: 600, end: 1080 }, // 10 AM - 6 PM
    ]);
    expect(result).toEqual([{ start: 480, end: 1080 }]); // 8 AM - 6 PM
  });

  it("happy: keeps non-overlapping shifts as separate blocks", () => {
    // Morning: 8-12, Afternoon: 14-18 (2h lunch gap)
    const result = mergeIntervals([
      { start: 480, end: 720 },
      { start: 840, end: 1080 },
    ]);
    expect(result).toEqual([
      { start: 480, end: 720 },
      { start: 840, end: 1080 },
    ]);
  });

  it("happy: merges adjacent (touching) intervals", () => {
    const result = mergeIntervals([
      { start: 480, end: 720 },  // 8-12
      { start: 720, end: 1080 }, // 12-18
    ]);
    expect(result).toEqual([{ start: 480, end: 1080 }]); // 8-18
  });

  it("sad: empty input returns empty array", () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it("happy: single interval returns as-is", () => {
    const result = mergeIntervals([{ start: 480, end: 1080 }]);
    expect(result).toEqual([{ start: 480, end: 1080 }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INTERVAL SUBTRACTION — HAPPY + SAD PATHS
// ═══════════════════════════════════════════════════════════════════════

describe("subtractIntervals", () => {
  it("happy: subtracts one appointment from middle of coverage", () => {
    // Coverage: 8-18, Appointment: 10-11
    // Result: 8-10, 11-18
    const result = subtractIntervals(
      [{ start: 480, end: 1080 }],
      [{ start: 600, end: 660 }]
    );
    expect(result).toEqual([
      { start: 480, end: 600 },
      { start: 660, end: 1080 },
    ]);
  });

  it("happy: subtracts multiple appointments", () => {
    // Coverage: 8-18, Appointments: 9-10, 14-15
    const result = subtractIntervals(
      [{ start: 480, end: 1080 }],
      [
        { start: 540, end: 600 },  // 9-10
        { start: 840, end: 900 },  // 14-15
      ]
    );
    expect(result).toEqual([
      { start: 480, end: 540 },   // 8-9
      { start: 600, end: 840 },   // 10-14
      { start: 900, end: 1080 },  // 15-18
    ]);
  });

  it("happy: appointment at start of coverage", () => {
    const result = subtractIntervals(
      [{ start: 480, end: 1080 }],
      [{ start: 480, end: 540 }]  // 8-9
    );
    expect(result).toEqual([{ start: 540, end: 1080 }]); // 9-18
  });

  it("happy: appointment at end of coverage", () => {
    const result = subtractIntervals(
      [{ start: 480, end: 1080 }],
      [{ start: 1020, end: 1080 }]  // 17-18
    );
    expect(result).toEqual([{ start: 480, end: 1020 }]); // 8-17
  });

  it("sad: fully booked (appointment covers entire coverage)", () => {
    const result = subtractIntervals(
      [{ start: 480, end: 1080 }],
      [{ start: 480, end: 1080 }]
    );
    expect(result).toEqual([]);
  });

  it("sad: no appointments — full coverage returned", () => {
    const result = subtractIntervals(
      [{ start: 480, end: 1080 }],
      []
    );
    expect(result).toEqual([{ start: 480, end: 1080 }]);
  });

  it("happy: works with split coverage (lunch gap)", () => {
    // Coverage: 8-12, 13-18. Appointment: 14-15
    const result = subtractIntervals(
      [{ start: 480, end: 720 }, { start: 780, end: 1080 }],
      [{ start: 840, end: 900 }]  // 14-15
    );
    expect(result).toEqual([
      { start: 480, end: 720 },   // 8-12 (untouched)
      { start: 780, end: 840 },   // 13-14
      { start: 900, end: 1080 },  // 15-18
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DURATION FILTER — ensuring slots fit the service duration
// ═══════════════════════════════════════════════════════════════════════

describe("Duration filter for usable slots", () => {
  it("happy: filters out slots shorter than service duration", () => {
    const duration = 60; // 1 hour
    const open: Interval[] = [
      { start: 480, end: 510 },   // 8:00-8:30 (30 min — too short)
      { start: 600, end: 720 },   // 10:00-12:00 (120 min — fits)
      { start: 900, end: 1080 },  // 15:00-18:00 (180 min — fits)
    ];
    const usable = open.filter(s => (s.end - s.start) >= duration);
    expect(usable).toHaveLength(2);
    expect(usable[0]).toEqual({ start: 600, end: 720 });
    expect(usable[1]).toEqual({ start: 900, end: 1080 });
  });

  it("sad: no slots fit the duration (WHO: caller, WHAT: no openings, HOW: all gaps shorter than service duration)", () => {
    const duration = 60;
    const open: Interval[] = [
      { start: 480, end: 510 },  // 30 min
      { start: 600, end: 630 },  // 30 min
    ];
    const usable = open.filter(s => (s.end - s.start) >= duration);
    expect(usable).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SOURCE CODE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════

describe("get_available_slots wiring", () => {
  const fs = require("fs");

  it("tool definition exists in tools.json", () => {
    const tools = JSON.parse(fs.readFileSync("vapi/tools.json", "utf8"));
    const slot = tools.find((t: any) => t.function.name === "get_available_slots");
    expect(slot).toBeTruthy();
    expect(slot.function.parameters.required).toContain("service_type");
    expect(slot.function.parameters.required).toContain("date");
  });

  it("Zod schema exists in index.ts", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/index.ts", "utf8");
    expect(src).toContain("GetAvailableSlotsSchema");
    expect(src).toContain("get_available_slots: GetAvailableSlotsSchema");
  });

  it("dispatcher routes get_available_slots to service", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/core/dispatcher.ts", "utf8");
    expect(src).toContain('case "get_available_slots"');
    expect(src).toContain("this.service.getAvailableSlots");
  });

  it("agent template includes get_available_slots in tools array", () => {
    const template = JSON.parse(fs.readFileSync("vapi/agent.template.json", "utf8"));
    expect(template.model.tools).toContain("get_available_slots");
  });

  it("agent prompt instructs AI to use get_available_slots before booking", () => {
    const template = JSON.parse(fs.readFileSync("vapi/agent.template.json", "utf8"));
    const prompt = template.model.messages[0].content;
    expect(prompt).toContain("get_available_slots");
    expect(prompt).toContain("ALWAYS use get_available_slots before booking");
    expect(prompt).toContain("duration");
    expect(prompt).toContain("price");
  });

  it("duplicate break removed from dispatcher book_appointment case", () => {
    const src = fs.readFileSync("supabase/functions/vapi-tools/core/dispatcher.ts", "utf8");
    // Should NOT have two breaks after book_appointment
    expect(src).not.toContain('break;\n        }\n          break;');
  });
});
