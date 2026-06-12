# SecretaryHQ — What It Does

> Organized outline of SecretaryHQ's capabilities. Status legend:
> **✅ built** (works today) · **🔨 in progress** · **💡 planned** (captured in
> `docs/STRATEGY.md`, demand-gated). Last updated 2026-06-12.
>
> One line: **an AI receptionist that answers the phone, books the work,
> remembers the customer — and gives the owner just enough of a back office to
> run on, without buying a heavy platform.**

---

## 1. AI Voice Receptionist (the core)
- ✅ Answers business calls 24/7 (Telnyx → LiveKit Cloud → AI agent)
- ✅ Natural conversation — Deepgram (speech-to-text), GPT-4o-mini (reasoning), xAI Grok (voice)
- ✅ Knows the business — answers hours / prices / services / policies from a per-tenant knowledge base (RAG / vector search)
- ✅ Books appointments live during the call
- ✅ Recognizes returning callers + recalls their history and preferences
- ✅ Saves customer preferences mid-call ("prefers Maria", "last service: oil change")
- ✅ Phone verification (OTP via SMS) when caller-ID is blocked, before booking
- ✅ Live transfer to a human (owner's cell) via SIP REFER, or takes a message *(needs Telnyx REFER enabled to function)*
- ✅ Per-tenant persona — custom voice, speed, greeting, and system prompt (set on the AI Persona page)
- ✅ Graceful error recovery — never speaks raw errors; recovers in-character
- ✅ Customer-led booking — asks the caller's preferred time, widens the window if none fit, never imposes a slot

## 2. Scheduling & Booking Engine
- ✅ Real schedule of record — employees, shifts, resources, services, skills
- ✅ Atomic, race-safe booking (conflict checks, past-time rejection, shift-coverage enforcement)
- ✅ Service-aware — enforces required staff skills + required resources per service
- ✅ Timezone-aware availability lookup; cross-midnight night shifts
- ✅ 15-minute increment + duration validation
- ✅ Coverage-gap analysis (where the schedule has holes)
- ✅ Setup wizard collects a weekly grid → expands into the schedule

## 3. Customer Records (operational system-of-record)
- ✅ Customers, contact info, appointment history, notes
- ✅ Preferences stored + recalled on the next call (voice CRM context)
- ✅ Returning-caller recognition by phone

## 4. Call Logging & Records (Calls tab)
- ✅ Every answered call logged to `voice_sessions` (duration, caller)
- ✅ Full call transcript captured
- ✅ Call outcome (booked / transferred / …)
- ✅ Call → appointment back-link (deep-link the call to what it booked)
- ✅ Post-call AI summary (1–2 sentences, failsafe)

## 5. Analytics & Reporting
- 🔨 Top-line stats — calls / appointments / customers (volume, today, week) + recent activity
- 🔨 Call panels — call volume over time, call→booking conversion, caller abandonment
- 💡 Reporting that answers **WHY**, not just WHAT — surface causation from call outcomes ("bookings down because N callers wanted X"); the differentiator competitors can't match (their receptionist never captures the why)
- ✅ Coverage analysis (staffing vs demand)

## 6. Reminders & Communications
- ✅ Appointment reminders + confirmations (SMS / email), consent-gated
- ✅ Reminder scheduler (polls + delivers on a tick)
- ✅ SMS rate-limiting + delivery retry policy
- 💡 Delivery-receipt tracking (sent ≠ delivered) and a reminder-monitoring view

## 7. Integrations
- ✅ Calendar sync — Google Calendar, Outlook (booking → owner's calendar)
- ✅ CRM sync — Jobber, HubSpot, Square, ServiceTitan *(real code; 3 are now competitors and **frozen** — see `docs/STRATEGY.md`; Square kept as a partner)*
- ✅ Voice + telephony stack — Telnyx (PSTN), LiveKit (media), Deepgram, OpenAI, xAI Grok
- ✅ Phone provisioning — search / buy / route a phone number (Telnyx)

## 8. Owner Dashboard
- ✅ Primary tabs — Home, Schedule, Customers, Calls (all roles)
- ✅ Advanced tabs — My Business, My Team, Phone Assistant (owners/admins)
- ✅ AI Persona config — voice, greeting, system prompt, preference capture, forward number
- ✅ Guided setup wizard (+ solo-business mode)
- ✅ Knowledge-base management (the receptionist's answers)
- ✅ Role-based access — owner / admin / front-desk
- ✅ Demo mode — instant, isolated, self-expiring demo tenant with sample data

## 9. Multi-Tenancy, Auth & Security
- ✅ Row-level-security tenant isolation (every table)
- ✅ JWT auth (auto-logout), bcrypt, role gating
- ✅ Super-admin platform management across tenants
- ✅ Hardened tenant isolation (no anonymous cross-tenant access)

## 10. Billing (our SaaS revenue)
- ✅ Stripe subscription billing of the business — Solo / Growth / Pro *(built; needs live keys + path verification)*
- ✅ Webhook-driven subscription activation + access gating
- 💡 **Pricing model:** value-aligned **volume** pricing — metered on bookings/calls, never per-seat or per-minute; predictable bands (decision captured, build deferred — `docs/STRATEGY.md`)
- 🚫 We do **NOT** process the business's customers' service payments (deliberate — no PCI/payout liability; stays with their POS/Square)

## 11. Platform & Observability
- ✅ Health + readiness endpoints, Prometheus-style metrics
- ✅ Structured logging (Sentry, Better Stack), per-request enrichment
- ✅ On-demand system simulation harness (`scripts/simulate.sh`) — `status` (health board) · `tools` (realistic end-to-end journey) · `call` (talk to the agent in a browser, no phone)

---

## 12. Roadmap / Captured Ideas (💡 not built — demand-gated)
From `docs/STRATEGY.md`:
- **Owner AI copilot** — in-dashboard assistant: "set my Saturday hours", "why did I miss calls Tuesday?" (the natural surface for WHY-reporting + onboarding)
- **Website-scan onboarding** — auto-fill the knowledge base from the owner's existing site + post-scan gap-fill (the ultimate "tiny yes")
- **RAG-accuracy testing** — measure how accurately the receptionist answers; gates the website-scan feature
- **Restaurant vertical add-on** — table / server / reservation vocabulary + party-size flow
- **Expansion add-ons** (post-base, per demand) — light invoicing / reporting (build); payments → Square, payroll → Gusto (partner)

---

## Positioning (why these features, this shape)
- **Receptionist-first, cross-platform / no-platform** — works whether the business runs Square, a spreadsheet, or nothing. The platform incumbents (Jobber/ServiceTitan/Housecall Pro) require buying their whole suite to get a receptionist.
- **Non-trades verticals** — salons, auto/tire, fitness, food — where no incumbent bundles a receptionist.
- **Own the operational system-of-record, not a full CRM** — sell the front door; the light back office is what makes them stay.
- See `docs/STRATEGY.md` (positioning) + `docs/COMPETITOR_WEAKPOINTS.md` (attack map).
