# UI/UX Handoff Guide: Claude Web → Claude Code

This document tells the Claude web UI/UX session what to produce so Claude Code can implement it directly.

---

## Goal

Claude web designs actual React/TSX pages with Tailwind CSS. The user reviews and fine-tunes them visually. Claude Code then wires them into the existing Next.js dashboard — routing, API calls, state management, and data binding.

---

## What Claude Web Should Produce

### Deliverable: Actual React Components

For each screen, produce a **self-contained React component** saved to `dashboard/components/mockups/`. These should be real TSX files that render in the browser with hardcoded/mock data. Claude Code will later replace the mock data with real API calls.

```
dashboard/components/mockups/
├── SignUpPage.tsx           ← Public registration page
├── OnboardingStep1.tsx      ← Business type picker
├── OnboardingStep2.tsx      ← Services setup
├── OnboardingStep3.tsx      ← Resources setup
├── OnboardingStep4.tsx      ← Employees setup
├── OnboardingStep5.tsx      ← Shifts setup
├── OnboardingStep6.tsx      ← Knowledge base upload
├── OnboardingStep7.tsx      ← AI persona config
├── OnboardingStep8.tsx      ← Completion/summary
├── DashboardHome.tsx        ← Quick actions landing page
├── SettingsLabels.tsx       ← Customize vocabulary labels
├── EmptyStateExamples.tsx   ← Empty states for each view
├── BreadcrumbNav.tsx        ← Breadcrumb component
└── MobileSubTabDemo.tsx     ← Mobile sub-tab scrollable bar
```

### Each Component Should

1. **Import from existing UI primitives:**
   ```tsx
   import { Button } from '../ui/Button'
   import { Card } from '../ui/Card'
   import { Input } from '../ui/Input'
   import { Select } from '../ui/Select'
   import { Badge } from '../ui/Badge'
   // Modal is also available from '../ui/Modal'
   ```

2. **Use the existing Tailwind color system:**
   - Primary: `blue-600` / `dark:blue-400`
   - Background: `white` / `dark:bg-[#111]`
   - Surface: `gray-50` / `dark:bg-[#1a1a1a]`
   - Elevated: `white` / `dark:bg-[#222]`
   - Border: `gray-200` / `dark:border-gray-800`
   - Text: `gray-900` / `dark:text-gray-100`
   - Muted text: `gray-500` / `dark:text-gray-400`
   - Success: `green-600` / Danger: `red-600` / Warning: `yellow-600`

3. **Use Lucide icons** (already installed):
   ```tsx
   import { Calendar, Users, ShieldCheck, Wrench, Bot, ChevronRight, Check, X } from 'lucide-react'
   ```

4. **Support dark mode** — every color class needs a `dark:` variant.

5. **Be responsive** — mobile-first, use `md:` breakpoint for desktop layout.

6. **Use hardcoded mock data** — not API calls. Example:
   ```tsx
   const MOCK_SERVICES = [
     { id: 1, name: 'Haircut', duration: 30, price: 25 },
     { id: 2, name: 'Coloring', duration: 60, price: 80 },
   ]
   ```

---

## Screens to Design (10 Remaining Items)

### Priority 1: Sign-Up & Onboarding (Items #8, #10, #11)

**Screen: Sign-Up Page** (`SignUpPage.tsx`)
- Public page, no auth required
- Fields: Business Name, Owner Name, Email, Password
- Business type picker: card grid with icons for all 20 types
- Each card shows: icon, display_name, short description
- Selecting a card highlights it (blue border)
- "Create My Account" button at bottom
- Mobile: cards stack 2-wide, scrollable

**Screens: Onboarding Wizard Steps 1-8** (`OnboardingStep1.tsx` through `OnboardingStep8.tsx`)
- Full-page wizard with progress indicator (step dots or progress bar)
- Back/Next navigation at bottom
- Each step uses vocabulary from the selected business type
- Step 1: Confirm business info (pre-filled from sign-up)
- Step 2: Add services (with example_services pre-filled as suggestions)
- Step 3: Add resources (use resource_label/resource_plural from vocabulary)
- Step 4: Add employees (use employee_label/employee_plural from vocabulary)
- Step 5: Set working hours per employee
- Step 6: Upload policy documents (drag & drop or file picker)
- Step 7: AI persona (system prompt, voice picker, greeting message)
- Step 8: Summary with checkmarks + "Go to Dashboard" button

Reference the detailed wireframes in `docs/UI_UX_DESIGN.md` under "Onboarding Wizard" section.

### Priority 2: Dashboard Home (Item #19)

**Screen: Dashboard Home** (`DashboardHome.tsx`)
- Landing page shown instead of defaulting to Calendar
- Cards showing: Today's appointments count, Upcoming this week, Recent AI calls, Staff on shift
- Quick action buttons: "New Appointment", "Add Customer", "Upload Document"
- Recent activity feed (last 5 call summaries)

### Priority 3: Settings & Labels (Item #18)

**Screen: Customize Labels** (`SettingsLabels.tsx`)
- Section within Settings view (or standalone for mockup)
- Form fields for: resource_label, resource_plural, employee_label, employee_plural, booking_label
- Placeholder text shows template default (e.g., "Bay" for auto-shop)
- "Reset to Defaults" and "Save Changes" buttons
- Preview section showing how labels will appear in the UI

### Priority 4: Empty States (Item #22)

**Screen: Empty State Examples** (`EmptyStateExamples.tsx`)
- Show empty states for: Schedule, Customers, My Team > Employees, My Business > Services, Knowledge Base
- Each should have: illustration/icon, helpful message, CTA button
- Example: "No stylists yet — add your first team member to start scheduling" with "Add Stylist" button
- Use vocabulary-aware labels in the messages

### Priority 5: Navigation Polish (Items #21, #24)

**Component: Breadcrumbs** (`BreadcrumbNav.tsx`)
- Shows current location: "My Team > Shifts"
- Clickable parent link
- Compact, sits below the sub-tab bar

**Component: Setup Guide Link** — Add to Settings view mockup
- "Re-run Setup Wizard" button or "Getting Started" section

### Lower Priority: Contextual Navigation (Item #20)

This can be deferred — it's a behavior change (clicking an appointment in CRM navigates to Calendar), not a new screen.

---

## What Claude Web Should NOT Do

- Don't redesign the sidebar — it's already implemented with 5 sections
- Don't redesign CRMView, AppointmentView, or other working views
- Don't change the sub-tab pattern (already implemented in MyTeamView, MyBusinessView, AIInsightsView)
- Don't add new npm dependencies
- Don't write API integration code — just use mock data
- Don't worry about auth/routing — Claude Code handles that

---

## Existing Component Reference

These UI primitives are available in `dashboard/components/ui/`:

### Button
```tsx
<Button variant="primary|secondary|danger|ghost" size="sm|md" isLoading={bool} onClick={fn}>
  Label
</Button>
```

### Card
```tsx
<Card title="Section Title" className="max-w-2xl">
  {children}
</Card>
```

### Input
```tsx
<Input label="Field Name" value={val} onChange={fn} placeholder="hint text" type="text|email|password" />
```

### Select
```tsx
<Select label="Pick One" value={val} onChange={fn} options={[{ label: 'Display', value: 'key' }]} />
```

### Badge
```tsx
<Badge variant="primary|secondary|success|danger|warning">Label</Badge>
```

### Modal
```tsx
<Modal isOpen={bool} onClose={fn} title="Dialog Title">
  {children}
</Modal>
```

---

## Current Color Palette (Tailwind)

| Purpose | Light | Dark |
|---------|-------|------|
| Page background | `bg-white` | `dark:bg-[#111]` |
| Surface/card | `bg-gray-50` | `dark:bg-[#1a1a1a]` |
| Elevated surface | `bg-white` | `dark:bg-[#222]` |
| Selected/active | `bg-white shadow-sm` | `dark:bg-[#333]` |
| Primary accent | `text-blue-600` | `dark:text-blue-400` |
| Border | `border-gray-200` | `dark:border-gray-800` |
| Text primary | `text-gray-900` | `dark:text-gray-100` |
| Text secondary | `text-gray-500` | `dark:text-gray-400` |
| Text muted | `text-gray-400` | `dark:text-gray-600` |
| Hover | `hover:bg-gray-100` | `dark:hover:bg-[#333]` |
| Input bg | `bg-gray-100` | `dark:bg-[#222]` |

---

## Vocabulary Data for Mockups

Use these in mockups to show how labels adapt per business type:

**Salon example:**
```tsx
const vocab = { resource_label: 'Chair', resource_plural: 'Chairs', employee_label: 'Stylist', employee_plural: 'Stylists', booking_label: 'Appointment' }
```

**Auto shop example:**
```tsx
const vocab = { resource_label: 'Bay', resource_plural: 'Bays', employee_label: 'Mechanic', employee_plural: 'Mechanics', booking_label: 'Appointment' }
```

**Dental clinic example:**
```tsx
const vocab = { resource_label: 'Operatory', resource_plural: 'Operatories', employee_label: 'Hygienist', employee_plural: 'Hygienists', booking_label: 'Visit' }
```

---

## How to Hand Back to Claude Code

Once the user has approved the mockup screens in Claude web:

1. Save all TSX files to `dashboard/components/mockups/`
2. Copy the full file contents into `docs/UI_MOCKUPS.md` as code blocks (backup)
3. Tell Claude Code: "Mockups are in dashboard/components/mockups/ — wire them up"

Claude Code will then:
- Replace mock data with real API calls
- Add routing (sign-up page, onboarding flow)
- Integrate vocabulary via `Api.vocabulary.get()`
- Connect to existing state management (SessionContext)
- Add to the navigation flow
- Write tests
