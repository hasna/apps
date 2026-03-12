import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.connect-zendesk');
const LOG_FILE = join(CONFIG_DIR, 'connect-zendesk.log');

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function ensureLogDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = formatTimestamp();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
}

/**
 * Write a log entry to the log file
 */
function writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  try {
    ensureLogDir();
    const logEntry = formatMessage(level, message, meta);
    appendFileSync(LOG_FILE, logEntry, 'utf-8');
  } catch {
    // Silently fail if logging fails - don't crash the CLI
  }
}

/**
 * Logger utility for connect-zendesk
 */
export const logger = {
  /**
   * Log debug message
   */
  debug(message: string, meta?: Record<string, unknown>): void {
    writeLog('debug', message, meta);
  },

  /**
   * Log info message
   */
  info(message: string, meta?: Record<string, unknown>): void {
    writeLog('info', message, meta);
  },

  /**
   * Log warning message
   */
  warn(message: string, meta?: Record<string, unknown>): void {
    writeLog('warn', message, meta);
  },

  /**
   * Log error message
   */
  error(message: string, meta?: Record<string, unknown>): void {
    writeLog('error', message, meta);
  },

  /**
   * Log API request
   */
  request(method: string, path: string, statusCode?: number, duration?: number): void {
    writeLog('info', `${method} ${path}`, {
      statusCode,
      duration: duration ? `${duration}ms` : undefined,
    });
  },

  /**
   * Log CLI command execution
   */
  command(command: string, args?: Record<string, unknown>): void {
    writeLog('info', `Command: ${command}`, args);
  },

  /**
   * Log export operation
   */
  export(resource: string, format: string, filepath: string, count?: number): void {
    writeLog('info', `Export: ${resource}`, {
      format,
      filepath,
      count,
    });
  },

  /**
   * Get log file path
   */
  getLogPath(): string {
    return LOG_FILE;
  },
};
