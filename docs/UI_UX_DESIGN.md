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

### Onboarding Checklist
For new tenants, show a setup wizard or checklist:
1. Add your services (what do you offer?)
2. Add your resources (bays, trucks, chairs)
3. Add your employees and their shifts
4. Upload your business policies (Knowledge Base)
5. Configure your AI persona (voice, greeting, system prompt)
6. You're ready — assign a phone number!

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
