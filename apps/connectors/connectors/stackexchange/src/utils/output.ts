import chalk from 'chalk';
import type { OutputFormat } from '../types';

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else if (format === 'table' && Array.isArray(data)) {
    console.table(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

/** Format a Unix (seconds) timestamp as an ISO date (YYYY-MM-DD). */
export function fmtDate(unixSeconds?: number): string {
  if (!unixSeconds) return '';
  return new Date(unixSeconds * 1000).toISOString().split('T')[0];
}
