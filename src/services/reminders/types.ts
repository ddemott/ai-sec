/**
 * Reminder types — thin re-export barrel.
 *
 * The authoritative definitions live in `src/types/index.ts` (which is the
 * single source of truth used by DatabaseService and higher layers).
 *
 * This file exists only so that the reminders service layer can continue
 * to import from './types.js' without a large import-path refactor.
 *
 * See historical REFACTORING_TODO.md Item 2 (2026-05-27; details in RESOLVED.md).
 */
export type { ReminderSchedule, ReminderData } from '../../types/index.js';
