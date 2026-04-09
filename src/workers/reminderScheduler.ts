/**
 * Reminder Scheduler Worker
 *
 * Background worker that processes due reminders.
 * Runs on an interval (default: every minute) to check for
 * reminders that need to be sent.
 *
 * Usage:
 *   import { startReminderScheduler, stopReminderScheduler } from './workers/reminderScheduler';
 *   startReminderScheduler(); // Start processing
 *   stopReminderScheduler();  // Stop processing (for graceful shutdown)
 */

import { createDatabaseService, type DatabaseService } from '../database/index.js';
import { ReminderService } from '../services/reminders/index.js';
import { createTenantConfigService, type TenantConfigService } from '../services/tenants/index.js';

// ── Configuration ────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute
const MAX_BATCH_SIZE = 100;

// ── State ────────────────────────────────────────────────────────────

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;
let db: DatabaseService | null = null;
let configService: TenantConfigService | null = null;
let reminderService: ReminderService | null = null;

// ── Initialization ───────────────────────────────────────────────────

/**
 * Initialize services lazily.
 */
function initServices(): void {
  if (!db) {
    db = createDatabaseService();
  }
  if (!configService) {
    configService = createTenantConfigService();
  }
  if (!reminderService) {
    reminderService = new ReminderService(db, configService);
  }
}

// ── Processing ───────────────────────────────────────────────────────

/**
 * Process a single batch of due reminders.
 * Returns the number of reminders processed.
 */
async function processBatch(): Promise<number> {
  initServices();
  if (!db || !reminderService) return 0;

  try {
    // Get all due reminders (scheduled_for <= NOW, status = 'scheduled')
    const dueReminders = await db.getDueReminders();

    if (dueReminders.length === 0) {
      return 0;
    }

    console.log(`🔔 Processing ${dueReminders.length} due reminder(s)`);

    let processed = 0;
    for (const reminder of dueReminders.slice(0, MAX_BATCH_SIZE)) {
      try {
        await reminderService.processReminder(reminder.id.toString());
        processed++;
      } catch (error) {
        console.error(`❌ Failed to process reminder ${reminder.id}:`, error);
        // Mark as failed so we don't retry indefinitely
        try {
          await db.updateReminderSchedule(reminder.id.toString(), {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        } catch (updateError) {
          console.error(`❌ Failed to update reminder status:`, updateError);
        }
      }
    }

    console.log(`✅ Processed ${processed}/${dueReminders.length} reminder(s)`);
    return processed;
  } catch (error) {
    console.error('❌ Reminder batch processing error:', error);
    return 0;
  }
}

/**
 * Main scheduler tick - called on each interval.
 */
async function tick(): Promise<void> {
  if (isRunning) {
    // Skip if previous tick is still running
    return;
  }

  isRunning = true;
  try {
    await processBatch();
  } finally {
    isRunning = false;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Start the reminder scheduler.
 * @param intervalMs - Processing interval in milliseconds (default: 60000)
 */
export function startReminderScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (schedulerInterval) {
    console.warn('⚠️ Reminder scheduler is already running');
    return;
  }

  console.log(`🚀 Starting reminder scheduler (interval: ${intervalMs}ms)`);
  initServices();

  // Run immediately on start, then on interval
  tick().catch(console.error);
  schedulerInterval = setInterval(() => {
    tick().catch(console.error);
  }, intervalMs);
}

/**
 * Stop the reminder scheduler.
 */
export function stopReminderScheduler(): void {
  if (schedulerInterval) {
    console.log('🛑 Stopping reminder scheduler');
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  // Clean up reminder service timeouts
  if (reminderService) {
    reminderService.cleanup();
  }
}

/**
 * Check if the scheduler is running.
 */
export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

/**
 * Process reminders immediately (for testing or manual trigger).
 */
export async function processRemindersNow(): Promise<number> {
  return processBatch();
}

/**
 * Get scheduler status for monitoring.
 */
export function getSchedulerStatus(): {
  running: boolean;
  processing: boolean;
} {
  return {
    running: schedulerInterval !== null,
    processing: isRunning,
  };
}

// ── Graceful Shutdown ────────────────────────────────────────────────

// Handle process signals for graceful shutdown
if (typeof process !== 'undefined') {
  const handleShutdown = () => {
    stopReminderScheduler();
  };

  process.once('SIGTERM', handleShutdown);
  process.once('SIGINT', handleShutdown);
}
