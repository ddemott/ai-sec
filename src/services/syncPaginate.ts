/**
 * Shared paginated-sync loop for CRM full-sync passes.
 *
 * The 4 CRM sync modules (jobber, hubspot, square, servicetitan) each have
 * 1–2 pagination loops in their fullSync() entry points. The cursor mechanism
 * differs per provider (Jobber GraphQL pageInfo, HubSpot paging.next.after,
 * Square result.cursor, ServiceTitan page-number with hasMore), but the loop
 * shape is identical: fetch page → iterate items → catch per-item errors and
 * keep going → break on page-fetch error → terminate when no nextCursor.
 *
 * Historical major refactor (originally tracked as NEEDS-REFACTORING #10):
 * The pagination helper was extracted because the loop shape was identical
 * across providers, while the broader push/pull skeletons had too many
 * quirks to safely abstract (see RESOLVED.md for details).
 */

import type { SyncLogger } from './tokenManagement';

export interface PaginateSyncResult {
  count: number;
  errors: number;
}

export interface PaginateSyncArgs<TItem, TCursor> {
  /** Cursor passed to fetchPage on the first call. Provider-defined initial value. */
  initialCursor: TCursor;
  /**
   * Fetch one page. Return items + the cursor for the next page, or null to stop.
   * The caller's closure normalizes the provider's response shape (e.g., GraphQL
   * pageInfo, REST paging.next.after, page-number + hasMore).
   */
  fetchPage: (cursor: TCursor) => Promise<{ items: TItem[]; nextCursor: TCursor | null }>;
  /** Process one item. Throwing here counts as an item-level error and continues the loop. */
  processItem: (item: TItem) => Promise<void>;
  /** Format an item identifier for the per-item error log line (typically `item.id`). */
  itemContext: (item: TItem) => string;
  /** Log prefix — e.g. `[jobber-sync] tenant=XYZ`. The loop appends the message tail. */
  contextLabel: string;
  /** Entity type for log lines — `client`, `contact`, `customer`, `visit`, `booking`, `job`. */
  entityType: string;
  logger: SyncLogger;
}

/**
 * Drive a paginated sync loop. Returns the count of items processed successfully
 * and the count of item-level errors. A page-fetch error breaks the loop and
 * returns the partial result.
 */
export async function paginateSync<TItem, TCursor>(
  args: PaginateSyncArgs<TItem, TCursor>
): Promise<PaginateSyncResult> {
  const { initialCursor, fetchPage, processItem, itemContext, contextLabel, entityType, logger } =
    args;
  let count = 0;
  let errors = 0;
  let cursor: TCursor = initialCursor;

  while (true) {
    let page: { items: TItem[]; nextCursor: TCursor | null };
    try {
      page = await fetchPage(cursor);
    } catch (err) {
      logger.error(`${contextLabel} — ${entityType} pagination failed: ${String(err)}`);
      break;
    }

    for (const item of page.items) {
      try {
        await processItem(item);
        count++;
      } catch (err) {
        errors++;
        logger.error(
          `${contextLabel} — failed to pull ${entityType} ${itemContext(item)}: ${String(err)}`
        );
      }
    }

    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }

  return { count, errors };
}
