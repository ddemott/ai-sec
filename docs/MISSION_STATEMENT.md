# AI Secretary SaaS – Mission Statement

## 1. Purpose

We are building an **AI Secretary as a Service** that gives small and medium businesses a reliable, always-available front desk without the cost and complexity of hiring full-time staff.

The system should:
- Answer calls and messages as naturally as a human.
- Capture all the information a good receptionist would.
- Book and manage appointments correctly in the right calendars.
- Maintain rich customer history and notes.
- Scale from solo operators to multi-location businesses.

## 2. Who We Serve

Our initial focus is on **service businesses** that live and die by their schedule and inbound calls:

- Mobile services (e.g., DynaTire – mobile tire repair).
- Salons and barbershops.
- Auto shops and other appointment-based trades.
- Clinics and professional services (in later phases).

These businesses typically:
- Miss calls when busy, losing revenue.
- Rely on a single receptionist or owner who is stretched thin.
- Struggle with no-shows and last-minute changes.

## 3. What We Are Creating

### 3.1 AI Secretary

A conversational agent that:
- Answers phone calls and SMS on behalf of the business.
- Speaks with a **very human-sounding voice** and low latency.
- Handles common receptionist tasks:
  - Greeting and basic FAQs about the business.
  - Booking, rescheduling, and canceling appointments.
  - Confirming details and preferences.
  - Taking and attaching notes.

### 3.2 Built-in CRM

An internal customer relationship layer that:
- Stores customers with contact details, preferences, and history.
- Keeps notes at both the **customer** and **appointment** level.
- Records communication preferences (SMS, email, call).
- Provides a unified view of each customer across appointments.

This CRM is the **default** for all tenants. Over time, we may add connectors to sync with external CRMs (e.g., HubSpot, Pipedrive) when needed.

### 3.3 Internal Calendar + External Sync

A robust internal calendar model that:
- Represents resources (stylists, bays, trucks, clinicians, etc.).
- Defines working hours and availability rules.
- Stores all appointments and their statuses.

And a sync layer that:
- Mirrors appointments into external calendars (Outlook/Google) so owners and staff can see their schedule where they already work.
- Maintains mappings between internal appointments and external events.

Internal appointments are the **system-of-record**; external calendars are synchronized views.

### 3.4 Templates for Different Businesses

A templating system that makes the platform adaptable across industries:

- For salons:
  - Resources are **stylists**.
  - Each stylist has a calendar; there may also be a business calendar.
  - Customers often prefer a specific stylist.

- For auto shops:
  - Resources are **bays** (and optionally mechanics).
  - Customers usually don’t care who does the work.
  - There may be a company-wide view of capacity.

- For mobile services like DynaTire:
  - Resource is a **mobile unit/owner** with on-site jobs.
  - Location and job type are critical to scheduling.

Templates capture:
- Resource types, calendars, and basic scheduling rules.
- What information must be collected from the caller.
- How to map bookings into external calendars.

## 4. Why This Matters

For business owners:
- Fewer missed calls and lost opportunities.
- Lower staffing costs or the ability to re-focus staff on higher-value work.
- More consistent customer experience, 24/7 if desired.

For customers calling in:
- Faster response and less time on hold.
- Clear, consistent information and confirmations.
- The feeling of talking to a competent, polite assistant.

## 5. Guiding Principles

- **Human-first experience**: The AI should feel natural, polite, and helpful.
- **Low-Latency Focus**: Use high-performance models and orchestration to ensure the conversation feels real-time and human-like.
- **Owner control**: Businesses control their hours, rules, and preferences.
- **Data ownership**: Our backend remains the source of truth for CRM and scheduling.
- **Pluggable stack**: Telephony, LLM, STT, TTS, and calendar providers are swappable behind clear interfaces.
- **Gradual expansion**: Start with DynaTire, then salons/auto shops, then more complex verticals as templates mature.
