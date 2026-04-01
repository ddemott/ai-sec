/**
 * Test suite for voice AI booking issues discovered 2026-04-01
 * 
 * Issue 1: Phone number capture incomplete (+1 instead of full number)
 * Issue 2: Wrong date booked (March 31 instead of April 2 when saying "tomorrow")
 * Issue 3: No employee assigned (Mike Rivera not assigned to booking)
 */

import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";

// Phone normalization function (from dispatcher.ts)
function normalizePhone(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return phone.startsWith("+") ? phone : `+${digits}`;
  return null;
}

// Date assumption function (from dispatcher.ts)
function assumeCentralTime(dt: string): string {
  if (!dt) return dt;
  // Already has timezone info
  if (/Z$/i.test(dt) || /[+-]\d{2}:\d{2}$/.test(dt) || /[+-]\d{4}$/.test(dt)) return dt;
  // Naive datetime — assume Central Time (CDT -05:00 Mar-Nov, CST -06:00 Nov-Mar)
  const match = dt.match(/^\d{4}-(\d{2})/);
  if (match) {
    const month = parseInt(match[1]);
    const offset = (month >= 3 && month <= 10) ? "-05:00" : "-06:00";
    return dt + offset;
  }
  return dt + "-05:00";
}

Deno.test("Phone normalization - Issue 1", () => {
  // These should work
  assertEquals(normalizePhone("+16082175303"), "+16082175303");
  assertEquals(normalizePhone("6082175303"), "+16082175303");
  assertEquals(normalizePhone("16082175303"), "+16082175303");
  assertEquals(normalizePhone("(608) 217-5303"), "+16082175303");
  
  // Edge cases that might be causing "+1" to be stored
  assertEquals(normalizePhone("+1"), null); // Too short, should return null not "+1"
  assertEquals(normalizePhone("1"), null);
  assertEquals(normalizePhone(""), null);
});

Deno.test("Date parsing - Issue 2", () => {
  // Test "tomorrow" logic
  // If today is April 1, 2026, "tomorrow at 2 PM" should be April 2, 2026 14:00
  
  const today = new Date("2026-04-01T10:00:00-05:00"); // April 1, 10 AM CDT
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(14, 0, 0, 0);
  
  // Expected: 2026-04-02T14:00:00-05:00
  const expected = "2026-04-02T14:00:00-05:00";
  
  // What we're getting: 2026-03-31T14:00:00-05:00 (wrong!)
  const wrong = "2026-03-31T14:00:00-05:00";
  
  // The AI should be computing tomorrow correctly
  // This is likely an issue in the Vapi assistant prompt or LLM interpretation
  console.log("Expected tomorrow from April 1:", expected);
  console.log("What was booked:", wrong);
  console.log("Difference:", new Date(expected).getTime() - new Date(wrong).getTime(), "ms");
});

Deno.test("Timezone assumption - Central Time", () => {
  // April is CDT (-05:00)
  assertEquals(assumeCentralTime("2026-04-02T14:00:00"), "2026-04-02T14:00:00-05:00");
  
  // December is CST (-06:00)
  assertEquals(assumeCentralTime("2026-12-15T14:00:00"), "2026-12-15T14:00:00-06:00");
  
  // Already has timezone - don't modify
  assertEquals(assumeCentralTime("2026-04-02T14:00:00Z"), "2026-04-02T14:00:00Z");
  assertEquals(assumeCentralTime("2026-04-02T14:00:00-05:00"), "2026-04-02T14:00:00-05:00");
});
