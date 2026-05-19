type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  component?: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  (typeof process !== 'undefined' && (process.env?.NEXT_PUBLIC_LOG_LEVEL as LogLevel)) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function emit(entry: LogEntry) {
  const output = JSON.stringify(entry);
  switch (entry.level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    case 'debug':
      console.debug(output);
      break;
    default:
      console.log(output);
  }
}

function log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>) {
  if (!shouldLog(level)) return;
  emit({
    level,
    component,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
}

export function createLogger(component: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      log('debug', component, message, data),
    info: (message: string, data?: Record<string, unknown>) =>
      log('info', component, message, data),
    warn: (message: string, data?: Record<string, unknown>) =>
      log('warn', component, message, data),
    error: (message: string, data?: Record<string, unknown>) =>
      log('error', component, message, data),
  };
}
