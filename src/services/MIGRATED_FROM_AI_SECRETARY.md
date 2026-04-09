# Components Migrated from ai-secretary

This document tracks components migrated from the ai-secretary project.

## Migrated Components

### 1. CRM Adapters (`/src/services/crm/`)

A unified CRM adapter interface with 21 provider implementations:

- **Types & Base** (`types.ts`) - Base adapter class and interfaces
- **Adapters** (`adapters/`) - Provider implementations:
  - GoHighLevel, Acuity, Booksy, Calendly
  - Dentrix, Eaglesoft (dental)
  - Fresha, GlossGenius, Vagaro (salon/spa)
  - HoneyBook, SeventeenHats (creative services)
  - HouseCallPro, ServiceM8, Jobber (field services)
  - MindBody, Zenoti (wellness)
  - Salesforce, Pipedrive, Zoho, HubSpot (CRM)
  - Millennium, SimplyBook, Setmore (scheduling)

**Note**: These complement the existing ai-sec clients (`hubspotClient.ts`, `jobberClient.ts`, etc.)
by providing a consistent interface pattern for future integrations.

### 2. Reminder System (`/src/services/reminders/`)

Complete appointment reminder system:

- `index.ts` - ReminderService with scheduling logic
- `reminderProcessor.ts` - Processes and sends reminders
- `reminderScheduler.ts` - Schedules reminders for appointments
- `reminderRepository.ts` - Database operations
- `types.ts` - Type definitions

**Integration**: Requires database tables for `reminder_schedules`. See ai-secretary migrations.

### 3. Consent/Compliance Service (`/src/services/consentService.ts`)

GDPR/TCPA-compliant consent management:

- Record and check communication consent (email/SMS)
- Process opt-out commands (STOP, UNSUBSCRIBE)
- Track consent history with audit trail

**Integration**: Requires `consent_records` and `opt_out_records` tables.

### 4. Communications Services (`/src/services/communications/`)

Multi-channel communication system:

- `emailService.ts` - Email sending via Nodemailer
- `emailTemplates.ts` - Ready-to-use email templates for appointments
- `smsService.ts` - SMS sending service
- `TwilioAdapter.ts` - Twilio integration for voice/SMS
- `MockAdapter.ts` - Testing adapter
- `ProviderRegistry.ts` - Provider abstraction
- `appointmentService.ts` - Appointment notification orchestration

**Note**: ai-sec uses Vapi for voice. These services can serve as:
- Fallback for non-voice SMS/email
- Alternative for tenants without Vapi

### 5. Business Templates (`/src/templates/*.yaml`)

Industry-specific configuration templates:

- `salon_v1.yaml` - Salon/Spa businesses
- `medical_v1.yaml` - Medical/Healthcare
- `automotive_v1.yaml` - Auto shops
- `auto_bays_v1.yaml` - Bay-based auto services
- `mobile_tire_v1.yaml` - Mobile tire services
- `ai_platform_v1.yaml` - AI platform defaults

These define:
- Custom schema fields per business type
- AI prompt modifiers
- UI terminology (e.g., "Stylist" vs "Technician")
- Default workflows

### 6. CI/CD Workflows (`.github/workflows/`)

GitHub Actions workflows:

- `ci.yml` - Main CI pipeline
- `ci-smoke-assume-tenant.yml` - Multi-tenant smoke tests
- `ci-smoke-calendar-appointments.yml` - Calendar integration tests
- `pr-smoke-servers.yml` - PR server validation
- `check-docs.yml` - Documentation checks
- `pnpm-workspace-sanity.yml` - Workspace validation

## Not Migrated (Reference Only)

### Customer Portal (`client/portal/`)
A Vite+React booking portal. Consider migrating if customer-facing booking UI is needed.

### Voice Services
ai-secretary used Twilio for voice. ai-sec uses Vapi - these aren't compatible.

## Integration Notes

1. **Database Schema**: Some services require additional tables. Check ai-secretary migrations.

2. **Import Paths**: All imports have been updated for ai-sec's structure.

3. **Token Management**: CRM adapters use `TokenManagerInterface` which is compatible with
   ai-sec's existing `tokenManagement.ts` pattern.

4. **Testing**: Original tests were not migrated. Add tests as you integrate each component.
