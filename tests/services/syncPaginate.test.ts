/**
 * Tests for paginateSync — shared paginated-sync loop driver for CRM full-syncs.
 * Happy + sad paths with 5W diagnostic context.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { paginateSync } from '../../src/services/syncPaginate';
import type { SyncLogger } from '../../src/services/tokenManagement';

interface FakeItem {
  id: string;
}

function makeLogger(): SyncLogger & {
  errorCalls: string[];
  warnCalls: string[];
  infoCalls: string[];
} {
  const errorCalls: string[] = [];
  const warnCalls: string[] = [];
  const infoCalls: string[] = [];
  return {
    error: (msg: string) => {
      errorCalls.push(msg);
    },
    warn: (msg: string) => {
      warnCalls.push(msg);
    },
    info: (msg: string) => {
      infoCalls.push(msg);
    },
    errorCalls,
    warnCalls,
    infoCalls,
  };
}

describe('paginateSync', () => {
  let logger: ReturnType<typeof makeLogger>;
  let processItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = makeLogger();
    processItem = vi.fn().mockResolvedValue(undefined);
  });

  describe('Happy paths', () => {
    it('HAPPY: walks one page and returns count', async () => {
      // WHO: CRM full-sync running with a small remote dataset
      // WHAT: Helper iterates every item from the single page and stops cleanly
      // WHEN: fetchPage returns nextCursor=null on the first call
      // WHERE: paginateSync top-level while loop
      // WHY: Most tenants have <100 contacts; one page is the common case
      const fetchPage = vi.fn().mockResolvedValueOnce({
        items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as FakeItem[],
        nextCursor: null,
      });

      const result = await paginateSync<FakeItem, string>({
        initialCursor: 'start',
        fetchPage,
        processItem,
        itemContext: (i) => i.id,
        contextLabel: '[test-sync] tenant=t1',
        entityType: 'thing',
        logger,
      });

      expect(result).toEqual({ count: 3, errors: 0 });
      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(fetchPage).toHaveBeenCalledWith('start');
      expect(processItem).toHaveBeenCalledTimes(3);
      expect(logger.errorCalls).toEqual([]);
    });

    it('HAPPY: chains cursors across multiple pages until nextCursor=null', async () => {
      // WHO: CRM full-sync against a tenant with hundreds of records
      // WHAT: Helper threads each page's nextCursor into the next fetchPage call
      // WHEN: fetchPage returns a non-null nextCursor for early pages and null on the last
      // WHERE: Loop condition `while (cursor !== null)`
      // WHY: Multi-page case is what the helper actually saves over inline cursor management
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ items: [{ id: '1' }] as FakeItem[], nextCursor: 'cursor2' })
        .mockResolvedValueOnce({
          items: [{ id: '2' }, { id: '3' }] as FakeItem[],
          nextCursor: 'cursor3',
        })
        .mockResolvedValueOnce({ items: [{ id: '4' }] as FakeItem[], nextCursor: null });

      const result = await paginateSync<FakeItem, string>({
        initialCursor: 'cursor1',
        fetchPage,
        processItem,
        itemContext: (i) => i.id,
        contextLabel: '[test-sync] tenant=t1',
        entityType: 'thing',
        logger,
      });

      expect(result).toEqual({ count: 4, errors: 0 });
      expect(fetchPage.mock.calls.map((c) => c[0])).toEqual(['cursor1', 'cursor2', 'cursor3']);
    });

    it('HAPPY: returns zero-zero on empty first page', async () => {
      // WHO: A freshly connected CRM with no records yet
      // WHAT: Helper terminates immediately when the only page is empty + nextCursor=null
      // WHY: A zero-record full-sync should not error, should not loop, should report 0/0
      const fetchPage = vi.fn().mockResolvedValueOnce({ items: [], nextCursor: null });

      const result = await paginateSync<FakeItem, string>({
        initialCursor: 'start',
        fetchPage,
        processItem,
        itemContext: (i) => i.id,
        contextLabel: '[test-sync] tenant=t1',
        entityType: 'thing',
        logger,
      });

      expect(result).toEqual({ count: 0, errors: 0 });
      expect(processItem).not.toHaveBeenCalled();
      expect(logger.errorCalls).toEqual([]);
    });

    it('HAPPY: initialCursor=null is valid (Jobber GraphQL accepts after: null on first page)', async () => {
      // WHO: Jobber sync, which passes `after: null` on its first GraphQL pagination call
      // WHAT: Helper must not confuse a null *initial* cursor with a null *terminate* signal
      // WHEN: First fetchPage call receives cursor=null and returns nextCursor=null (one-page result)
      // WHERE: Loop condition — must run at least one iteration regardless of initialCursor value
      // WHY: A previous version used `while (cursor !== null)` which silently skipped the only
      //      page when initialCursor was null — caught by jobber-sync.test.ts FULL-SYNC-WITH-DATA
      const fetchPage = vi.fn().mockResolvedValueOnce({
        items: [{ id: 'only' }] as FakeItem[],
        nextCursor: null,
      });

      const result = await paginateSync<FakeItem, string | null>({
        initialCursor: null,
        fetchPage,
        processItem,
        itemContext: (i) => i.id,
        contextLabel: '[jobber-sync] tenant=t1',
        entityType: 'client',
        logger,
      });

      expect(result).toEqual({ count: 1, errors: 0 });
      expect(fetchPage).toHaveBeenCalledTimes(1);
      expect(fetchPage).toHaveBeenCalledWith(null);
    });

    it('HAPPY: supports non-string cursor types (e.g. ServiceTitan page numbers)', async () => {
      // WHO: ServiceTitan sync, which uses 1-indexed page numbers instead of opaque cursors
      // WHAT: TCursor generic accepts a number type; helper threads it through unchanged
      // WHY: ServiceTitan listCustomers/listJobs takes page:number, returns hasMore:boolean
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ items: [{ id: 'p1' }] as FakeItem[], nextCursor: 2 })
        .mockResolvedValueOnce({ items: [{ id: 'p2' }] as FakeItem[], nextCursor: null });

      const result = await paginateSync<FakeItem, number>({
        initialCursor: 1,
        fetchPage,
        processItem,
        itemContext: (i) => i.id,
        contextLabel: '[servicetitan-sync] tenant=t1',
        entityType: 'customer',
        logger,
      });

      expect(result).toEqual({ count: 2, errors: 0 });
      expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    });
  });

  describe('Sad paths', () => {
    it('SAD: counts an item-level error and continues to next item', async () => {
      // WHO: CRM full-sync where one record on a page has malformed remote data
      // WHAT: processItem rejects for that record; loop logs + counts the error and proceeds
      // WHEN: One out of three items in a page throws inside processItem
      // WHERE: Inner try/catch around `await processItem(item)`
      // WHY: A single bad row must never abort a tenant's whole sync — losing data sync
      //      because of one upstream typo would be a worse failure mode than a logged error
      processItem
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('bad data'))
        .mockResolvedValueOnce(undefined);

      const fetchPage = vi.fn().mockResolvedValueOnce({
        items: [{ id: 'ok-1' }, { id: 'broken' }, { id: 'ok-2' }] as FakeItem[],
        nextCursor: null,
      });

      const result = await paginateSync<FakeItem, string>({
        initialCursor: 'start',
        fetchPage,
        processItem,
        itemContext: (i) => i.id,
        contextLabel: '[test-sync] tenant=t1',
        entityType: 'thing',
        logger,
      });

      expect(result).toEqual({ count: 2, errors: 1 });
      expect(processItem).toHaveBeenCalledTimes(3);
      expect(logger.errorCalls).toHaveLength(1);
      expect(logger.errorCalls[0]).toContain('failed to pull thing broken');
      expect(logger.errorCalls[0]).toContain('bad data');
    });

    it('SAD: page-fetch error logs and breaks loop with partial result', async () => {
      // WHO: CRM API returning 5xx mid-sync (token still valid, transient outage)
      // WHAT: fetchPage throws; helper logs page-failure and exits, returning partial counts
      // WHEN: Second page fetch fails after first page processed cleanly
      // WHERE: Outer try/catch around `await fetchPage(cursor)`
      // WHY: Distinguishing page failures from item failures is the contract — page failure
      //      means the cursor chain is broken and we can't reliably continue, so partial
      //      result + log is preferable to silently skipping pages or hard-throwing
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({
          items: [{ id: '1' }, { id: '2' }] as FakeItem[],
          nextCursor: 'next',
        })
        .mockRejectedValueOnce(new Error('upstream 503'));

      const result = await paginateSync<FakeItem, string>({
        initialCursor: 'start',
        fetchPage,
        processItem,
        itemContext: (i) => i.id,
        contextLabel: '[test-sync] tenant=t1',
        entityType: 'widget',
        logger,
      });

      expect(result).toEqual({ count: 2, errors: 0 });
      expect(fetchPage).toHaveBeenCalledTimes(2);
      expect(processItem).toHaveBeenCalledTimes(2);
      expect(logger.errorCalls).toHaveLength(1);
      expect(logger.errorCalls[0]).toContain('widget pagination failed');
      expect(logger.errorCalls[0]).toContain('upstream 503');
    });

    it('SAD: page-fetch error on the very first page returns zero-zero', async () => {
      // WHO: CRM with revoked credentials or hard upstream outage at the start of a sync
      // WHAT: First fetchPage throws → helper logs and returns 0/0 immediately
      // WHY: The orchestrator's fullSync sees `{count: 0, errors: 0}` and reports the page
      //      failure separately via the log line — counts reflect items, not infrastructure
      const fetchPage = vi.fn().mockRejectedValueOnce(new Error('401 unauthorized'));

      const result = await paginateSync<FakeItem, string>({
        initialCursor: 'start',
        fetchPage,
        processItem,
        itemContext: (i) => i.id,
        contextLabel: '[test-sync] tenant=t1',
        entityType: 'thing',
        logger,
      });

      expect(result).toEqual({ count: 0, errors: 0 });
      expect(processItem).not.toHaveBeenCalled();
      expect(logger.errorCalls).toHaveLength(1);
      expect(logger.errorCalls[0]).toContain('thing pagination failed');
    });

    it('SAD: log line uses contextLabel + entityType + itemContext exactly', async () => {
      // WHO: Future maintainer running grep against logs for a specific tenant + provider
      // WHAT: Item-error log preserves the legacy format `${contextLabel} — failed to pull
      //       ${entityType} ${itemContext}: ${err}` so existing log queries still match
      // WHY: The 4 sync modules already have log lines in this exact shape; switching the
      //      helper would silently break support runbooks that grep for these patterns
      processItem.mockRejectedValueOnce(new Error('boom'));

      const fetchPage = vi.fn().mockResolvedValueOnce({
        items: [{ id: 'x' }] as FakeItem[],
        nextCursor: null,
      });

      await paginateSync<FakeItem, string>({
        initialCursor: 'start',
        fetchPage,
        processItem,
        itemContext: (i) => i.id,
        contextLabel: '[jobber-sync] tenant=abc',
        entityType: 'client',
        logger,
      });

      expect(logger.errorCalls[0]).toBe(
        '[jobber-sync] tenant=abc — failed to pull client x: Error: boom'
      );
    });
  });
});
