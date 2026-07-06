import chalk from 'chalk';

export type OutputFormat = 'json' | 'table' | 'pretty';

let verboseMode = false;

export function setVerboseMode(enabled: boolean): void {
  verboseMode = enabled;
}

export function isVerboseMode(): boolean {
  return verboseMode;
}

export function debug(message: string, data?: unknown): void {
  if (!verboseMode) return;
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(chalk.gray(`[${timestamp}]`), chalk.dim(message));
  if (data !== undefined) {
    console.log(chalk.gray(typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data)));
  }
}

export function formatOutput(data: unknown, format: OutputFormat = 'pretty'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'table':
      return formatAsTable(data);
    case 'pretty':
    default:
      return formatPretty(data);
  }
}

function formatAsTable(data: unknown): string {
  if (!Array.isArray(data)) data = [data];
  const items = data as Record<string, unknown>[];
  if (items.length === 0) return 'No data';
  const firstItem = items[0];
  if (!firstItem || typeof firstItem !== 'object') return 'No data';
  const keys = Object.keys(firstItem);
  const header = keys.join(' | ');
  const rows = items.map((item) => keys.map((key) => String(item[key] ?? '')).join(' | '));
  return [header, ...rows].join('\n');
}

function formatPretty(data: unknown): string {
  if (Array.isArray(data)) {
    return data.map((item, i) => `${chalk.cyan(`[${i + 1}]`)} ${JSON.stringify(item, null, 2)}`).join('\n\n');
  }
  return JSON.stringify(data, null, 2);
}

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

export function warn(message: string): void {
  console.warn(chalk.yellow('⚠'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  console.log(formatOutput(data, format));
}
