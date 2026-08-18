/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

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
 *   stopReminderScheduler();  // Stop processing (for graceful shutdown) — now async
 */

import type { Pool } from 'pg';
import { createDatabaseService, type DatabaseService, getPool } from '../database/index.js';
import { ReminderService } from '../services/reminders/index.js';
import { decideRetry, MAX_RETRIES } from '../services/reminders/retryPolicy.js';
import { errorsTotal } from '../services/metrics.js';
import { createTenantConfigService, type TenantConfigService } from '../services/tenants/index.js';

// ── Configuration ────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute
const MAX_BATCH_SIZE = 100;

// ── State ────────────────────────────────────────────────────────────

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;
let isShuttingDown = false;
let _currentTick: Promise<void> | null = null;
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

  const pool = getPool();

  try {
    // ATOMIC CLAIM prevents double-SMS race: UPDATE + FOR UPDATE SKIP LOCKED
    // RETURNING guarantees only one worker claims a reminder. Sets 'sending'
    // so concurrent ticks see it as in-flight. High impact on every deploy.
    const claimRes = await pool.query(
      `
      UPDATE reminder_schedules
         SET status = 'sending',
             updated_at = NOW()
       WHERE reminder_schedule_id IN (
         SELECT reminder_schedule_id
           FROM reminder_schedules
          WHERE status = 'scheduled'
            AND scheduled_for <= NOW()
          ORDER BY scheduled_for ASC, reminder_schedule_id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       RETURNING *
    `,
      [MAX_BATCH_SIZE]
    );

    const dueReminders = claimRes.rows;

    if (dueReminders.length === 0) {
      return 0;
    }

    console.log(`🔔 Processing ${dueReminders.length} due reminder(s)`);

    let processed = 0;
    for (const reminder of dueReminders) {
      try {
        await reminderService.processReminder(reminder.reminder_schedule_id.toString());
        processed++;
      } catch (error) {
        console.error(`❌ Failed to process reminder ${reminder.reminder_schedule_id}:`, error);
        const currentRetryCount = reminder.retry_count ?? 0;
        const decision = decideRetry(error, currentRetryCount);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        try {
          if (decision.action === 'retry') {
            await db.updateReminderSchedule(reminder.reminder_schedule_id.toString(), {
              status: 'scheduled',
              error: errorMessage,
              retry_count: decision.nextRetryCount,
              next_retry_at: decision.nextRetryAt.toISOString(),
            });
            console.log(
              `🔁 Retry ${decision.nextRetryCount}/${MAX_RETRIES} scheduled for reminder ${reminder.reminder_schedule_id} at ${decision.nextRetryAt.toISOString()}`
            );
          } else {
            await db.updateReminderSchedule(reminder.reminder_schedule_id.toString(), {
              status: 'failed',
              error: `${errorMessage} (reason: ${decision.reason})`,
            });
          }
        } catch (updateError) {
          console.error(`❌ Failed to update reminder status:`, updateError);
        }
      }
    }

    console.log(`✅ Processed ${processed}/${dueReminders.length} reminder(s)`);
    return processed;
  } catch (error) {
    errorsTotal.inc({ event: 'reminder_batch_failed' });
    console.error('❌ Reminder batch processing error:', error);
    return 0;
  }
}

/**
 * Delete demo tenants whose demo_expires_at has passed.
 * Uses the raw pool with no RLS tenant context — this is an admin sweep.
 * CASCADE on tenants covers all child rows automatically.
 * Exported for direct testing; the scheduler tick also calls it on every cycle.
 *
 * The optional `poolOverride` parameter lets tests pass the test-DB pool
 * instead of the production pool (which reads DATABASE_URL from env).
 */
export async function cleanupExpiredDemoTenants(poolOverride?: Pool): Promise<void> {
  try {
    const pool = poolOverride ?? getPool();
    // SOFT delete (2026-07-13). This runs EVERY 60 SECONDS in production, and a
    // cascading DELETE here races the fire-and-forget reminder seeding of any live
    // booking: the cascade takes FK locks appointments → tenants, the seeding INSERT
    // takes them tenants → appointments, and Postgres kills one side at random. That
    // is a real production deadlock on a 60-second timer. An UPDATE takes no cascade
    // locks.
    //
    // The rows still exist; a maintenance-window purge can reclaim them whenever we
    // want. Nothing reads them: createWithTenantClient treats a soft-deleted tenant
    // as 404, so an expired demo cannot answer a call, book, or bill.
    const res = await pool.query(
      `UPDATE tenants
          SET is_deleted = true, deleted_at = now()
        WHERE is_demo = true AND demo_expires_at < NOW() AND is_deleted = false
       RETURNING tenant_id`
    );
    if ((res.rowCount ?? 0) > 0) {
      console.log(`🧹 Soft-deleted ${res.rowCount} expired demo tenant(s)`);
    }
  } catch (err) {
    console.error('❌ Demo tenant cleanup error:', err);
  }
}

/**
 * Main scheduler tick - called on each interval.
 */
function tick(): Promise<void> {
  if (isShuttingDown || isRunning) {
    return Promise.resolve();
  }

  isRunning = true;
  _currentTick = (async () => {
    try {
      await processBatch();
      await cleanupExpiredDemoTenants();
    } catch (error) {
      console.error('Tick error:', error);
    } finally {
      isRunning = false;
      _currentTick = null;
    }
  })();
  return _currentTick;
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
 * Stop the reminder scheduler. Drains current tick with timeout to prevent
 * in-flight reminders from being abandoned mid-process.
 */
export async function stopReminderScheduler(timeoutMs = 10000): Promise<void> {
  isShuttingDown = true;
  if (schedulerInterval) {
    console.log('🛑 Stopping reminder scheduler');
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  if (_currentTick) {
    console.log('Draining current reminder tick (SIGTERM drain)...');
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('drain timeout')), timeoutMs)
    );
    try {
      await Promise.race([_currentTick, timeout]);
      console.log('Drain complete');
    } catch {
      console.warn('Reminder worker drain timed out');
    }
  }

  if (reminderService) {
    reminderService.cleanup();
  }
  isShuttingDown = false;
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
  const handleShutdown = async () => {
    await stopReminderScheduler().catch(console.error);
  };

  process.once('SIGTERM', handleShutdown);
  process.once('SIGINT', handleShutdown);
}
