# Plan: Communications & Reminders Service Integration

## Overview

The `communications/` and `reminders/` services were migrated from ai-secretary and have stub implementations with dependencies that need to be connected to ai-sec's database and service patterns.

**Current State:** Services compile and have type-level tests, but are not wired to production database or fully tested.

**Target State:** Fully integrated services with comprehensive tests, connected to ai-sec's Postgres database via the existing pool/RLS patterns.

---

## Architecture Gap Analysis

### ai-sec Pattern (current codebase)
```
Routes → withTenantClient(pool) → Direct SQL with RLS
```

### Migrated Services Pattern (from ai-secretary)
```
Service → DatabaseService interface → Abstract DB operations
Service → TenantConfigService → Tenant configuration
```

### Bridge Required
Create adapter layer that implements the expected interfaces using ai-sec's database pool.

---

## TODO Items

### Phase 1: Database Adapter Layer

- [ ] **TODO-1.1**: Create `src/database/index.ts` - DatabaseService adapter
  - Implement interface expected by reminders/communications
  - Wrap ai-sec's `getPool()` with the DatabaseService methods
  - Methods needed:
    - `createReminderSchedule(data)`
    - `getReminderSchedule(id)`
    - `updateReminderSchedule(id, data)`
    - `getReminderSchedulesByTenant(tenantId, status)`
    - `getReminderSchedulesByAppointment(appointmentId, tenantId)`
    - `getAppointmentById(id)`

- [ ] **TODO-1.2**: Create `reminder_schedules` table migration
  - Schema for storing scheduled reminders
  - Fields: id, appointment_id, tenant_id, customer_email, customer_phone, reminder_type, scheduled_for, status, error, sent_at

- [ ] **TODO-1.3**: Wire TenantConfigService to database
  - Replace `InMemoryTenantConfigService` with DB-backed implementation
  - Read tenant config from existing `tenants` table
  - Add missing columns if needed (notification preferences, contact info)

### Phase 2: Communications Service Integration

- [ ] **TODO-2.1**: Install and configure nodemailer
  ```bash
  npm install nodemailer
  npm install -D @types/nodemailer
  ```

- [ ] **TODO-2.2**: Add email environment variables
  ```
  EMAIL_USER=noreply@secretaryhq.com
  EMAIL_PASS=<app-password>
  EMAIL_FROM_NAME=Secretary HQ
  ```

- [ ] **TODO-2.3**: Wire EmailService to production SMTP
  - Configure Gmail/SendGrid/SES transporter
  - Add rate limiting for email sends
  - Add delivery tracking

- [ ] **TODO-2.4**: Wire SMSService to Telnyx
  - Provider choice: **Telnyx** (not Twilio) — we already use Telnyx for SIP trunking, keeping the telephony vendor unified. Planned as part of LiveKit migration Phase 7 (`docs/FRAMEWORK_MIGRATIONS.md`).
  - Verify TELNYX_API_KEY, TELNYX_MESSAGING_PROFILE_ID, TELNYX_PHONE_NUMBER
  - Test SMS delivery in staging
  - Add usage tracking integration

- [ ] **TODO-2.5**: Add communications API routes
  - `POST /communications/email` - Send email
  - `POST /communications/sms` - Send SMS
  - `GET /communications/history/:tenantId` - Communication history

### Phase 3: Reminders Service Integration

- [ ] **TODO-3.1**: Create reminder scheduler worker
  - Background job that processes due reminders
  - Options: node-cron (simplest) or Bull queue (if persistence/retry needed). n8n is no longer an option — removed from the stack.
  - Run every minute to check for due reminders

- [ ] **TODO-3.2**: Wire ReminderService to appointments
  - Hook into appointment creation → schedule reminders
  - Hook into appointment update → reschedule reminders
  - Hook into appointment cancellation → cancel reminders

- [ ] **TODO-3.3**: Add reminder API routes
  - `GET /reminders/:tenantId` - List scheduled reminders
  - `POST /reminders/:id/trigger` - Manually trigger a reminder
  - `DELETE /reminders/:id` - Cancel a reminder

- [ ] **TODO-3.4**: Add reminder preferences to tenant settings
  - Enable/disable reminders
  - Configure reminder timing (72h, 24h, 2h)
  - Configure channels (email, SMS, both)

### Phase 4: Comprehensive Testing

- [ ] **TODO-4.1**: Communications service tests
  - Happy paths: send email, send SMS, multi-channel appointment notifications
  - Sad paths: invalid email, no consent, provider failure, rate limit
  - Integration tests with mock SMTP/Telnyx

- [ ] **TODO-4.2**: Reminders service tests
  - Happy paths: schedule, process, trigger, cancel reminders
  - Sad paths: appointment cancelled, no consent, past appointment
  - Edge cases: timezone handling, DST transitions

- [ ] **TODO-4.3**: End-to-end tests
  - Book appointment → receive confirmation
  - Appointment approaches → receive reminders
  - Cancel appointment → reminders cancelled

### Phase 5: Production Hardening

- [ ] **TODO-5.1**: Add monitoring and alerting
  - Track email/SMS delivery success rates
  - Alert on high failure rates
  - Dashboard metrics in analytics

- [ ] **TODO-5.2**: Add retry logic
  - Retry failed communications with exponential backoff
  - Dead letter queue for permanently failed messages

- [ ] **TODO-5.3**: Add audit logging
  - Log all communications sent
  - Track consent checks
  - GDPR compliance trail

---

## Implementation Order

```
Week 1: Phase 1 (Database Adapter)
  - Day 1-2: Create DatabaseService adapter
  - Day 3: Create reminder_schedules migration
  - Day 4-5: Wire TenantConfigService to DB

Week 2: Phase 2 (Communications)
  - Day 1: Install nodemailer, configure SMTP
  - Day 2-3: Wire EmailService and SMSService
  - Day 4-5: Add API routes and basic tests

Week 3: Phase 3 (Reminders)
  - Day 1-2: Create reminder scheduler worker
  - Day 3-4: Wire to appointments lifecycle
  - Day 5: Add API routes

Week 4: Phase 4-5 (Testing & Hardening)
  - Day 1-3: Comprehensive test coverage
  - Day 4-5: Monitoring, retries, audit logging
```

---

## File Changes Summary

### New Files
```
src/database/index.ts                    # DatabaseService adapter
src/database/reminderQueries.ts          # Reminder SQL queries
src/routes/communications.ts             # Communications API routes
src/routes/reminders.ts                  # Reminders API routes
src/workers/reminderScheduler.ts         # Background reminder processor
supabase/migrations/YYYYMMDD_reminder_schedules.sql
```

### Modified Files
```
src/services/tenants/index.ts            # DB-backed implementation
src/services/communications/emailService.ts  # Production SMTP config
src/services/communications/smsService.ts    # Production Telnyx config
src/routes/appointments.ts               # Hook reminder scheduling
src/index.ts                             # Register new routes
package.json                             # Add nodemailer dependency
.env.example                             # Add email env vars
```

### Test Files
```
src/services/communications/communications.test.ts  # Expand with implementation tests
src/services/reminders/reminders.test.ts           # Expand with implementation tests
src/routes/communications.test.ts                  # API route tests
src/routes/reminders.test.ts                       # API route tests
```

---

## Dependencies

### npm packages needed
```json
{
  "nodemailer": "^6.9.x",
  "@types/nodemailer": "^6.4.x"
}
```

### Environment variables needed
```bash
# Email (Gmail example)
EMAIL_USER=noreply@secretaryhq.com
EMAIL_PASS=xxxx-xxxx-xxxx-xxxx
EMAIL_FROM_NAME=Secretary HQ

# SMS (already configured)
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Email delivery failures | High | Use reliable provider (SendGrid/SES), add retries |
| SMS costs | Medium | Implement consent checking, usage caps |
| Timezone bugs in reminders | High | Comprehensive timezone tests, use tenant timezone |
| Database migration issues | Medium | Test migration on staging first |
| Consent compliance (GDPR/TCPA) | High | Strict consent checking, audit trail |

---

## Success Criteria

1. ✅ All existing tests continue to pass
2. ✅ New tests cover happy paths, sad paths with 5Ws, edge cases
3. ✅ Appointment confirmation emails/SMS sent on booking
4. ✅ Reminders sent at configured intervals (72h, 24h, 2h)
5. ✅ Reminders cancelled when appointment cancelled
6. ✅ Consent is checked before every communication
7. ✅ Usage is tracked for billing
8. ✅ < 1% communication delivery failure rate

---

## Related Documentation

- `docs/ARCHITECTURE_REVIEW_20260403.md` - Overall architecture
- `CLAUDE.md` - Project conventions (incl. "Migrated, Not Yet Wired" section)
- `NEEDS-REFACTORING.md` #1, #2, #3 — open decisions about CRM adapters,
  TenantConfigService wiring, and UsageTrackingService
