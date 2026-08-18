/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

/**
 * Test-only sync recorder readout.
 *
 * Exposes the in-memory dispatch log captured by syncOrchestrator
 * when SYNC_TEST_RECORDER=1 is set. Used by Playwright e2e to assert
 * that fire-and-forget sync calls actually fired, without needing
 * real Google/Outlook/CRM credentials. Gated by both the env var AND
 * the existing x-agent-secret auth hook — refuses to respond outside
 * test mode so a stray prod request can't enumerate sync activity.
 */
import { getSyncRecorder, clearSyncRecorder } from '../../services/syncOrchestrator';
import { type AgentToolDeps } from './helpers';

export function registerTestRoutes({ app }: AgentToolDeps): void {
  app.get('/agent-tools/_test/sync-events', async (_req, reply) => {
    if (process.env.SYNC_TEST_RECORDER !== '1') {
      return reply.status(404).send({ success: false, error: 'Recorder disabled' });
    }
    return reply.send({ success: true, result: { events: getSyncRecorder() } });
  });
  app.delete('/agent-tools/_test/sync-events', async (_req, reply) => {
    if (process.env.SYNC_TEST_RECORDER !== '1') {
      return reply.status(404).send({ success: false, error: 'Recorder disabled' });
    }
    clearSyncRecorder();
    return reply.send({ success: true, result: { cleared: true } });
  });
}
