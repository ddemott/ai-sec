# AI Secretary — Decision Log

## Adopted (implemented)

### Pricing: $129 / $279 / $449 / $1,200+
- **Tiers**: Solo $129/mo (150 calls, 1 staff, 1 resource) | Growth $279/mo (500 calls, 5 staff, 3 resources) | Professional $449/mo (unlimited + BI) | Enterprise $1,200+/mo (multi-location, white label — not yet defined)
- **Rationale**: $29/mo doesn't cover infrastructure costs and signals "cheap tool." A 24/7 AI receptionist replaces a $1,200/mo part-time human.
- **Validate with**: DynaTire before committing. If they balk, $99 may be Solo sweet spot.

### HIPAA: Permanently removed
- No medical/dental/veterinary/chiropractic anywhere in the UI. No "coming soon." No greyed-out tiles.
- **Rationale**: "Coming soon" creates liability expectations before legal infrastructure exists.

### Two-layer knowledge system
- Database tool calls for facts (pricing, availability, booking). RAG for policies only (cancellation, service area, payment terms).
- **Key principle**: AI never halluculates pricing or availability — that's from the database.
- **Implementation**: `getServiceCatalog` tool in vapi-tools Edge Function.
- **Marketing**: "No hallucinations. Ever."

### Services table: subtitle + description columns
- `subtitle TEXT` (what AI reads to caller) and `description TEXT` (knowledge base detail) on services table.
- Collection via dashboard only (not wizard). Day 2, not Day 0.

### Solo wizard branching
- `team_size = 1` > SoloWizard (2 steps: services + availability). `team_size > 1` > SetupWizard (6 steps).
- Auto-created on solo completion: 1 employee (the owner), 1 personal resource, all services assigned.
- Design reference: SoloWizard.html mockup from March 18 session.

---

## Adopted (not yet implemented)

### Query routing normalization
- GPT-4o-mini call before every caller question (~150ms, temp 0.1). Returns `{ normalized, route: "database" | "rag" | "booking" }`. Main LLM never makes routing decisions. Falls back to "rag" on failure.
- **Why defer**: Optimization, not launch-blocking. The current system works without it.
- **When to build**: After beta testing reveals routing accuracy issues.
- **Related**: `shared/normalizeForEmbedding.ts` already does similar normalization for RAG storage (distinct concept — "embedding normalization" vs "query routing").

### Travel buffer
- `buffer_minutes` field for mobile businesses (time between appointments for driving).
- **Open question**: Goes on employee or tenant table? Different employees might need different buffers.
- Solo wizard: None / 15 / 30 / 45 / 60 min picker. DynaTire default: 30 min.
- **When to build**: When onboarding a mobile business that needs it.

### Zero-duration services (fee-only)
- Duration of 0 is a valid service entry (e.g., Tire Disposal, Environmental Fee). No time slot allocated.
- **Open question**: How does the booking engine handle this? Options: (a) add-on only, (b) 1-minute minimum, (c) invoice line item only.
- **When to build**: When a business needs it during onboarding.

### 8 industry categories (Financial Services, IT Services)
- Expand from 6 to 8 categories.
- **Blocker**: No templates exist for Financial Services or IT Services yet. Don't show empty categories.
- **When to build**: When the first financial or IT customer signs up, or when templates are ready.

### Enterprise tier ($1,200+/mo)
- Multi-location, white label, dedicated support. Not yet technically defined.
- **When to build**: When enterprise prospect appears. Don't build speculatively.

### Landing page
- Design reference: LandingPage.html from March 18 session. Dark industrial aesthetic, Bebas Neue / DM Sans fonts.
- Hero with live phone mockup, $126K missed call stat, competitor comparison, pricing cards, 8 categories.
- **When to build**: Before public launch. Separate project from the app.

### Sign-up page (6-step progressive reveal)
- Design reference: SignUpPage.html from March 18 session.
- Flow: Category > Type > Specialty > Size > Services > Account.
- Routes to: SoloWizard (team_size=1) or SetupWizard (team_size>1).
- **When to build**: After solo wizard and pricing are implemented.

### Skill Relationship Map: 2-column collapse
- For businesses where all resources are `is_personal = true`, the map collapses to 2 columns (Employee | Services). The resource column is hidden.
- Decided in March 18 session but not yet documented in UI_UX_DESIGN.md.

### Combo/package bookings
- Two chained sequential queries for multi-skill bookings. Both must pass before appointment is accepted. Wrapped in a single PostgreSQL transaction with `SELECT FOR UPDATE` row-level locking.
- Decided March 16 but never written to ARCHITECTURE.md or PLAN.md.

---

## Open Questions

These were raised during planning sessions and have not been resolved.

### Phone provisioning status
Is automated provisioning built, in the backlog, or manual-for-now? ARCHITECTURE.md Section 10 describes it as built, OVERVIEW.md's onboarding flow implies it works, but PLAN.md lists it in the backlog. The current answer is "manual for early customers, automate later" — but the docs need to reflect this consistently.

### Zero-duration service booking behavior
How does `book_appointment_atomic` handle a service with `duration_minutes = 0`? Does `check_coverage_gaps()` handle it or divide by zero? Can the AI book it standalone, or is it always an add-on? Options: (a) cannot be booked standalone, (b) 1-minute minimum, (c) invoice line item only.

### AI voice disclosure mechanism
MISSION_STATEMENT.md says "discloses its AI nature to callers." But the exact mechanism is unspecified: always in the greeting? Only when asked? A mandatory system prompt response? Specific phrase? The disclosure language should be in `vapi/agent.template.json`. Laws on AI voice disclosure vary by state — legal counsel was flagged as needed (March 16) and has not been obtained.

### Enterprise tier technical definition
Added to pricing as $1,200+/mo with "multi-location, white label." Zero technical architecture exists. Multi-location requires parent/child tenant relationships, cross-tenant reporting, shared billing. White label requires custom domain support, branding overrides. Is this a real tier being sold now or a placeholder?

### Travel buffer placement
Does `buffer_minutes` go on the employee record (per-person buffer) or the tenant record (one buffer for all staff)? For solo operators, either works. For multi-employee mobile businesses, per-employee is more flexible.

### Food & Beverage vertical fit
The booking model is Employee + Skill + Resource = Valid Booking. This works for tire shops, salons, and gyms. It does not obviously work for restaurants (table reservations) or bars (no skill-based assignments). Is this vertical actually supported at launch?

### Multi-resource bookings
Is a single service allowed to require multiple simultaneous resources? (e.g., a tire mounting that requires both a truck and a balancing rig.) The current model allows one resource per booking.

### AI-booked appointment approval
Do AI-booked appointments require human approval before appearing on the calendar, or do they go straight to confirmed? An approval queue would significantly change the UX flow.

### Main voice LLM confirmation
ARCHITECTURE.md specifies Groq/Llama 3 for the main voice conversation. Has this been validated against the new routing architecture? Adding a normalization call (~150ms) before the main LLM increases total latency. Is Groq/Llama 3 still the right choice for the most quality-sensitive part of the stack?

### Solo operator availability presentation
How does the AI present availability to callers when there are no "business hours" — only availability windows? "I'm available Saturdays and Sundays 8am to 6pm" — is this in the system prompt, the RAG, or a tool call?

### What does the AI say for unlisted services?
When a caller asks for a service not in the catalog, what does the AI do? Offer alternatives? Take a message? Just say no?

---

## Source Files

Design references from the March 18 Claude web session are preserved at:
- `/mnt/c/Users/Dale/Downloads/MARCH_18_SESSION.zip` (HTML mockups: LandingPage, SignUpPage, SoloWizard, SetupWizard)
- `/mnt/c/Users/Dale/Downloads/CLAUDE_CODE_HANDOFF.md` (7,154-line master handoff)

Note: HTML mockups are design references only. The dashboard is built with Next.js/React/Tailwind per `docs/UI_UX_DESIGN.md`. Claude Code must re-implement HTML designs as TSX using existing UI primitives.
