#!/usr/bin/env node
/**
 * scripts/migrate-tests.mjs
 *
 * Moves all backend test files from their current locations inside src/ into a
 * parallel tests/ tree, and rewrites every relative import path in each moved
 * file so it still resolves correctly from the new location.
 *
 * Run: node scripts/migrate-tests.mjs
 * Dry-run: node scripts/migrate-tests.mjs --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

// ── File move manifest ────────────────────────────────────────────────
// [source, destination] — paths relative to ROOT.
// Sources that conflict on the same destination base name get disambiguated.
const MOVES = [
  // ── Test infrastructure ──────────────────────────────────────────────
  ['src/test-utils.ts', 'tests/utils.ts'],
  ['src/test-utils-mock.ts', 'tests/mock.ts'],

  // ── src/ root → tests/ ──────────────────────────────────────────────

  // agentTools group → tests/routes/agentTools/
  ['src/agentTools.test.ts', 'tests/routes/agentTools/agentTools.test.ts'],
  ['src/agentToolsAiCost.test.ts', 'tests/routes/agentTools/agentToolsAiCost.test.ts'],
  ['src/agentToolsAiCost.realdb.test.ts', 'tests/integration/agentToolsAiCost.realdb.test.ts'],
  ['src/agentToolsBookingIntegration.test.ts', 'tests/routes/agentTools/agentToolsBookingIntegration.test.ts'],
  ['src/agentToolsCancel.test.ts', 'tests/routes/agentTools/agentToolsCancel.test.ts'],
  ['src/agentToolsCancelReschedule.realdb.test.ts', 'tests/integration/agentToolsCancelReschedule.realdb.test.ts'],
  ['src/agentToolsCustomerHistory.test.ts', 'tests/routes/agentTools/agentToolsCustomerHistory.test.ts'],
  ['src/agentToolsCustomerSearch.realdb.test.ts', 'tests/integration/agentToolsCustomerSearch.realdb.test.ts'],
  ['src/agentToolsMessages.realdb.test.ts', 'tests/integration/agentToolsMessages.realdb.test.ts'],
  ['src/agentToolsPageOwner.test.ts', 'tests/routes/agentTools/agentToolsPageOwner.test.ts'],
  ['src/agentToolsPreferences.test.ts', 'tests/routes/agentTools/agentToolsPreferences.test.ts'],
  ['src/agentToolsRecordConsent.realdb.test.ts', 'tests/integration/agentToolsRecordConsent.realdb.test.ts'],
  ['src/agentToolsSelfServiceLink.test.ts', 'tests/routes/agentTools/agentToolsSelfServiceLink.test.ts'],
  ['src/agentToolsTakeMessage.test.ts', 'tests/routes/agentTools/agentToolsTakeMessage.test.ts'],
  ['src/tools.test.ts', 'tests/routes/agentTools/tools.test.ts'],

  // analytics
  ['src/analytics.firstTimeFix.realdb.test.ts', 'tests/integration/analytics.firstTimeFix.realdb.test.ts'],
  ['src/analytics.realdb.test.ts', 'tests/integration/analytics.realdb.test.ts'],
  ['src/analytics.test.ts', 'tests/routes/analytics.test.ts'],
  ['src/analyticsUtilization.realdb.test.ts', 'tests/integration/analyticsUtilization.realdb.test.ts'],

  // appointments / booking
  ['src/appointment-date-filter.test.ts', 'tests/routes/appointment-date-filter.test.ts'],
  ['src/appointment-mutations.test.ts', 'tests/routes/appointment-mutations.test.ts'],
  ['src/available-slots-consolidated.test.ts', 'tests/routes/available-slots-consolidated.test.ts'],
  ['src/available-slots.test.ts', 'tests/routes/available-slots.test.ts'],
  ['src/book-appointment-mapping.test.ts', 'tests/routes/book-appointment-mapping.test.ts'],
  ['src/booking-buffer.test.ts', 'tests/routes/booking-buffer.test.ts'],
  ['src/booking-concurrency.test.ts', 'tests/routes/booking-concurrency.test.ts'],
  ['src/booking-soft-delete.test.ts', 'tests/routes/booking-soft-delete.test.ts'],

  // auth / billing / provisioning
  ['src/auth.test.ts', 'tests/routes/auth.test.ts'],
  ['src/billing-routes.test.ts', 'tests/routes/billing-routes.test.ts'],
  ['src/billing.test.ts', 'tests/routes/billing.test.ts'],
  ['src/provisioning.test.ts', 'tests/routes/provisioning.test.ts'],
  ['src/jwt-logging.test.ts', 'tests/routes/jwt-logging.test.ts'],
  ['src/token-refresh.test.ts', 'tests/routes/token-refresh.test.ts'],
  ['src/webhook-signatures.test.ts', 'tests/routes/webhook-signatures.test.ts'],

  // customers / CRM
  ['src/customer.test.ts', 'tests/routes/customer.test.ts'],
  ['src/customerDelete.realdb.test.ts', 'tests/integration/customerDelete.realdb.test.ts'],
  ['src/crm-appointments.test.ts', 'tests/routes/crm-appointments.test.ts'],
  ['src/square-routes.test.ts', 'tests/routes/square-routes.test.ts'],

  // coverage / analytics routes
  ['src/coverage-gaps.test.ts', 'tests/routes/coverage-gaps.test.ts'],
  ['src/coverage-ui-consistency.test.ts', 'tests/routes/coverage-ui-consistency.test.ts'],
  ['src/coverage.test.ts', 'tests/routes/coverage.test.ts'],
  ['src/coverageDryRun.realdb.test.ts', 'tests/integration/coverageDryRun.realdb.test.ts'],

  // demo
  ['src/demo-route.test.ts', 'tests/routes/demo-route.test.ts'],
  ['src/demo-seed.test.ts', 'tests/services/demo-seed.test.ts'],

  // knowledge routes
  ['src/knowledge-import-document.test.ts', 'tests/routes/knowledge-import-document.test.ts'],
  ['src/knowledge-normalization.test.ts', 'tests/services/knowledge-normalization.test.ts'],
  ['src/knowledge-policy-answer.test.ts', 'tests/routes/knowledge-policy-answer.test.ts'],

  // shifts / scheduling routes
  ['src/shift-overrides-edge.test.ts', 'tests/routes/shift-overrides-edge.test.ts'],
  ['src/shift-overrides-routes.test.ts', 'tests/routes/shift-overrides-routes.test.ts'],
  ['src/shifts-routes.test.ts', 'tests/routes/shifts-routes.test.ts'],

  // skills / services routes
  ['src/service-catalog.test.ts', 'tests/routes/service-catalog.test.ts'],
  ['src/service-enhancements.test.ts', 'tests/routes/service-enhancements.test.ts'],
  ['src/skill-resource-matching-sweep.test.ts', 'tests/services/skill-resource-matching-sweep.test.ts'],

  // tenants / users / setup
  ['src/crud-routes.test.ts', 'tests/routes/crud-routes.test.ts'],
  ['src/multi-tenant-isolation.test.ts', 'tests/regression/multi-tenant-isolation.test.ts'],
  ['src/solo-wizard.test.ts', 'tests/routes/solo-wizard.test.ts'],
  ['src/tenant-fk-cascade.test.ts', 'tests/regression/tenant-fk-cascade.test.ts'],
  ['src/tenant-reorder.test.ts', 'tests/routes/tenant-reorder.test.ts'],
  ['src/tenant-routes.test.ts', 'tests/routes/tenant-routes.test.ts'],
  ['src/tenants-notification-prefs.test.ts', 'tests/routes/tenants-notification-prefs.test.ts'],
  ['src/tenants-postgres-config.test.ts', 'tests/routes/tenants-postgres-config.test.ts'],
  ['src/tenants-update-config-loop.test.ts', 'tests/routes/tenants-update-config-loop.test.ts'],
  ['src/users-routes.test.ts', 'tests/routes/users-routes.test.ts'],
  ['src/setupCommit.realdb.test.ts', 'tests/integration/setupCommit.realdb.test.ts'],

  // version / vocabulary / voice
  ['src/unanswered-questions.test.ts', 'tests/routes/unanswered-questions.test.ts'],
  ['src/versionHistory.realdb.test.ts', 'tests/integration/versionHistory.realdb.test.ts'],
  ['src/versionHistory.test.ts', 'tests/routes/versionHistory.test.ts'],
  ['src/vocabulary-wiring.test.ts', 'tests/routes/vocabulary-wiring.test.ts'],
  ['src/vocabulary.test.ts', 'tests/routes/vocabulary.test.ts'],
  ['src/voice-ai-fixes.test.ts', 'tests/regression/voice-ai-fixes.test.ts'],
  ['src/voice.realdb.test.ts', 'tests/integration/voice.realdb.test.ts'],
  ['src/voice.test.ts', 'tests/routes/voice.test.ts'],

  // services (from src/ root — they tested services)
  ['src/availability-search.test.ts', 'tests/services/availability-search.test.ts'],
  ['src/calendar-sync.test.ts', 'tests/services/calendar-sync.test.ts'],
  ['src/deadlock-prevention.test.ts', 'tests/services/deadlock-prevention.test.ts'],
  ['src/expand-weekly-integration.test.ts', 'tests/services/expand-weekly-integration.test.ts'],
  ['src/google-calendar.test.ts', 'tests/services/google-calendar.test.ts'],
  ['src/metrics.test.ts', 'tests/services/metrics.test.ts'],
  ['src/multiEmployeeScheduling.realdb.test.ts', 'tests/integration/multiEmployeeScheduling.realdb.test.ts'],
  ['src/night-shift-availability.test.ts', 'tests/services/night-shift-availability.test.ts'],
  ['src/normalizer.test.ts', 'tests/services/normalizer.test.ts'],
  ['src/oauthCallbackFactory.test.ts', 'tests/services/oauthCallbackFactory.test.ts'],
  ['src/outlook-calendar.test.ts', 'tests/services/outlook-calendar.test.ts'],
  ['src/poolExhaustion.test.ts', 'tests/services/poolExhaustion.test.ts'],
  ['src/queryExpander.test.ts', 'tests/services/queryExpander.test.ts'],
  ['src/rag-normalization.test.ts', 'tests/services/rag-normalization.test.ts'],
  ['src/reminder-retry-worker.test.ts', 'tests/services/reminder-retry-worker.test.ts'],
  ['src/scheduling-atomic.test.ts', 'tests/services/scheduling-atomic.test.ts'],
  ['src/scheduling-overrides.test.ts', 'tests/services/scheduling-overrides.test.ts'],
  ['src/scheduling-timezone-bug.test.ts', 'tests/services/scheduling-timezone-bug.test.ts'],
  ['src/scheduling.test.ts', 'tests/services/scheduling.test.ts'],
  ['src/square-client.test.ts', 'tests/services/square-client.test.ts'],
  ['src/square-sync.test.ts', 'tests/services/square-sync.test.ts'],
  ['src/sync-orchestrator.test.ts', 'tests/services/sync-orchestrator.test.ts'],
  ['src/tokenManagement.test.ts', 'tests/services/tokenManagement.test.ts'],

  // regression / schema
  ['src/architecture-review-fixes.test.ts', 'tests/regression/architecture-review-fixes.test.ts'],
  ['src/bugfix-comprehensive.test.ts', 'tests/regression/bugfix-comprehensive.test.ts'],
  ['src/critical-bugs.test.ts', 'tests/regression/critical-bugs.test.ts'],
  ['src/high-bugs.test.ts', 'tests/regression/high-bugs.test.ts'],
  ['src/low-bugs.test.ts', 'tests/regression/low-bugs.test.ts'],
  ['src/medium-bugs.test.ts', 'tests/regression/medium-bugs.test.ts'],
  ['src/pk-extension-tables.test.ts', 'tests/regression/pk-extension-tables.test.ts'],
  ['src/pk-rename-coverage.test.ts', 'tests/regression/pk-rename-coverage.test.ts'],
  ['src/type-safety.test.ts', 'tests/regression/type-safety.test.ts'],

  // root-level source tests
  ['src/index.test.ts', 'tests/index.test.ts'],
  ['src/jsonContentTypeParser.test.ts', 'tests/jsonContentTypeParser.test.ts'],
  ['src/middleware-helpers.test.ts', 'tests/middleware-helpers.test.ts'],
  ['src/middleware.test.ts', 'tests/middleware.test.ts'],
  ['src/readinessHandler.test.ts', 'tests/readinessHandler.test.ts'],
  ['src/test-utils-mock.test.ts', 'tests/mock.test.ts'],

  // integration tests that were in src/ root
  ['src/rls.test.ts', 'tests/integration/rls.test.ts'],
  ['src/schema.test.ts', 'tests/integration/schema.test.ts'],

  // ── src/routes/ → tests/ ────────────────────────────────────────────
  ['src/routes/appointments.test.ts', 'tests/routes/appointments.test.ts'],
  ['src/routes/auditLog.test.ts', 'tests/routes/auditLog.test.ts'],
  ['src/routes/auditLog.realdb.test.ts', 'tests/integration/auditLog.realdb.test.ts'],
  // billing conflict: src/billing.test.ts → tests/routes/billing.test.ts (above)
  // so src/routes/billing.test.ts → tests/routes/billing.route.test.ts
  ['src/routes/billing.test.ts', 'tests/routes/billing.route.test.ts'],
  ['src/routes/communications.test.ts', 'tests/routes/communications.test.ts'],
  ['src/routes/communications.realdb.test.ts', 'tests/integration/communications.realdb.test.ts'],
  ['src/routes/customers.import.test.ts', 'tests/routes/customers.import.test.ts'],
  ['src/routes/customers.import.realdb.test.ts', 'tests/integration/customers.import.realdb.test.ts'],
  ['src/routes/employees.realdb.test.ts', 'tests/integration/employees.realdb.test.ts'],
  ['src/routes/exportData.test.ts', 'tests/routes/exportData.test.ts'],
  ['src/routes/exportData.realdb.test.ts', 'tests/integration/exportData.realdb.test.ts'],
  ['src/routes/knowledge.explain.test.ts', 'tests/routes/knowledge.explain.test.ts'],
  ['src/routes/knowledge.importWebsite.test.ts', 'tests/routes/knowledge.importWebsite.test.ts'],
  ['src/routes/knowledge.suggestions.test.ts', 'tests/routes/knowledge.suggestions.test.ts'],
  ['src/routes/mappings.test.ts', 'tests/routes/mappings.test.ts'],
  // provisioning conflict: src/provisioning.test.ts → tests/routes/provisioning.test.ts (above)
  // so src/routes/provisioning.test.ts → tests/routes/provisioning.route.test.ts
  ['src/routes/provisioning.test.ts', 'tests/routes/provisioning.route.test.ts'],
  ['src/routes/reminders.deliveryStats.test.ts', 'tests/routes/reminders.deliveryStats.test.ts'],
  ['src/routes/reminders.deliveryStats.realdb.test.ts', 'tests/integration/reminders.deliveryStats.realdb.test.ts'],
  ['src/routes/routeHelpers.test.ts', 'tests/routes/routeHelpers.test.ts'],
  ['src/routes/selfService.test.ts', 'tests/routes/selfService.test.ts'],
  ['src/routes/selfService.realdb.test.ts', 'tests/integration/selfService.realdb.test.ts'],
  ['src/routes/skills.test.ts', 'tests/routes/skills.test.ts'],
  ['src/routes/skills.realdb.test.ts', 'tests/integration/skills.realdb.test.ts'],
  ['src/routes/tenants.realdb.test.ts', 'tests/integration/tenants.realdb.test.ts'],
  ['src/routes/users.realdb.test.ts', 'tests/integration/users.realdb.test.ts'],
  ['src/routes/users.revokeSessions.realdb.test.ts', 'tests/integration/users.revokeSessions.realdb.test.ts'],

  // ── src/services/ → tests/ ──────────────────────────────────────────
  ['src/services/appointmentValidation.test.ts', 'tests/services/appointmentValidation.test.ts'],
  ['src/services/conflictLookup.test.ts', 'tests/services/conflictLookup.test.ts'],
  ['src/services/consentService.test.ts', 'tests/services/consentService.test.ts'],
  ['src/services/crmDisconnect.test.ts', 'tests/services/crmDisconnect.test.ts'],
  ['src/services/crmSync.realdb.test.ts', 'tests/integration/crmSync.realdb.test.ts'],
  ['src/services/crmSyncStatus.test.ts', 'tests/services/crmSyncStatus.test.ts'],
  ['src/services/csv.test.ts', 'tests/services/csv.test.ts'],
  ['src/services/customerLookup.test.ts', 'tests/services/customerLookup.test.ts'],
  ['src/services/envWarnings.test.ts', 'tests/services/envWarnings.test.ts'],
  ['src/services/expandWeeklyToSchedule.test.ts', 'tests/services/expandWeeklyToSchedule.test.ts'],
  ['src/services/featureReadiness.test.ts', 'tests/services/featureReadiness.test.ts'],
  ['src/services/knowledgeIngestion.test.ts', 'tests/services/knowledgeIngestion.test.ts'],
  ['src/services/logger.test.ts', 'tests/services/logger.test.ts'],
  ['src/services/nameUtils.test.ts', 'tests/services/nameUtils.test.ts'],
  ['src/services/oauthStateJwt.test.ts', 'tests/services/oauthStateJwt.test.ts'],
  ['src/services/phoneLoopGuard.test.ts', 'tests/services/phoneLoopGuard.test.ts'],
  ['src/services/phoneUtils.test.ts', 'tests/services/phoneUtils.test.ts'],
  ['src/services/provisioningService.test.ts', 'tests/services/provisioningService.test.ts'],
  ['src/services/scanRateLimit.test.ts', 'tests/services/scanRateLimit.test.ts'],
  ['src/services/selfServiceToken.test.ts', 'tests/services/selfServiceToken.test.ts'],
  ['src/services/sentry.test.ts', 'tests/services/sentry.test.ts'],
  ['src/services/serviceResolver.test.ts', 'tests/services/serviceResolver.test.ts'],
  ['src/services/serviceResolver.realdb.test.ts', 'tests/integration/serviceResolver.realdb.test.ts'],
  ['src/services/syncOrchestrator.test.ts', 'tests/services/syncOrchestrator.test.ts'],
  ['src/services/syncPaginate.test.ts', 'tests/services/syncPaginate.test.ts'],
  ['src/services/telnyxSms.test.ts', 'tests/services/telnyxSms.test.ts'],
  ['src/services/timezoneUtils.test.ts', 'tests/services/timezoneUtils.test.ts'],
  // communications subdir
  ['src/services/communications/TelnyxSmsAdapter.test.ts', 'tests/services/communications/TelnyxSmsAdapter.test.ts'],
  ['src/services/communications/communicationHistory.test.ts', 'tests/services/communications/communicationHistory.test.ts'],
  ['src/services/communications/communications.test.ts', 'tests/services/communications/communications.test.ts'],
  ['src/services/communications/emailService.test.ts', 'tests/services/communications/emailService.test.ts'],
  ['src/services/communications/smsRateLimit.test.ts', 'tests/services/communications/smsRateLimit.test.ts'],
  ['src/services/communications/smsServiceMetrics.test.ts', 'tests/services/communications/smsServiceMetrics.test.ts'],
  // reminders subdir
  ['src/services/reminders/reminderProcessor-metrics.test.ts', 'tests/services/reminders/reminderProcessor-metrics.test.ts'],
  ['src/services/reminders/reminders.test.ts', 'tests/services/reminders/reminders.test.ts'],
  ['src/services/reminders/retryPolicy.test.ts', 'tests/services/reminders/retryPolicy.test.ts'],
  ['src/services/reminders/scheduleForAppointment.test.ts', 'tests/services/reminders/scheduleForAppointment.test.ts'],
  ['src/services/reminders/scheduleForAppointment.realdb.test.ts', 'tests/integration/scheduleForAppointment.realdb.test.ts'],
  // tenants subdir
  ['src/services/tenants/bootstrap.test.ts', 'tests/services/tenants/bootstrap.test.ts'],

  // ── src/workers/ → tests/ ───────────────────────────────────────────
  ['src/workers/voiceSessionReaper.test.ts', 'tests/workers/voiceSessionReaper.test.ts'],
  ['src/workers/voiceSessionReaper.realdb.test.ts', 'tests/integration/voiceSessionReaper.realdb.test.ts'],

  // ── src/database/ → tests/ ──────────────────────────────────────────
  ['src/database/database.test.ts', 'tests/database/database.test.ts'],
];

// ── Import path fixer ─────────────────────────────────────────────────

// Build a reverse-lookup: absolute old path → absolute new path
// Used when a moved file is *also imported by* another moved file (e.g. test-utils).
const absOldToNew = new Map();
for (const [src, dest] of MOVES) {
  absOldToNew.set(path.resolve(ROOT, src), path.resolve(ROOT, dest));
  // Also register without extension so bare imports resolve
  absOldToNew.set(path.resolve(ROOT, src.replace(/\.ts$/, '')), path.resolve(ROOT, dest.replace(/\.ts$/, '')));
}

/**
 * Rewrite all relative import/require paths inside `content` so they are
 * correct when the file lives at `newFileAbs` instead of `oldFileAbs`.
 */
function fixImports(content, oldFileAbs, newFileAbs) {
  const oldDir = path.dirname(oldFileAbs);
  const newDir = path.dirname(newFileAbs);

  // Match: from '...' | static import '...' | dynamic import('...') | require('...') | vi.mock('...')
  // Only process relative paths (starting with . or ..)
  return content.replace(
    /(?:from\s+|import\s*\(|require\s*\(|vi\.mock\s*\()(['"])((?:\.\.?\/)[^'"]+)\1/g,
    (match, quote, importPath) => {
      // Resolve the import target from the OLD location
      const absoluteTarget = path.resolve(oldDir, importPath);

      // Normalise: strip .js extension before lookup (TS files are sometimes
      // imported as .js for ESM compatibility — e.g. './test-utils-mock.js').
      const lookupTarget = absoluteTarget.replace(/\.js$/, '');

      // Check if this target is also being moved
      const movedTarget =
        absOldToNew.get(lookupTarget) ??
        absOldToNew.get(lookupTarget + '.ts')?.replace(/\.ts$/, '') ??
        null;
      const resolvedTarget = movedTarget ?? absoluteTarget;

      // Recalculate relative path from the NEW file location
      let newRelative = path.relative(newDir, resolvedTarget);

      // Normalise: always use forward slashes, always start with ./
      newRelative = newRelative.split(path.sep).join('/');
      if (!newRelative.startsWith('.')) {
        newRelative = './' + newRelative;
      }

      // Reconstruct the original match shape (from/import/require + quote style)
      return match.replace(importPath, newRelative);
    }
  );
}

// ── Execute ───────────────────────────────────────────────────────────

let moved = 0;
let skipped = 0;
let errors = 0;

for (const [src, dest] of MOVES) {
  const srcAbs = path.resolve(ROOT, src);
  const destAbs = path.resolve(ROOT, dest);

  if (!fs.existsSync(srcAbs)) {
    console.warn(`  SKIP  (not found) ${src}`);
    skipped++;
    continue;
  }

  const content = fs.readFileSync(srcAbs, 'utf8');
  const fixed = fixImports(content, srcAbs, destAbs);

  if (DRY) {
    console.log(`  DRY   ${src} → ${dest}`);
    moved++;
    continue;
  }

  try {
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.writeFileSync(destAbs, fixed, 'utf8');
    fs.unlinkSync(srcAbs);
    console.log(`  ✓     ${src} → ${dest}`);
    moved++;
  } catch (err) {
    console.error(`  ERROR ${src}: ${err.message}`);
    errors++;
  }
}

console.log(`\nDone: ${moved} moved, ${skipped} skipped, ${errors} errors.`);

if (!DRY && errors === 0) {
  // Update vitest.config.ts to add tests/ to coverage.exclude
  // (the runner already finds tests/ by default — no include change needed)
  const vitestPath = path.resolve(ROOT, 'vitest.config.ts');
  let vitestContent = fs.readFileSync(vitestPath, 'utf8');

  // Add tests/ to coverage exclude so test utility files don't skew coverage
  vitestContent = vitestContent.replace(
    `'**/test-utils*.ts',`,
    `'tests/**',\n        '**/test-utils*.ts',`
  );
  fs.writeFileSync(vitestPath, vitestContent, 'utf8');
  console.log('  ✓     vitest.config.ts coverage.exclude updated');

  // Update tsconfig.json to include tests/ for IDE type-checking
  const tsconfigPath = path.resolve(ROOT, 'tsconfig.json');
  let tsconfigContent = fs.readFileSync(tsconfigPath, 'utf8');
  tsconfigContent = tsconfigContent.replace(
    '"include": ["src", "shared"]',
    '"include": ["src", "shared", "tests"]'
  );
  // Remove tests from exclude (they were excluded via **/*.test.ts but tests/ is separate)
  fs.writeFileSync(tsconfigPath, tsconfigContent, 'utf8');
  console.log('  ✓     tsconfig.json include updated');
}
