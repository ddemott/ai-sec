# SecretaryHQ — Beta Customer Onboarding Guide

> First-day-through-first-week walkthrough for a new beta tenant. Closes
> the gap that until this doc existed, a beta customer needed a
> screen-share with the founder to get from "I'd like to try this" to
> "my voice AI is taking real calls." Tracked closed in
> `docs/planning/TODO.md`. Author/owner: founder + dashboard team.

This guide assumes a brand-new tenant. If your account was pre-seeded
with demo data (e.g., DynaTire/Bella's during the demo period), skip to
the "Extending past the demo" section.

---

## What you should have ready before Day 1

You will move faster if you collect these before you log in. None are
strictly required at signup — you can fill them in piece by piece — but
the setup wizard asks for them in this order.

| Item | Why we need it |
|---|---|
| **Business name** | Shown to callers in the AI's first greeting. |
| **Time zone** | Drives every booking time, reminder schedule, and call-log timestamp. Get this right on Day 1 — changing it later requires re-converting historical timestamps. |
| **Employee list** with names + phone numbers | The technicians/stylists/staff who will appear on the schedule and to whom callers will be matched by skill. |
| **Service list** with duration + price | The bookable offerings the AI proposes to callers ("Tire rotation, 30 minutes, $35"). |
| **Resource list** (trucks/bays/chairs) | Whatever can host one appointment at a time. The booking RPC enforces no two appointments overlap on the same resource. |
| **Weekly business hours** | One opening time + closing time per day-of-week, used to populate the first 4 weeks of `employee_schedule`. |
| **Skill ↔ service mapping** | Which employees can perform which services. E.g., Mike does tire rotations + flat repairs but not full installs. The AI uses this to avoid offering callers an employee who can't do the requested service. |
| **A handful of policy answers** | Cancellation policy, refund policy, what to bring to an appointment, payment methods accepted. The AI reads these aloud when callers ask. |

---

## Day 1 — Getting in and looking around (~20 minutes)

### 1. First login

You should have received an invite email with a magic link. Click it
and set your password. From then on you log in at
`https://<your-dashboard-url>/dashboard` with your email + password.

Tip: your browser will probably remember the login. The session lasts
8 hours; after that you re-enter your password.

### 2. The four main tabs

Across the top of the dashboard you have four primary tabs:

| Tab | What it's for |
|---|---|
| **Home** | Today at a glance — next 3 appointments, today's call count, any owner-action items. The "morning coffee" view. |
| **Schedule** | The full calendar. Four sub-views: Technicians (rows = staff, columns = hours), Resources (rows = trucks/bays), List (chronological), Calendar (month/week). |
| **Customers** | Your CRM — list + per-customer detail panel with appointment history. |
| **Calls** | Recordings + transcripts of every call the AI handled. Used for reviewing what the AI said and didn't say. |

If you're an owner or admin, you also see **Back Office** with three
sub-tabs for the things you set once and rarely touch:

| Back Office sub-tab | What it controls |
|---|---|
| **My Business** | Hours, time zone, voice settings, billing. |
| **My Team** | Employees, shifts, services, resources, skill assignments, and login invites for staff. |
| **Phone Assistant** | What the AI knows (policy Q&A, uploaded documents), and how it behaves (first message, system prompt overrides). |

---

## Day 1 — Setup wizard (~30 minutes)

The setup wizard auto-runs on first login. If you closed it, find it
again in **Back Office → My Business → Setup wizard**.

The wizard has two paths:

- **Solo**: one-person business (you do everything). 5 steps, ~10 minutes.
- **Team**: multiple employees. 7 steps, ~25 minutes.

The wizard picks the path based on whether you indicate you have
employees in step 1. You can switch later without re-doing any steps.

### Wizard steps (Team path; Solo skips employees + assignments)

| # | Step | What you fill in |
|---|---|---|
| 1 | **Business type** | Pick the template closest to your business — `automotive`, `salon`, `mobile-tire`, `auto-bays`. The template seeds vocabulary (e.g., "Stylist" vs "Technician"), default services for your industry, and the AI's tone. You can override anything. |
| 2 | **Employees** | Names + phone numbers + which skills each one has. Skills are tags like `tire-rotation`, `haircut`, `oil-change` — the AI uses them to route callers. |
| 3 | **Resources** | Trucks/bays/chairs — anything that can host one appointment at a time. Name + a short description. |
| 4 | **Services** | What you sell. Name, duration in minutes, price, and which skills + which resources each service requires. The booking engine uses these to find an `(employee, resource, time)` triplet that works. |
| 5 | **Assignments** | Map each service to the employees who can perform it. The default is "every employee with a matching skill," but you can opt out (e.g., Mike has the `tire-install` skill but you only want Carlos doing full installs). |
| 6 | **Shifts** | A weekly grid: for each employee, mark the hours they work each day. The wizard expands this into the first 4 weeks of actual shifts in the database. You extend forward weekly from the Schedule tab (see "Extending coverage" below). |
| 7 | **Go live** | Review summary, click "Activate phone." We provision a Telnyx phone number, assign it to your SIP connection, and the AI is reachable on that number within ~60 seconds. |

After step 7 you have a fully working booking system. You can start
testing calls immediately.

**Optional: Import from website.** Just before the policy-questions step,
the wizard offers an optional **"Import from website"** step. Paste your
business URL and the AI scans your public pages (hours, services, pricing,
policies, FAQ) and pre-fills the policy answers it can find — so the next
step starts mostly filled in instead of blank. The pre-filled answers are
saved as you go and shown on the very next step, where you review and edit
(or clear) each one before you finish setup and go live. You can skip the
scan entirely and answer everything by hand. (See "Knowledge base setup"
below for how the scan and review fit together.)

### Common wizard mistakes (and how to avoid them)

- **Skipping shifts (step 6)**: every booking the AI tries to make
  needs an employee with a shift covering the requested time. Skip
  this and every call ends with "I'm sorry, we have no availability."
- **Service → skill mismatch**: if your "Brake Service" requires a
  `brakes` skill but no employee has that skill, the AI can't book it.
  The wizard warns you on step 5 if a service has no qualified
  employee.
- **Time zone wrong**: appointments show up in everyone's local time
  except yours. Fix in **Back Office → My Business → Time zone**.

---

## Day 1 — First test call (~10 minutes)

Once the wizard's "Go live" step completes, you have a Telnyx number
shown in **Back Office → My Business → Voice**. Call it from your own
phone.

The AI's first message is configurable per template (e.g., *"Thanks for
calling DynaTire — how can I help today?"*). Walk through these flows
in order:

| Test | What the AI should do |
|---|---|
| **Book an appointment** | Ask for your name, service, preferred day/time. It looks for an available `(employee, resource)` pair, proposes a time, you confirm. Open the dashboard's Schedule tab — the booking should appear within ~5 seconds. |
| **Ask a policy question** | Try "What's your cancellation policy?" — if you haven't filled in any policy answers yet, the AI responds with "Let me have someone get back to you" and creates an entry in **Phone Assistant → Unanswered Questions** for you to backfill. |
| **Try an unavailable time** | Ask for 3am on a weekday. The AI should refuse and offer the next available slot. |
| **Try a service you don't offer** | Ask for "an MRI" or whatever's far outside your business. The AI declines and stays in scope. |

If anything in the call feels off, open **Calls → [your test call] →
Transcript** and review what the AI heard vs what it said. The system
prompt and tone are tunable from **Back Office → Phone Assistant**.

---

## Day 1 — Knowledge base setup (~20 minutes)

This is the highest-leverage thing you can do for caller experience.
Every policy you fill in here is one less call that needs you
personally.

Go to **Phone Assistant → Policy Q&A**. You'll see 9 categories with
suggested questions. Fill in the ones your customers actually ask:

| Category | Questions to fill first |
|---|---|
| **Cancellation & Rescheduling** | What's the cancellation window? Late-cancellation fee? How do you reschedule? |
| **Payments** | What forms of payment? When do you charge? Refund policy? |
| **Logistics** | Address (or service area for mobile)? Parking? After-hours drop-off? |
| **Services** | What's included in each service? Add-ons? How long does each really take? |
| **Pricing** | Are quotes binding? Tax included? Sliding scale? |
| **Documents** | What does the customer need to bring? Forms to fill out beforehand? |
| **Insurance / Coverage** | Do you accept insurance? Direct billing? Out-of-pocket only? |
| **Warranties** | What's covered, for how long, what voids it? |
| **Emergencies / After-hours** | Do you have an emergency line? What qualifies? |

You can also upload existing policy documents (PDFs, Word docs, text
files) under **Phone Assistant → Documents**. The AI extracts the text,
indexes it, and references it when callers ask.

**Fastest start — scan your website.** If you ran the wizard's optional
"Import from website" step, many of these answers are already filled in. A
scan does two things:

1. **Pre-fills the policy questions** it found direct answers for — these
   show up already answered in **Phone Assistant → Policy Q&A** (a green
   "Answered" marker distinguishes already-answered questions from
   still-blank ones). Review and edit them like any other answer.
2. **Stages extra topics it discovered** (things outside the standard
   questions) for your review under the **Suggestions** tab. Each one has
   an **Add** (send to the live knowledge base) or **Discard** button —
   nothing reaches callers until you approve it.

The scan is bounded (a handful of pages, with request timeouts) so it
stays fast and low-cost; re-run it any time your website changes.

---

## Daily workflow — the 5-minute morning check

Most days, your only dashboard interaction is:

1. **Open Home** — see today's appointments + any overnight calls
2. **Click into any flagged calls** — the AI flags calls it couldn't
   resolve (unanswered policy questions, booking conflicts it punted
   on). These need your attention; everything else handled itself.
3. **Mark anyone off who's not coming in today** — Schedule →
   Technicians → click the staff name → "Mark off today." Frees their
   slots; the AI will route around them.

That's it. The rest is handled by the AI.

---

## Weekly: Extending coverage forward

Your schedule lives in `employee_schedule` as date-rows, NOT as a
weekly pattern. This is intentional — it makes "Carlos took next
Tuesday off" a one-row update, not a pattern-plus-override mental model.

The wizard seeds the first 4 weeks for you. **Every Friday afternoon**,
do this:

1. Schedule → Technicians sub-tab
2. Find the "Copy week →" button in the top-right
3. Picks the most recent fully-scheduled week and copies it forward 4
   weeks
4. Adjust any individual days (holidays, training, planned vacation)

If you forget for a week and the database runs out of forward
coverage, the AI will start saying "I don't see any availability for
that day" to callers asking about times more than 4 weeks out. That's
the symptom; the cure is the Copy Week button.

---

## Common admin tasks

| Task | Where to do it |
|---|---|
| Add a new employee mid-flight | Back Office → My Team → Employees → "Add employee." Don't forget step 2: assign their skills + services. |
| Add a new service | Back Office → My Team → Services → "Add service." Fill duration/price + required skills + required resources. |
| Update business hours | Back Office → My Business → Hours. New shifts apply going forward; the past stays historical. |
| Mark someone unavailable today | Schedule → Technicians → click the person → "Mark off today." Frees their slots immediately. |
| Cancel an appointment | Schedule → click the block → hover → trash icon (or popover Cancel button). Soft-cancel — the row stays, slot frees up. |
| Move/reschedule an appointment | Schedule → click and drag the block on the Technicians or Resources view. Snaps to 15-min grid. |
| Invite a front-desk login | Back Office → My Team → Logins → "Invite." They get a magic link to set their password. Front-desk role sees Primary tabs only, not Back Office. |

---

## Troubleshooting

### "The phone number rings but the AI never picks up"

Causes (in order of likelihood):
1. **Telnyx-side carrier hold** — happens occasionally on newly-ported
   numbers. Wait 1-4 hours and try again.
2. **LiveKit agent worker offline** — check the support page in the
   dashboard for "Voice service status." Should say "Worker online."
   If not, contact support.
3. **No `DASHBOARD_URL` env on backend** — only affects Stripe/OAuth
   redirects, not voice, but worth flagging.

### "The AI booked someone for a time my staff isn't there"

Almost always a `employee_schedule` gap. Check Schedule → Technicians
on the date in question — there should be a shift bar for the
employee at that time. If there isn't, the booking RPC has a bug we
need to know about (the RPC explicitly checks employee shifts and
should refuse this).

### "Customer says they got a reminder for the wrong time"

Reminders use the appointment's `start_time` in the tenant's
timezone, rendered into the customer's local time. If the customer is
in a different timezone, they may see a different clock time but it
points to the same absolute moment. If the appointment time itself is
wrong, check the appointment in the Schedule and edit it.

### "I don't see my call in the Calls tab"

Calls show up after they end. There's a ~30-second post-call delay
while the transcript is finalized. If a call is still missing after
2 minutes, it's possible the call never reached our backend — check
**Back Office → My Business → Voice → Recent attempts** for the raw
Telnyx side.

### "The AI gave a price that's wrong"

The AI reads prices from the Services list (Back Office → My Team →
Services). If a price is stale there, fix it in the Services list and
the next call will use the new price. Past calls had the old price.

### "Dashboard shows 'Something went wrong'"

Refresh the page (Cmd/Ctrl+Shift+R to bust cache). If it persists,
take a screenshot of the URL + error and send to support. The
dashboard's error boundary catches most React errors gracefully.

---

## Escalation

For anything not covered here:
- **Support email**: filled in per-tenant during setup
- **Status page**: dashboard's footer link
- **Urgent (voice down, can't book)**: see Back Office → Help → Urgent
  contact

Founder's direct line is available in the welcome email for the first
30 days of beta.

---

## A note about HIPAA verticals

SecretaryHQ deliberately does NOT support medical, dental,
chiropractic, optometry, or veterinary businesses. If your customer
base intersects with any of these, please flag it during onboarding —
we'll either help find an alternative or, in some cases, build an
appropriate vertical-specific tier.

---

## What's next

After your first week of live calls, we'll review the call log
together and tune:

- **System prompt** — your AI's tone and phrasing
- **Knowledge base** — fill gaps surfaced by unanswered questions
- **Service catalog** — add anything callers ask for that you don't
  yet list

Then we open the floodgates.
