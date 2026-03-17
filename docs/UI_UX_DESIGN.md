# AI Secretary Dashboard — UI/UX Design Brief

## Purpose
This document captures the current state of the dashboard UI, its problems, and proposed improvements. The goal is to make the dashboard intuitive for service business owners (tire shops, salons, auto shops, clinics) who are not technical users.

---

## Target Users

- **Primary**: Small business owners/managers (e.g., DynaTire owner, salon manager)
- **Secondary**: Receptionists and front-desk staff
- **Tertiary**: Super-admin (platform operator managing multiple tenants)

These users care about: "Who's calling?", "What's booked?", "Who's working today?", "How's business going?" They do NOT think in terms of "Skill Matrix", "Resources", or "RLS".

---

## Current Dashboard Architecture

### Tech Stack
- **Framework**: Next.js 14 (App Router) + React 18
- **Styling**: Tailwind CSS 3.4
- **Icons**: Lucide React
- **Layout**: Outlook-inspired sidebar + content pane
- **Theme**: Light/dark mode toggle
- **Responsive**: Desktop sidebar collapses to mobile bottom nav

### Entry Points
- `dashboard/app/page.tsx` — Main page, renders login or layout
- `dashboard/components/OutlookLayout.tsx` — Shell with sidebar nav + content area
- `dashboard/app/layout.tsx` — Root layout with SessionProvider

### Current Navigation Structure (12 top-level tabs)

```
Desktop Sidebar (80px wide, icon + 9px label):
┌──────────┐
│ [logo]   │
│          │
│ Admin*   │  (* super-admin only)
│ Calendar │
│ Customers│
│ Employees│
│ Shifts   │
│ Services │
│ Resources│
│ Skills   │
│ Knowledge│
│ AI       │
│ Analytics│
│          │
│ [theme]  │
│ [user]   │
│ [settings│
│ [logout] │
└──────────┘

Mobile Bottom Nav (5 items only):
[ Schedule | Skills | Shifts | Knowledge | Exit ]
```

### Current Views (12 components)

| Tab ID | Component | What it does |
|--------|-----------|-------------|
| `all-businesses` | SuperAdminDashboard | Multi-tenant management (super-admin only) |
| `appointments` | AppointmentView | Outlook-style calendar with resource columns, appointment CRUD |
| `crm` | CRMView | Customer list + detail pane (contact info, appointments, call history, notes, search) |
| `staff` | EmployeeManagementView | Employee list with add/edit/delete, name/email/phone fields |
| `staff-shifts` | ShiftManagementView | Employee shift scheduling (day of week + time ranges) |
| `service-catalog` | ServiceAssignmentView | Service definitions with duration, price, and employee/resource assignments |
| `manage-resources` | ResourceManagerView | Physical resource management (bays, trucks, chairs) |
| `skill-matrix` | SkillMatrixView | Grid matching employee skills to resource capabilities |
| `knowledge-base` | KnowledgeBaseView | RAG document upload (PDF/text) and management |
| `ai-tuning` | AIConfigView | System prompt, voice ID, first message, persona settings |
| `analytics` | AnalyticsView | Call volume, booking conversion, revenue metrics |
| `settings` | SettingsView | Calendar sync, tenant configuration |

---

## Problems with Current UI

### 1. Too Many Top-Level Items
12 sidebar icons with tiny 9px labels is overwhelming. Most users will use 3-4 tabs daily but are confronted with 12 choices. There's no visual distinction between "use this every day" and "set this up once."

### 2. No Logical Grouping
Related features are scattered:
- **Staff management** is split across 3 tabs: Employees, Shifts, Skill Matrix
- **Business setup** is split across 3 tabs: Services, Resources, Knowledge Base
- **AI features** are split across 2 tabs: AI Tuning, Analytics

### 3. Confusing Labels and Icons
- "Skill Matrix" — means nothing to a salon owner
- "Resources" — too generic (these are bays, trucks, chairs)
- "AI Tuning" — vague
- ShieldCheck icon for Employees doesn't convey "staff"
- Settings icon (gear) used for both Services and Settings

### 4. Mobile Navigation is Incomplete
The bottom nav only shows 5 of 12 tabs: Schedule, Skills, Shifts, Knowledge, Exit. Users cannot access Customers, Employees, Analytics, AI settings, or Services from mobile at all.

### 5. No Visual Hierarchy
Daily-use items (Calendar, Customers) have the same visual weight as setup-once items (Resources, Skills, Knowledge Base). There's no sense of primary vs secondary actions.

### 6. No Onboarding Flow
A new business owner who just signed up sees 12 tabs with no guidance on where to start or what order to set things up.

---

## Proposed Navigation Restructure

### Principle: Group by User Intent

Reduce from 12 top-level items to **5 primary sections** with sub-navigation where needed.

```
Proposed Sidebar:
┌──────────────┐
│ [logo]       │
│              │
│ 📅 Schedule  │  ← Daily use (appointments calendar)
│ 👥 Customers │  ← Daily use (unified CRM with appointments, calls, notes)
│ 🏢 My Team   │  ← Setup + manage (employees, shifts, skill matrix)
│ 🔧 My Business│ ← Setup + manage (services, resources, knowledge base)
│ 🤖 AI & Insights│ ← Monitor + tune (AI persona, analytics)
│              │
│ [theme]      │
│ [settings]   │
│ [logout]     │
└──────────────┘
```

### Mapping: Old → New

| Old Tab | New Location | Notes |
|---------|-------------|-------|
| Calendar | **Schedule** (top level) | No change |
| Customers | **Customers** (top level) | No change — already unified with appointments + call history |
| Employees | **My Team** → Employees tab | Sub-tab within My Team |
| Shifts | **My Team** → Shifts tab | Sub-tab within My Team |
| Skill Matrix | **My Team** → Skills tab | Sub-tab within My Team |
| Services | **My Business** → Services tab | Sub-tab within My Business |
| Resources | **My Business** → Resources tab | Sub-tab within My Business |
| Knowledge Base | **My Business** → Knowledge tab | Sub-tab within My Business |
| AI Tuning | **AI & Insights** → AI Persona tab | Sub-tab within AI & Insights |
| Analytics | **AI & Insights** → Analytics tab | Sub-tab within AI & Insights |
| Settings | **Settings** (footer area) | No change |
| Admin | **Admin** (super-admin only, stays at top) | No change |

### Sub-Tab Navigation Pattern

When a user clicks "My Team", the content area shows a horizontal tab bar at the top:

```
┌─────────────────────────────────────────────────┐
│  [Employees]  [Shifts]  [Skills]                │
├─────────────────────────────────────────────────┤
│                                                 │
│  (Active sub-view renders here)                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Mobile Navigation (Proposed)

```
Bottom Nav (5 items — matches the 5 primary sections):
[ Schedule | Customers | My Team | My Business | AI ]
```

All features now accessible from mobile. Sub-tabs appear as a horizontal scrollable bar at the top of the content area.

---

## Additional UX Improvements to Consider

### Quick Actions / Dashboard Home
Consider a landing page (instead of defaulting to Calendar) that shows:
- Today's appointments at a glance
- Recent calls / missed calls
- Staff on shift right now
- Quick links to common tasks

### Onboarding Wizard (Does Not Exist — Needs to Be Built)

**Current problem**: When a new business is created, the owner logs in and sees 12 empty tabs with no guidance. There is no wizard, no checklist, and no indication of where to start. They have to discover the correct setup order themselves.

**What's needed**: A guided onboarding flow that walks a new business owner through setup step by step. This should appear automatically when a tenant has no services, resources, or employees configured.

#### Proposed Wizard Flow

```
Step 1: Tell Us About Your Business
┌─────────────────────────────────────────────────────────┐
│  Welcome to AI Secretary!                                │
│  Let's get your AI receptionist set up.                  │
│                                                          │
│  Business Name: [DynaTire                    ]           │
│  Business Type: [Mobile Tire Shop         ▾  ]           │
│                 (salon, auto shop, clinic, etc.)          │
│                                                          │
│  This helps us pre-configure your AI with the right      │
│  vocabulary and greeting style.                          │
│                                                          │
│                              [Next →]                    │
└─────────────────────────────────────────────────────────┘

Step 2: What Services Do You Offer?
┌─────────────────────────────────────────────────────────┐
│  Add the services your customers can book.               │
│                                                          │
│  ┌─────────────────────────────────────────────┐        │
│  │ Tire Rotation          30 min    $25         │  [x]  │
│  │ Flat Tire Repair       45 min    $40         │  [x]  │
│  │ Full Tire Install      90 min    $120        │  [x]  │
│  └─────────────────────────────────────────────┘        │
│  [+ Add another service]                                 │
│                                                          │
│  Tip: You can always edit these later under My Business. │
│                                                          │
│                     [← Back]  [Next →]                   │
└─────────────────────────────────────────────────────────┘

Step 3: Add Your Resources (What Gets Booked?)
┌─────────────────────────────────────────────────────────┐
│  Resources are the physical things customers book        │
│  against — trucks, bays, chairs, rooms, etc.             │
│                                                          │
│  ┌─────────────────────────────────────────────┐        │
│  │ Service Truck 1    Main mobile tire unit     │  [x]  │
│  └─────────────────────────────────────────────┘        │
│  [+ Add another resource]                                │
│                                                          │
│                     [← Back]  [Next →]                   │
└─────────────────────────────────────────────────────────┘

Step 4: Add Your Team
┌─────────────────────────────────────────────────────────┐
│  Add the employees who will be assigned to appointments. │
│                                                          │
│  ┌─────────────────────────────────────────────┐        │
│  │ Mike    mike@dynatire.com    All services    │  [x]  │
│  │ Steve   steve@dynatire.com   Rotation, Repair│  [x]  │
│  └─────────────────────────────────────────────┘        │
│  [+ Add another employee]                                │
│                                                          │
│  Tip: You'll set their working hours in the next step.   │
│                                                          │
│                     [← Back]  [Next →]                   │
└─────────────────────────────────────────────────────────┘

Step 5: Set Working Hours
┌─────────────────────────────────────────────────────────┐
│  When is your team available? Set shift hours per        │
│  employee. The AI will only book during these times.     │
│                                                          │
│  Mike:                                                   │
│    Mon-Fri  8:00 AM - 5:00 PM                           │
│    Sat      9:00 AM - 1:00 PM                           │
│                                                          │
│  Steve:                                                  │
│    Mon-Fri  8:00 AM - 5:00 PM                           │
│                                                          │
│  [Edit shifts]                                           │
│                                                          │
│                     [← Back]  [Next →]                   │
└─────────────────────────────────────────────────────────┘

Step 6: Teach the AI Your Policies (Optional)
┌─────────────────────────────────────────────────────────┐
│  Upload documents so the AI can answer questions about   │
│  your policies, pricing, hours, and procedures.          │
│                                                          │
│  [📄 Upload PDF or Text File]                            │
│                                                          │
│  Examples of what to upload:                             │
│  • Cancellation policy                                   │
│  • Pricing sheet                                         │
│  • Business hours and holiday schedule                   │
│  • FAQ or common customer questions                      │
│                                                          │
│  Tip: You can skip this and add documents later.         │
│                                                          │
│                     [← Back]  [Next →]                   │
└─────────────────────────────────────────────────────────┘

Step 7: Configure Your AI Persona
┌─────────────────────────────────────────────────────────┐
│  How should your AI receptionist sound and behave?       │
│                                                          │
│  Voice:    [Professional Female ▾]                       │
│  Greeting: "Thank you for calling DynaTire, how can I    │
│             help you today?"                             │
│                                                          │
│  Personality notes (system prompt):                      │
│  ┌─────────────────────────────────────────────┐        │
│  │ You are a friendly, professional receptionist│        │
│  │ for DynaTire. Be concise and helpful...     │        │
│  └─────────────────────────────────────────────┘        │
│                                                          │
│  Tip: We've pre-filled this based on your business type. │
│                                                          │
│                     [← Back]  [Finish Setup →]           │
└─────────────────────────────────────────────────────────┘

Step 8: You're Ready!
┌─────────────────────────────────────────────────────────┐
│  🎉 Your AI receptionist is configured!                  │
│                                                          │
│  Here's what's set up:                                   │
│  ✓ 3 services                                           │
│  ✓ 1 resource                                           │
│  ✓ 2 employees with shifts                              │
│  ✓ AI persona configured                                │
│                                                          │
│  Next steps:                                             │
│  • Assign a phone number (contact support)               │
│  • Upload business policy documents                      │
│  • Make a test call to try it out                        │
│                                                          │
│                    [Go to Dashboard →]                    │
└─────────────────────────────────────────────────────────┘
```

#### Wizard Detection Logic
The wizard should appear when ALL of the following are true for the logged-in tenant:
- `services` count = 0
- `resources` count = 0
- `employees` count = 0

Once the wizard is completed (or dismissed), it should not appear again. Store a flag like `onboarding_completed` on the tenant record or in `tenant_calendar_settings`/metadata.

#### Wizard Should Also Be Accessible Later
Add a "Setup Guide" or "Getting Started" link in Settings so owners can re-run the wizard if they want to start over or review their setup.

#### Relationship to Navigation Restructure
The wizard replaces the need for new users to discover the correct tab order themselves. After the wizard completes, they land on the Schedule (calendar) view — which is the daily-use home screen. The grouped navigation (My Team, My Business) then serves as the place to edit what they set up during onboarding.

### Business-Specific Vocabulary (Does Not Exist — Needs to Be Built)

**Current problem**: The UI uses generic terms like "Resources", "Employees", and "Services" everywhere. A salon owner thinks in terms of "Chairs" and "Stylists", not "Resources" and "Employees". A dental clinic has "Operatories" and "Hygienists", not "Resources" and "Staff". The current labels feel like enterprise software, not a tool built for their business.

**What's needed**: A vocabulary map per business type that adapts all UI labels, placeholders, empty states, and tooltips to match the language the business owner actually uses.

#### Proposed Vocabulary Map

```
business_type  | resource_label | resource_plural | employee_label | employee_plural | booking_label  | example_services
───────────────┼────────────────┼─────────────────┼────────────────┼─────────────────┼────────────────┼──────────────────
mobile-tire    | Truck          | Trucks          | Technician     | Technicians     | Appointment    | Tire Rotation, Flat Repair, Install
salon          | Chair          | Chairs          | Stylist        | Stylists        | Appointment    | Haircut, Coloring, Blowout
auto-shop      | Bay            | Bays            | Mechanic       | Mechanics       | Appointment    | Oil Change, Brake Service, Inspection
dentist        | Operatory      | Operatories     | Hygienist      | Hygienists      | Visit          | Cleaning, Exam, Crown, Filling
vet-clinic     | Exam Room      | Exam Rooms      | Vet            | Vets            | Visit          | Checkup, Vaccination, Surgery
chiropractor   | Adjustment Room| Rooms           | Doctor         | Doctors         | Visit          | Adjustment, Consultation, X-Ray
barbershop     | Chair          | Chairs          | Barber         | Barbers         | Appointment    | Haircut, Shave, Beard Trim
nail-salon     | Station        | Stations        | Nail Tech      | Nail Techs      | Appointment    | Manicure, Pedicure, Gel Nails
spa            | Treatment Room | Treatment Rooms | Therapist      | Therapists      | Session        | Massage, Facial, Body Wrap
plumber        | Van            | Vans            | Plumber        | Plumbers        | Service Call   | Leak Repair, Drain Cleaning, Install
electrician    | Van            | Vans            | Electrician    | Electricians    | Service Call   | Wiring, Panel Upgrade, Inspection
hvac           | Van            | Vans            | Technician     | Technicians     | Service Call   | AC Repair, Furnace Tune-up, Install
pest-control   | Van            | Vans            | Technician     | Technicians     | Service Call   | Inspection, Treatment, Follow-up
cleaning       | Team           | Teams           | Cleaner        | Cleaners        | Booking        | Deep Clean, Regular Clean, Move-out
landscaping    | Crew           | Crews           | Crew Lead      | Crew Leads      | Job            | Mowing, Trim, Seasonal Cleanup
personal-trainer| N/A           | N/A             | Trainer        | Trainers        | Session        | 1-on-1, Group Class, Assessment
yoga-studio    | Studio         | Studios         | Instructor     | Instructors     | Class          | Vinyasa, Hot Yoga, Meditation
tax-prep       | Office         | Offices         | Preparer       | Preparers       | Appointment    | Tax Filing, Consultation, Audit Help
tutoring       | Room           | Rooms           | Tutor          | Tutors          | Session        | Math, Science, SAT Prep, Essay Review
photography    | Studio         | Studios         | Photographer   | Photographers   | Session        | Headshots, Family Portrait, Event
```

#### Where Vocabulary Appears in the UI

Every place the UI currently says a generic term should be replaced with the business-specific label:

| Current (hardcoded) | Becomes (dynamic) | Example for salon |
|---------------------|-------------------|-------------------|
| "Resources" sidebar label | `resource_plural` | "Chairs" |
| "Add Resource" button | "Add {resource_label}" | "Add Chair" |
| "No resources yet" empty state | "No {resource_plural} yet" | "No chairs yet" |
| "Employees" sidebar label | `employee_plural` | "Stylists" |
| "Add Staff" button | "Add {employee_label}" | "Add Stylist" |
| "Manage Resources" tab title | "Manage {resource_plural}" | "Manage Chairs" |
| "Appointment" in calendar | `booking_label` | "Appointment" |
| Resource column headers in calendar | `resource_label` names | "Chair 1", "Chair 2" |
| Wizard step 3 title | "Add Your {resource_plural}" | "Add Your Chairs" |
| Wizard step 4 title | "Add Your {employee_plural}" | "Add Your Stylists" |

#### Implementation Approach

1. **Extend `business_templates` table** with vocabulary columns:
   ```sql
   ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS resource_label TEXT DEFAULT 'Resource';
   ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS resource_plural TEXT DEFAULT 'Resources';
   ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS employee_label TEXT DEFAULT 'Employee';
   ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS employee_plural TEXT DEFAULT 'Employees';
   ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS booking_label TEXT DEFAULT 'Appointment';
   ALTER TABLE business_templates ADD COLUMN IF NOT EXISTS example_services TEXT[] DEFAULT '{}';
   ```

2. **Load vocabulary into dashboard context**: The `useStaticData` hook or a new `useVocabulary` hook fetches the tenant's `business_type`, looks up the template, and provides the labels.

3. **Pass vocabulary to components**: Components receive labels as props or via context instead of hardcoding strings.

4. **Fallback**: If no template exists for a business type, fall back to the generic labels ("Resource", "Employee", "Appointment").

#### Relationship to Onboarding Wizard
The wizard should use vocabulary from the moment the user picks their business type in Step 1. Once they select "salon", all subsequent steps say "Chair" instead of "Resource" and "Stylist" instead of "Employee". This makes the wizard feel purpose-built for their business, not generic.

### Contextual Navigation
- Clicking a customer's appointment in the CRM should navigate to that appointment in the Calendar
- Clicking an employee's name in the Calendar should link to their profile in My Team
- The AI Persona view could show a "test call" button

### Breadcrumbs
For sub-tab views: `My Team > Shifts` — helps users know where they are.

### Empty States
Each view should have a helpful empty state explaining what to do:
- "No employees yet — add your first team member to start scheduling"
- "No services defined — tell us what your business offers"
- "No documents uploaded — upload your policies so the AI can answer customer questions"

---

## File Structure Reference

All dashboard components live in `dashboard/components/`:

```
dashboard/
├── app/
│   ├── page.tsx              ← Main entry (login → layout → views)
│   └── layout.tsx            ← Root layout with SessionProvider
├── components/
│   ├── OutlookLayout.tsx     ← Shell: sidebar nav + content area (NEEDS RESTRUCTURE)
│   ├── AppointmentView.tsx   ← Schedule view
│   ├── CRMView.tsx           ← Unified customer detail view
│   ├── EmployeeManagementView.tsx  ← Employee CRUD
│   ├── ShiftManagementView.tsx     ← Shift scheduling
│   ├── SkillMatrixView.tsx         ← Skill/capability grid
│   ├── ServiceAssignmentView.tsx   ← Service catalog + mappings
│   ├── ResourceManagerView.tsx     ← Resource CRUD
│   ├── KnowledgeBaseView.tsx       ← RAG document management
│   ├── AIConfigView.tsx            ← AI persona settings
│   ├── AnalyticsView.tsx           ← Business metrics
│   ├── SettingsView.tsx            ← Tenant settings + calendar sync
│   ├── SuperAdminDashboard.tsx     ← Multi-tenant admin
│   ├── LoginView.tsx               ← Login form
│   ├── ErrorBoundary.tsx           ← React error boundary
│   └── ui/                         ← Primitives (Button, Card, Input, Select, Modal, Badge)
├── lib/
│   ├── api.ts              ← Centralized API client (Api.{resource}.{action}())
│   ├── types.ts            ← TypeScript interfaces
│   ├── hooks.ts            ← useSession, useStaticData
│   ├── SessionContext.tsx   ← Auth state context
│   ├── mockData.ts         ← Mock data for development
│   ├── constants.ts        ← US states, timezones, detection
│   ├── phone.ts            ← Phone formatting utilities
│   └── utils.ts            ← Shared utilities
└── vitest.config.ts
```

---

## Design Constraints

- **Tailwind CSS only** — no external component libraries (no MUI, Chakra, etc.)
- **Lucide icons** — consistent icon set already in use
- **Dark mode support** — all changes must work in both themes
- **Mobile-first** — bottom nav on mobile, sidebar on desktop/tablet
- **No new dependencies** — use what's already installed
- **Existing UI primitives** — Button, Card, Input, Select, Modal, Badge in `components/ui/`

---

## Implementation Scope

The main changes needed:

1. **`OutlookLayout.tsx`** — Restructure sidebar from 12 items to 5 grouped sections
2. **`page.tsx`** — Update tab type and routing logic
3. **New composite views** (or wrapper components):
   - `MyTeamView.tsx` — tabs between Employees, Shifts, Skills
   - `MyBusinessView.tsx` — tabs between Services, Resources, Knowledge
   - `AIInsightsView.tsx` — tabs between AI Persona, Analytics
4. **Mobile bottom nav** — Update to match the 5 primary sections
5. **Sub-tab component** — Reusable horizontal tab bar for composite views

No backend changes required. No API changes. No database changes. Pure frontend restructure.
