import pino from "pino";

export const baseLogger = pino({
  level: 'info',
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export interface LogContext {
  requestId?: string;
  tenantId?: string;
  callId?: string;
  tool?: string;
  event?: string;
}

export function createLogger(context: LogContext) {
  return baseLogger.child(context);
}

export type Logger = pino.Logger;
