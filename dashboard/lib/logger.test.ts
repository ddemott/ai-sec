/**
 * logger — unit coverage for createLogger().
 *
 * WHO: Any dashboard component emitting structured logs.
 * WHAT: createLogger(component) returns debug/info/warn/error functions.
 * WHERE: lib/logger.ts — previously 0% coverage.
 * WHY: Zero coverage means a broken level-filter or wrong console method
 *   would go undetected until prod log noise is noticed.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Spy on console methods before importing the module so the module captures
// the spied versions. vi.hoisted() runs first, before any module imports.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_LOG_LEVEL = 'debug'; // enable all levels for tests
});

import { createLogger } from './logger';

const consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createLogger() — output routing', () => {
  const logger = createLogger('TestComponent');

  test('HAPPY: info calls console.log with JSON', () => {
    // WHO: component logging an informational event
    // WHY: info level → console.log, not warn/error
    logger.info('user loaded');
    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    const output = consoleSpy.log.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('info');
    expect(parsed.component).toBe('TestComponent');
    expect(parsed.message).toBe('user loaded');
    expect(parsed.timestamp).toBeTruthy();
  });

  test('HAPPY: warn calls console.warn', () => {
    logger.warn('slow fetch');
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.warn.mock.calls[0][0] as string);
    expect(parsed.level).toBe('warn');
  });

  test('HAPPY: error calls console.error', () => {
    logger.error('fetch failed');
    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.error.mock.calls[0][0] as string);
    expect(parsed.level).toBe('error');
  });

  test('HAPPY: debug calls console.debug', () => {
    logger.debug('rendering');
    expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.debug.mock.calls[0][0] as string);
    expect(parsed.level).toBe('debug');
  });
});

describe('createLogger() — data field', () => {
  test('HAPPY: passes optional data object through to the log entry', () => {
    const logger = createLogger('API');
    logger.info('response received', { status: 200, tenant: 'abc' });
    const parsed = JSON.parse(consoleSpy.log.mock.calls[0][0] as string);
    expect(parsed.data).toEqual({ status: 200, tenant: 'abc' });
  });

  test('HAPPY: data is absent from the log entry when not provided', () => {
    const logger = createLogger('API');
    logger.info('started');
    const parsed = JSON.parse(consoleSpy.log.mock.calls[0][0] as string);
    expect(parsed.data).toBeUndefined();
  });
});

describe('createLogger() — component name', () => {
  test('HAPPY: component name is embedded in every log entry', () => {
    const logger = createLogger('ScheduleView');
    logger.warn('shift overlap');
    const parsed = JSON.parse(consoleSpy.warn.mock.calls[0][0] as string);
    expect(parsed.component).toBe('ScheduleView');
  });
});
