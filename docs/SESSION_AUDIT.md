# AI Secretary — Session Audit (March 18, 2026)

## Purpose
This is a critical, objective audit of the current state of all project documents and HTML mockups after today's session. The session was non-linear. Valuable decisions were made, but they were layered on top of existing documents rather than replacing outdated content. The result is documents that contradict themselves internally.

This document identifies every hole, contradiction, unanswered question, and tangent. It is written for one purpose: making sure the gaps are visible so they can be closed before Claude Code receives these files.

---

## 🔴 CRITICAL: Documents Are Append-Only — Original Sections Were Never Updated

**This is the single biggest structural problem and it affects every document.**

Every update today was appended to the bottom of the file. The original sections — often written weeks ago — were never edited to reflect new decisions. This means a developer reading any of these documents will encounter contradictions between the top and the bottom of the same file.

**Examples:**
- ARCHITECTURE.md Section 9 (top) says Solo is $29/mo. Section 16 (bottom) says $129/mo.
- PLAN.md Phase 12F (middle) says create Stripe products at $29 and $59. Decisions section (bottom) says $129 and $279.
- OVERVIEW.md main pricing table says $29/$59/$99. Appended section says $129/$279/$449/$1,200+.
- OVERVIEW.md main industry section says "6 categories, 20 types". Appended section says "8 categories."
- UI_UX_DESIGN.md Sign-Up section says medical is "greyed out with Coming soon." Appended section says medical is permanently removed with no mention anywhere.

**ACTION REQUIRED:** All original sections must be edited, not just appended to.

---

## 🔴 CRITICAL CONTRADICTIONS

### 1. Pricing — Four Different Versions in the Docs

| Location | Solo | Growth | Pro | Enterprise |
|---|---|---|---|---|
| ARCHITECTURE.md Section 9 (original) | $29 | $59 | $99 | — |
| ARCHITECTURE.md Section 16 (appended today) | $129 | $279 | $449 | $1,200+ |
| PLAN.md Phase 12F Stripe Lite (original) | $29 | $59 | — | — |
| PLAN.md Decisions section (appended today) | $129 | $279 | $449 | $1,200+ |
| OVERVIEW.md main section (original) | $29 | $59 | $99 | — |
| OVERVIEW.md appended section (today) | $129 | $279 | $449 | $1,200+ |
| UI_UX_DESIGN.md Sign-Up section (original) | $29 pre-selected | $59 pre-selected | $99 pre-selected | — |
| LandingPage.html (today's mockup) | $129 | $279 | $449 | $1,200+ |

**The new pricing ($129/$279/$449/$1,200+) is correct** — that was the deliberate decision made today.

**TODO:** 
- [ ] Edit and replace ARCHITECTURE.md Section 9 pricing table — not append
- [ ] Edit and replace PLAN.md Phase 12F Stripe Lite pricing — not append
- [ ] Edit and replace OVERVIEW.md main pricing table — not append
- [ ] Edit and replace UI_UX_DESIGN.md Sign-Up plan pre-selection copy — not append

**OPEN QUESTION:** Phase 12F Stripe Lite was the launch billing plan at $29/$59. The new pricing at $129/$279 is 4-5× higher. Has this been validated with any potential customer? DynaTire is the test case — do they know what they'll pay? Has this been discussed with Dale/DynaTire?

---

### 2. HIPAA Policy — Three Different Stances in the Same Documents

| Location | Policy |
|---|---|
| PLAN.md original section | Medical etc. "greyed out with Coming soon — compliance in progress" |
| PLAN.md HIPAA Exclusion Policy section (original) | Same — greyed out, "Coming soon" |
| PLAN.md Decisions section (appended today) | **Permanently removed, no coming soon, no mention anywhere** |
| UI_UX_DESIGN.md Sign-Up section (original) | "greyed out with Coming soon — compliance in progress. Cannot be selected." |
| UI_UX_DESIGN.md appended section (today) | Permanently removed |

**The new policy (permanently removed, no mention) is correct** — showing "coming soon" signals market intent before legal infrastructure exists.

**TODO:**
- [ ] Edit PLAN.md original HIPAA Exclusion Policy section — remove "greyed out" and "Coming soon" language
- [ ] Edit UI_UX_DESIGN.md Sign-Up section — remove greyed out / Coming soon description
- [ ] Confirm SignUpPage.html has no greyed-out medical tiles (check HTML)
- [ ] Confirm LandingPage.html has no medical mentions anywhere

---

### 3. Industry Categories — Two Different Counts in the Same Files

| Location | Count |
|---|---|
| ARCHITECTURE.md Section 13 (original) | 6 categories, 20 business types |
| ARCHITECTURE.md Section 4.3 (original) | 20 business types |
| OVERVIEW.md main section (original) | 6 categories, 20 types |
| OVERVIEW.md appended section (today) | 8 categories |
| UI_UX_DESIGN.md Sign-Up section (original) | Shows 6 categories in the diagram |

**8 categories is correct** — Financial Services and IT Services were added today.

**TODO:**
- [ ] Edit ARCHITECTURE.md Section 13 to say 8 categories and update the vertical list
- [ ] Edit ARCHITECTURE.md Section 4.3 to update the 20 business types count
- [ ] Edit OVERVIEW.md main industry section to say 8 categories
- [ ] Edit UI_UX_DESIGN.md Sign-Up section diagram to show 8 categories
- [ ] **OPEN QUESTION: What are the default services, vocabulary labels, and templates for Financial Services and IT Services?** These were added to categories but never defined. A Financial Planning firm and a Computer Repair shop both exist in the new categories but neither has a template. This is a hole.

---

### 4. Phone Provisioning — Built, Backlogged, or Manual?

This is the most confusing contradiction in the documents.

| Location | Status |
|---|---|
| OVERVIEW.md main section | "manually provisioned for early customers, automated provisioning planned" |
| OVERVIEW.md Self-Service Onboarding Flow (step 5) | "Backend auto-provisions Telnyx number, SIP trunk, and Vapi agent from template" |
| ARCHITECTURE.md Section 10 | Describes fully automated provisioning in detail as if it is built |
| PLAN.md Phase 8 | Some production go-live items still open |
| PLAN.md Backlog | "Automated Phone Provisioning" listed as a future feature |
| Memory notes | "Phone provisioning must be fully automated. Manual process is a go-to-market showstopper." |

**Three different stories in the same file.** Is automated provisioning built, in the backlog, or manual-for-now?

**TODO:**
- [ ] **DECISION REQUIRED: What is the current state of phone provisioning?** If it is built, remove it from the backlog and mark it done. If it is not built, the ARCHITECTURE Section 10 must be marked as a spec (not implemented), and the Onboarding Flow in OVERVIEW must say "manual for early customers." If it is a go-to-market showstopper (per memory notes), it must be in Phase 8, not the backlog.
- [ ] Resolve the contradiction between OVERVIEW step 5 (implies it works) and backlog (implies it doesn't exist)

---

### 5. Two "Normalization" Concepts With the Same Name

The documents use the word "normalization" for two completely different things. This will confuse anyone implementing this.

**Concept A — Embedding Normalization** (ARCHITECTURE Section 6.1, PLAN Phase 12E):
- Purpose: Normalize stored text BEFORE embedding into pgvector
- Applied to: Customer notes, call summaries, knowledge base chunks
- Example: "I think Suzy is great" → "Sally prefers Suzy" → embed this
- Implementation: `shared/normalizeForEmbedding.ts`
- Status: Designed, TODO items exist in Phase 12E

**Concept B — Query Routing Normalization** (ARCHITECTURE Section 15, PLAN Decisions section):
- Purpose: Normalize an INCOMING CALLER QUESTION and route it to database/RAG/booking
- Applied to: Every live caller question in real time
- Example: "I was wondering what you charge..." → `{normalized: "tire swap price", route: "database"}`
- Implementation: GPT-4o-mini call inside vapi-tools Edge Function
- Status: Decided today, TODO items exist in Decisions section

**These are different systems** with different triggers, different implementations, and different purposes. They happen to both involve an LLM normalizing text. The PLAN.md Phase 12E TODO items cover only Concept A. The Decisions section TODO items cover only Concept B. Neither document clearly labels which is which.

**TODO:**
- [ ] Rename Concept A throughout documents: "Embedding Normalization" or "Storage Normalization"
- [ ] Rename Concept B throughout documents: "Query Routing" or "Caller Intent Routing"
- [ ] Add a clear section to ARCHITECTURE explaining both exist and what the difference is
- [ ] PLAN.md Phase 12E should be labelled "Embedding Normalization (for pgvector)" to distinguish from the new routing layer

---

## 🟡 SIGNIFICANT HOLES

### 6. Enterprise Tier ($1,200+/mo) — Zero Technical Definition

Added to pricing today. Described as "multi-location, white label." That is the entire definition.

Multi-location is architecturally significant. It means one owner account managing multiple tenant locations. That requires:
- A parent/child tenant relationship in the database
- Cross-tenant reporting
- Shared billing under one Stripe customer
- A multi-location dashboard view
- The question of whether vocabulary is per-location or shared

White label means the platform itself is rebranded. That requires:
- Custom domain support
- Logo/color override system
- Suppressing "AI Secretary" branding

**None of this is designed, scoped, or tasked.**

**TODO:**
- [ ] **DECISION: Is Enterprise a real tier being sold now or a placeholder?** If it is placeholder, remove it from the landing page until it is defined. If it is real, define what it includes technically.
- [ ] If real, add Enterprise architectural requirements to ARCHITECTURE.md
- [ ] If placeholder, update LandingPage.html to remove it or label it "Contact us"

---

### 7. Zero-Duration Services — Booking Engine Not Addressed

Today introduced the concept of services with 0-minute duration (Tire Disposal, fee-only services). This is a legitimate business requirement.

**The booking engine has never addressed this:**
- `book_appointment_atomic` derives end-time from `service.duration_minutes`
- If duration is 0, the appointment has the same start and end time — is that valid?
- Does `check_coverage_gaps()` handle zero-duration services or divide by zero?
- Does the scheduler UI render zero-duration appointments at all?
- Can the AI book a zero-duration service, or does it just inform the caller it is a fee added to another service?

**TODO:**
- [ ] **DECISION: How does booking work for a zero-duration service?** Options: (a) Cannot be booked standalone — must be added to another booking as an add-on. (b) Can be booked with a 1-minute minimum. (c) No time slot is created — it is a line item on the invoice only.
- [ ] Update `book_appointment_atomic` to handle 0 duration once decision is made
- [ ] Update `check_coverage_gaps()` to handle 0 duration
- [ ] Document the behavior in ARCHITECTURE.md

---

### 8. Service Duration Field Type — Text vs Integer

**The wizard was using text strings like "45 min" for duration.** Today that was changed to a free-form integer (minutes). But the database schema — if it uses `duration_minutes integer` — would have been incompatible with the original wizard's text-string approach.

**TODO:**
- [ ] Confirm `services.duration_minutes` column type in database (should be integer, not text)
- [ ] Confirm the original wizard was NOT sending "45 min" as a string to the database — if it was, there may be existing bad data
- [ ] Update SoloWizard.html to send the integer value from the number input (not append "min" to it)

**Similarly for price:**
- [ ] Confirm `services.price` column type in database (should be numeric/decimal, not text)
- [ ] The wizard was originally using text like "$65" — this would fail to insert into a numeric column

---

### 9. Travel Buffer — Decision Not Finalized

Decision from today: "Travel buffer stored as `buffer_minutes` on employee or tenant record."

**"Or" is not a decision.** These have different implications:
- **On employee**: Each employee has their own buffer (Dale needs 30 min, a faster tech might need 15)
- **On tenant**: One buffer applies to all employees for this business

For DynaTire (solo operator with a trailer), employee-level makes more sense because he is the only employee. But for a multi-employee mobile business, you might want per-employee buffers.

**TODO:**
- [ ] **DECISION: Is `buffer_minutes` on the employee record or the tenant record?**
- [ ] Add the column to the appropriate schema migration
- [ ] Update `book_appointment_atomic` to enforce the buffer between bookings
- [ ] Update `check_availability` to account for buffer when returning available slots
- [ ] Confirm the SoloWizard buffer picker (None/15/30/45/60) maps to this field correctly

---

### 10. SoloWizard.html File — Out of Sync With Widget

The saved file (`/mnt/user-data/outputs/SoloWizard.html`) does not match the interactive widget shown in chat. Specifically:

| Feature | File | Widget |
|---|---|---|
| Duration input | Dropdown (15/30/45/60/90 min) | Free-form integer with "min" suffix |
| Price input | Plain text field | `$` prefix, numeric only, 2 decimal places on blur |
| Zero-duration support | No (dropdown cannot reach 0) | Yes — turns purple, shows "Fee only" |
| Tire Disposal in list | Yes (added at end of session) | Yes |
| Blue accent on headings | Yes (fixed in file) | Yes |

**The file is the deliverable. The widget is a preview.** If Claude Code picks up the file, it gets the old dropdown duration and no price formatting.

**TODO:**
- [ ] Rebuild SoloWizard.html from the widget version to bring the file into sync
- [ ] Test the rebuilt file directly before committing

---

### 11. Main Voice LLM — Never Revisited

ARCHITECTURE.md Section 2 says the main conversational LLM is **Groq/Llama 3**. This was the original design decision and has never been revisited.

Today the system architecture added GPT-4o-mini for normalization/routing and OpenAI for post-call summarization. The main voice conversation is still specified as Groq/Llama 3.

**Open questions:**
- Is Groq/Llama 3 still the right choice for the main voice conversation? This is the most quality-sensitive part of the stack.
- What is the latency budget for the main LLM? Adding a normalization call (~150ms) before it means total latency is higher.
- Has the main LLM been tested with the new routing architecture? The normalization layer assumes the main LLM will use tool results without generating from memory — does Groq/Llama 3 behave reliably that way?

**TODO:**
- [ ] **DECISION: Confirm or change the main voice LLM.** If staying with Groq/Llama 3, document why. If moving to GPT-4o or similar, update ARCHITECTURE Section 2.
- [ ] Document latency budget for full call flow: STT + normalization + tool call + main LLM + TTS

---

### 12. Food & Beverage Vertical — Questionable Fit

The booking model is: **Employee + Skill + Resource = Valid Booking.** This works for tire shops, salons, gyms, and tradesperson appointments. It does not obviously work for restaurants and bars.

A restaurant does not book by employee. A bar does not have "skills" assigned to bartenders in the same way. Table reservations work differently from service appointments. Catering is event-based.

**This vertical may be a poor fit for the core architecture and was never flagged.**

**TODO:**
- [ ] **DECISION: Is Food & Beverage actually supported at launch?** If yes, document how the Employee + Skill + Resource model applies to restaurants and bars. If no, remove it from the category list.
- [ ] If keeping it, define what "booking" means for a restaurant — table reservation? Event booking? Private dining?

---

### 13. Skill Relationship Map — 2-Column Decision Not Documented

During today's discussion, it was decided that the Skill Relationship Map should collapse to 2 columns for businesses where all resources are personal (mobile operators, solo technicians), because the third column becomes redundant when the person IS the resource.

**This decision exists only in this conversation. It is not in any document.**

**TODO:**
- [ ] Add to UI_UX_DESIGN.md under Skill Relationship Map: "For businesses where all resources are `is_personal = true`, the map collapses to 2 columns (Employee | Services). The resource column is hidden."
- [ ] Add to ARCHITECTURE.md: the map queries `is_personal` to determine column count

---

### 14. Onboarding Wizard — Step Count Inconsistent

| Location | Step count |
|---|---|
| ARCHITECTURE.md Section 4.5 | "10 Steps" in heading but lists 11 including You're Live! |
| UI_UX_DESIGN.md | "11 Steps" |
| SetupWizard.html mockup | 6 steps |
| SoloWizard.html mockup | 2 steps (3 including live screen) |

The SetupWizard HTML is a 6-step team wizard. The UI_UX_DESIGN 11-step wizard is the full onboarding flow (which includes billing, business info, knowledge, AI persona, phone number). These are two different things and the naming is confused.

**TODO:**
- [ ] Clarify naming: "Onboarding Wizard" = the full 11-step first-time setup flow. "Setup Assistant" = the repeatable 6-step configuration tool accessible anytime. These are different.
- [ ] Fix ARCHITECTURE.md Section 4.5 heading to say "11 Steps" and make the list match
- [ ] The SetupWizard.html mockup should be renamed SetupAssistant.html or TeamSetupWizard.html to avoid confusion

---

### 15. SetupWizard.html Is a Prototype of Step 5 Only

The SetupWizard.html was explicitly built to "open on Step 5 to show the interesting part." Steps 1–4 and Step 6 exist in the HTML but have not received the same design attention as Step 5.

**TODO:**
- [ ] Document SetupWizard.html clearly as a MOCKUP / PROTOTYPE in all docs
- [ ] Steps 1–4 and Step 6 need the same treatment as Step 5 before this is handed to Claude Code as a spec

---

## 🟡 OPEN QUESTIONS

These were raised today and not resolved.

**Q1: Is a single service allowed to require multiple simultaneous resources?**
For example, a tire mounting that requires both Dale's Truck AND a specific balancing rig. The current `Employee + Skill + Resource = Valid Booking` model allows only one resource per booking. This question was raised but not answered.

**Q2: Do AI-booked appointments require human approval before appearing on the calendar?**
This was raised as an open question. Not answered. This is a product decision with significant UX implications — an approval queue changes the entire flow.

**Q3: Is DynaTire aware of the new pricing ($129/mo)?**
The test deployment pricing question was never explicitly answered.

**Q4: What does the AI say when a caller asks for a service the business doesn't offer?**
The `getServiceCatalog` tool returns the catalog. If the service is not in it, what does the AI do? Offer alternatives? Take a message? Just say no? Not documented.

**Q5: What happens when the normalization LLM returns an unexpected route?**
The spec says "default to RAG." But what if it returns gibberish entirely? Is there a retry? A hard timeout? Not fully specified.

**Q6: How does the Solo Wizard handle a caller asking "what are your hours?"**
There are no "business hours" in the solo model — there are only availability windows. The AI needs to know how to present this. "I'm available Saturdays and Sundays 8am to 6pm" — but is that in the system prompt, the RAG, or the tool call?

---

## 🟢 WHAT WAS ACTUALLY ACCOMPLISHED TODAY

Despite the non-linearity, real value was created. This is an honest accounting.

**Architecture decisions made and documented:**
- Two-layer knowledge system (database tool calls vs RAG for policies only) — solid decision, well documented
- Query routing normalization layer — good design, well documented
- Services table additions (`subtitle`, `description`) — clear and correct
- Solo operator wizard branching (team size = 1 → 2-step wizard) — good UX decision

**UI work completed:**
- LandingPage.html — strong, including new "No hallucinations" feature card
- SignUpPage.html — routes to correct wizard based on team size
- SoloWizard.html — 2-step wizard with phone preview right panel
- SetupWizard.html — 6-step team wizard prototype focused on assignments step
- Price field: $-prefix, numeric-only, 2 decimal places on blur
- Duration field: free-form integer (minutes) replacing dropdown
- Zero-duration support (Fee only label, purple styling)
- Blue accent on step headings (was invisible ghost text)

**Pricing updated:**
- New pricing ($129/$279/$449/$1,200+) is on the landing page
- Documented in new sections of ARCHITECTURE, OVERVIEW, PLAN

**Decisions documented:**
- Service description is Day 2, not Day 0 — not in wizard
- Service `subtitle` and `description` pre-populated from templates
- HIPAA: permanently excluded, no mention anywhere
- Buffer time is a per-operator setting (30 min default for DynaTire)

---

## 🔴 ACTION LIST — Priority Order

### Fix documents now (before Claude Code sees them)

1. [ ] **Edit** ARCHITECTURE.md Section 9 pricing table — replace with $129/$279/$449/$1200
2. [ ] **Edit** PLAN.md Phase 12F Stripe Lite pricing — replace with $129/$279
3. [ ] **Edit** OVERVIEW.md main pricing table — replace with $129/$279/$449/$1200
4. [ ] **Edit** UI_UX_DESIGN.md Sign-Up plan pre-selection — replace with $129/$279/$449
5. [ ] **Edit** PLAN.md original HIPAA section — remove "greyed out / Coming soon" language
6. [ ] **Edit** UI_UX_DESIGN.md Sign-Up HIPAA line — remove greyed-out / Coming soon
7. [ ] **Edit** ARCHITECTURE.md Section 13 — update to 8 categories
8. [ ] **Edit** OVERVIEW.md main industry section — update to 8 categories
9. [ ] **Add** normalization terminology distinction — "Embedding Normalization" vs "Query Routing"
10. [ ] **Rebuild** SoloWizard.html from widget version to sync duration/price fields

### Answer before building

11. [ ] **Decide** phone provisioning status — built, backlogged, or manual?
12. [ ] **Decide** zero-duration service booking behavior
13. [ ] **Decide** `buffer_minutes` on employee or tenant record
14. [ ] **Decide** main voice LLM — still Groq/Llama 3?
15. [ ] **Decide** Enterprise tier — real product or placeholder?
16. [ ] **Decide** Food & Beverage — does the model actually apply?
17. [ ] **Decide** multi-resource bookings — is one resource per booking the final answer?
18. [ ] **Decide** AI-booked appointment approval queue — yes or no?

### Design gaps to fill

19. [ ] Define Financial Services and IT Services templates (services, vocabulary labels)
20. [ ] Define Enterprise tier technically (multi-location architecture, white label requirements)
21. [ ] Document zero-duration booking behavior in ARCHITECTURE
22. [ ] Document Skill Relationship Map 2-column collapse in UI_UX_DESIGN
23. [ ] Clarify "Onboarding Wizard" vs "Setup Assistant" naming throughout
24. [ ] Define how the AI presents solo operator availability windows to callers
25. [ ] Define what the AI says when a requested service is not in the catalog

---

## TANGENTS FROM TODAY

These were real work but consumed session time without advancing the core product.

**The rendering tangent:** Approximately 30% of today's session was spent trying to get HTML pages to render interactively in chat. Approaches tried: present_files (works but opens side panel), blob URL iframe (blocked by sandbox), visualize tool (works but is a separate rebuild). The conclusion was to use the visualize tool for interactive previews. Going forward: use the visualize widget immediately rather than attempting blob URLs. The files are the deliverable; the widget is the preview.

**The hover/tooltip UX research tangent:** Solid research was done into tooltip patterns and expandable rows. Conclusion was correct (description is Day 2, not Day 0). But the research took significant time for a decision that could have been made more directly.

---

## 📋 FINDINGS FROM CONVERSATION HISTORY

After reviewing all past conversations, here are additional gaps and contradictions that were not caught in the document-only review.

---

### 16. UI_UX_HANDOFF.md Was Never Reviewed Today — Critical Gap

This is the actual handoff contract between the web UI sessions and Claude Code. It was not included in today's review. Reading it reveals a fundamental format mismatch.

**What UI_UX_HANDOFF.md says to produce:**
TSX files (React components) saved to `dashboard/components/mockups/`. Claude Code replaces mock data with API calls.

**What today's session produced:**
HTML files (LandingPage.html, SignUpPage.html, SoloWizard.html, SetupWizard.html).

**These are incompatible deliverable formats.** Claude Code expects TSX. Today produced HTML. The previous session (March 17) produced TSX. There are now two types of mockups in two different formats with no clear statement of which is authoritative.

Additionally, the UI_UX_HANDOFF lists 17 completed TSX mockups (OnboardingStep1–9, DashboardHome, SettingsLabels, EmptyStateExamples, BreadcrumbNav, MobileSubTabDemo, etc.). None of these appear in today's outputs because they already existed. The remaining mockups listed in UI_UX_HANDOFF as needed are:
- SetupWizard.tsx (the 6-step repeatable wizard)
- SchedulerView.tsx
- EmployeeDayFocus.tsx
- QuickBookPanel.tsx
- SkillRelationshipMap.tsx

Today's SetupWizard.html and SoloWizard.html cover some of this ground but in the wrong format.

**TODO:**
- [ ] **DECISION: Are today's HTML files meant to be converted to TSX for Claude Code, or are they standalone design references?**
- [ ] Update UI_UX_HANDOFF.md to reflect today's HTML work and clarify its relationship to the TSX deliverables
- [ ] Either convert SoloWizard.html and SetupWizard.html to TSX, or document explicitly that HTML is the new format and TSX is being abandoned
- [ ] The SoloWizard has no equivalent TSX mockup in the completed list — it's entirely new work. Decide if it needs a TSX version before Claude Code can wire it.

---

### 17. MISSION_STATEMENT.md Is Significantly Out of Date

Not reviewed today. Still contains outdated decisions:

| What it says | What is true now |
|---|---|
| "20 business types across 6 categories" | 8 categories (Financial Services and IT Services added) |
| Section 2 HIPAA: "appear greyed out with Coming soon" | Permanently removed, no mention |
| Implied old pricing structure | $129/$279/$449/$1,200+ |
| "Start with DynaTire, then beauty and auto, then broader service businesses" (gradual expansion) | Financial Services and IT Services were added today — is this still gradual? |

**TODO:**
- [ ] Edit MISSION_STATEMENT.md Section 2: update category count to 8, add Financial Services and IT Services, remove 6-category reference
- [ ] Edit MISSION_STATEMENT.md Section 2 HIPAA paragraph: remove "greyed out / Coming soon" language
- [ ] **QUESTION: Adding Financial Services and IT Services contradicts the "gradual expansion" principle in Section 5. A financial planning firm or MSP is significantly more complex than a tire shop. Was this a deliberate expansion decision or an accidental scope creep?**

---

### 18. Combo Booking Decision Was Made in Conversation — Never Written to Documents

On March 16, a specific architectural decision was made about bookings that require multiple skills sequentially (package services, combo appointments):

**The decision:** Two chained sequential queries, both must pass before appointment is accepted, wrapped in a single PostgreSQL transaction with `SELECT FOR UPDATE` row-level locking to prevent concurrency conflicts.

A markdown summary was explicitly requested for the backlog. **That summary does not appear anywhere in PLAN.md, ARCHITECTURE.md, or SCHEDULING_PLAN.md.**

**TODO:**
- [ ] Add combo/package booking specification to ARCHITECTURE.md Section 7 (Advanced Scheduling Engine)
- [ ] Add combo booking backlog item to PLAN.md Backlog section
- [ ] Clarify whether `book_appointment_atomic` already handles this or if it needs to be extended

---

### 19. Voice Timing System Not Documented

From the original March 16 conversation, the platform was described as having:
- Deliberate 400–500ms response delays to sound more natural (not responding instantly, which sounds robotic)
- Graceful degradation phrases when queries run long ("Let me check on that for you..." while the tool call executes)

**Neither of these is documented in ARCHITECTURE.md or any other file.** These are implemented behaviors that Claude Code needs to know about to not accidentally break them.

**TODO:**
- [ ] Add to ARCHITECTURE.md Section 2 (Core System Flow): document the intentional response delay and graceful degradation phrase system
- [ ] Specify what the graceful degradation phrases are and when they trigger
- [ ] Confirm these still apply given the new normalization layer adds ~150ms — does the 400–500ms delay need to be recalibrated?

---

### 20. AI Disclosure — Documented But Underspecified

MISSION_STATEMENT.md says: "Discloses its AI nature to callers (legal and ethical standard)."

The March 16 conversation confirmed this decision: Dale resolved to voluntarily disclose AI identity to eliminate legal ambiguity.

**But how is the disclosure made?** This is not specified anywhere:
- Does the greeting always say "Hi, I'm an AI Secretary for DynaTire..."?
- Does the AI only disclose if directly asked "Am I talking to a real person?"?
- Is there a specific phrase required in all states?
- Does the disclosure language appear in the AI persona template?

**TODO:**
- [ ] **DECISION: What is the exact disclosure mechanism?** Options: (a) Always in the greeting, (b) Only when asked, (c) In the system prompt as a mandatory response to "are you a robot?", (d) A combination.
- [ ] Add the disclosure specification to ARCHITECTURE.md under the Vapi agent section
- [ ] Add disclosure language to the AI persona template (`vapi/agent.template.json`)
- [ ] Note: Laws on AI voice disclosure vary by state. This was flagged in March 16 as needing legal counsel. Is that still unresolved?

---

### 21. Legal Counsel Gap — Still Open

Explicitly flagged in the March 16 conversation as an open gap: "legal counsel on disclosure laws."

This has not been addressed in any document since then. There is no note saying it was resolved, no lawyer consulted, no document updated.

**This matters because:**
- Several states (California AB 302, others pending) have specific requirements about AI voice agent disclosure
- Getting it wrong is a liability, not just an inconvenience
- DynaTire is about to be a live test deployment

**TODO:**
- [ ] **FLAG: Legal counsel on AI voice disclosure laws has not been obtained. This should happen before DynaTire goes live.**
- [ ] Add to PLAN.md Phase 8 (Current): legal review of AI disclosure requirements as a pre-launch blocker

---

### 22. "Pluggable Stack" Principle Is Aspirational, Not Implemented

MISSION_STATEMENT.md Section 5 says: "Pluggable stack: Telephony, LLM, STT, TTS, and calendar providers are swappable behind clear interfaces."

The actual architecture is:
- Telephony: Telnyx (tightly coupled)
- Voice orchestration: Vapi (tightly coupled)
- Main LLM: Groq/Llama 3 (named specifically in architecture)
- Normalization: GPT-4o-mini (hardcoded)
- Post-call summarization: OpenAI GPT-4o-mini (hardcoded)
- STT/TTS: Vapi's built-in (not separately swappable)
- Calendar: Google Calendar (with Outlook planned but not built)

There are no abstraction interfaces described. Swapping Telnyx for Twilio would require changes in multiple places.

**TODO:**
- [ ] **DECISION: Is the "pluggable stack" principle still the goal, or was this aspirational language that doesn't reflect the actual design?**
- [ ] If still the goal, identify which providers need abstraction layers first
- [ ] If aspirational, update MISSION_STATEMENT.md to remove or soften this claim

---

### 23. DEPLOYMENT.md and N8N_WORKFLOWS.md Not Reviewed or Updated

Both files exist (uploaded March 17). Today's session made decisions that affect them:
- New pricing tiers affect billing configuration
- New `getServiceCatalog` tool affects Edge Function deployment
- Normalization layer is a new Edge Function or step in vapi-tools
- New `subtitle` and `description` columns require a migration to run at deployment

Neither file was reviewed or updated today.

**TODO:**
- [ ] Review DEPLOYMENT.md for stale content and update with new environment variables, migration steps, and tool changes
- [ ] Review N8N_WORKFLOWS.md for stale content
- [ ] Add `getServiceCatalog` Edge Function to deployment checklist
- [ ] Add normalization layer Edge Function to deployment checklist
- [ ] Add schema migration (`subtitle`, `description` columns) to deployment checklist

---

### 24. GEMINI.md / Two-AI Workflow — Unknown Status

The original March 16 conversation described a two-AI workflow using Claude and Gemini, with shared context maintained via markdown files including a `GEMINI.md` file. This file is not in the uploaded documents and its contents are unknown.

If Claude Code is also the primary implementation engine now, the GEMINI.md context file may be stale or irrelevant — or it may contain decisions and context that Claude Code is relying on.

**TODO:**
- [ ] **QUESTION: Is Gemini still being used in the development workflow, or has this been fully migrated to Claude?**
- [ ] If Gemini is still in use, GEMINI.md needs to be updated with today's decisions
- [ ] If Gemini is no longer in use, document that Claude Code is now the sole implementation engine

---

### 25. The HTML Mockups Use a Different Tech Stack Than the Dashboard

The HTML mockups built today use:
- DM Sans and Bebas Neue from Google Fonts
- Custom CSS variables (`--bg`, `--blu`, etc.)
- Vanilla JavaScript
- Dark industrial aesthetic

The actual dashboard uses:
- Tailwind CSS 3.4
- Lucide React icons
- Next.js 14 / React 18
- Light/dark mode toggle
- Existing UI primitives (Button, Card, Input, Badge from `components/ui/`)

The UI_UX_HANDOFF.md explicitly lists the component rules Claude Web should follow when producing TSX. Today's HTML files follow none of them. They look great as design references but cannot be directly implemented by Claude Code.

**TODO:**
- [ ] Be explicit in a note on each HTML file: "Design reference only — Claude Code must re-implement in TSX using Tailwind and existing UI primitives per UI_UX_HANDOFF.md"
- [ ] The color system in the HTML (dark industrial) does not match the dashboard (light/dark Tailwind). Confirm with Dale which aesthetic applies to the actual dashboard vs the marketing site.

---

## UPDATED ACTION LIST ADDITIONS

These are added to the priority list from the document audit:

26. [ ] Update UI_UX_HANDOFF.md with today's HTML work and clarify relationship to TSX deliverables
27. [ ] Edit MISSION_STATEMENT.md — categories, HIPAA language
28. [ ] Add combo booking spec to ARCHITECTURE.md Section 7
29. [ ] Add voice timing system to ARCHITECTURE.md Section 2
30. [ ] Specify AI disclosure mechanism — where, when, exact language
31. [ ] Flag legal counsel on AI disclosure laws as pre-launch blocker
32. [ ] Determine if "pluggable stack" principle is real or aspirational
33. [ ] Update DEPLOYMENT.md and N8N_WORKFLOWS.md
34. [ ] Clarify Gemini/GEMINI.md status
35. [ ] Add note to HTML mockups: design reference only, not TSX

