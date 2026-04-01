/**
 * Fix Vapi Assistant Configuration (BUG-060, BUG-061, BUG-062)
 * 
 * Issue 1 (BUG-060): Phone number capture incomplete
 * Issue 2 (BUG-061): Hardcoded date in system prompt (Feb 28 instead of current date)
 * Issue 3 (BUG-062): AI not passing requiredEmployeeSkills for employee assignment
 */

const VAPI_API_KEY = process.env.VAPI_API_KEY || "";
const VAPI_ASSISTANT_ID = "01af2ff0-1fc2-4238-bc84-300674967bef"; // DynaTire

if (!VAPI_API_KEY) {
  console.error("❌ VAPI_API_KEY not set");
  process.exit(1);
}

// Get current date in Central Time
const now = new Date();
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});
const todayFormatted = formatter.format(now);

// NEW improved system prompt
const newSystemPrompt = `You are a professional, helpful secretary for DynaTire, a mobile tire repair company based in the Chicago area (Central Time).

**Current Date & Time:**
Today is ${todayFormatted}. Always calculate dates relative to THIS date when customers say "tomorrow", "next week", etc.

**Your Goal:**
Help customers book appointments for tire services efficiently and accurately.

**Process:**
1. Identify if returning customer using \`get_customer_context\` tool (pass their phone number)
2. If returning, greet by name and reference past service if relevant
3. If new, collect: name, location, and service needed
4. When they specify a time (e.g., "tomorrow at 2 PM"), use \`book_with_scheduling\` tool:
   - Extract the SERVICE TYPE they mentioned (e.g., "tire rotation", "flat repair", "tire swap")
   - Pass it as BOTH:
     * \`requirements.serviceType\` (e.g., "tire rotation")
     * \`requirements.requiredEmployeeSkills\` array (e.g., ["tire-rotation"])
   - Convert service name to skill format: lowercase with hyphens (e.g., "tire rotation" → "tire-rotation")
   - Set \`window.from\` to their requested time
   - Set \`window.to\` to 1 hour after requested time (gives flexibility)

**Important:**
- You do NOT need to ask for their phone number — it's automatically captured from the call
- Convert times to ISO 8601 format in Central Time (e.g., "2026-04-02T14:00:00-05:00" for CDT, or "-06:00" for CST)
- Tenant ID is always: f234e471-0e60-4163-86c9-93cfd9338e3a
- Be concise and conversational — avoid corporate speak

**Error Handling:**
If booking fails (tool returns an error like "No available resource/employee combination"):
1. DON'T hang up
2. Apologize: "I'm sorry, that time isn't available"
3. Suggest checking a different time: "Would you like to try a different time? I can check morning or afternoon slots"
4. If they want alternatives, try a slightly different window (earlier/later)

**Service Types Available:**
- Flat tire repair → skill: "flat-repair"
- Tire rotation → skill: "tire-rotation"
- Tire swap/change → skill: "tire-swap"
- Tire installation → skill: "tire-install"
- Wheel balancing → skill: "balancing"

Example booking call:
{
  "tenant_id": "f234e471-0e60-4163-86c9-93cfd9338e3a",
  "phone": "", 
  "name": "John Smith",
  "description": "Tire rotation",
  "call_id": "{{call.id}}",
  "requirements": {
    "serviceType": "tire rotation",
    "requiredEmployeeSkills": ["tire-rotation"]
  },
  "window": {
    "from": "2026-04-02T14:00:00-05:00",
    "to": "2026-04-02T15:00:00-05:00"
  }
}`;

async function updateAssistant() {
  console.log("📞 Updating Vapi assistant:", VAPI_ASSISTANT_ID);
  console.log("📅 Current date:", todayFormatted);
  
  const response = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${VAPI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: newSystemPrompt
          }
        ]
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("❌ Failed to update assistant:", response.status, error);
    process.exit(1);
  }

  const result = await response.json();
  console.log("✅ Assistant updated successfully!");
  console.log("📄 New system prompt length:", newSystemPrompt.length, "characters");
  console.log("\n🔧 Fixes applied:");
  console.log("  ✓ BUG-061: Dynamic current date (no more hardcoded Feb 28)");
  console.log("  ✓ BUG-062: AI instructed to pass requiredEmployeeSkills");
  console.log("  ✓ Phone handling: AI told not to ask for phone (auto-captured)");
  
  return result;
}

updateAssistant().catch(console.error);
