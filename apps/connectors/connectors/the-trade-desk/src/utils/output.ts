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
  const items = Array.isArray(data) ? data : [data];
  if (items.length === 0 || typeof items[0] !== 'object' || items[0] === null) {
    return 'No data';
  }

  const rows = items as Record<string, unknown>[];
  const keys = Object.keys(rows[0]!);
  const header = keys.join(' | ');
  const separator = keys.map(k => '-'.repeat(k.length)).join('-+-');
  const body = rows.map(row => keys.map(k => String(row[k] ?? '')).join(' | '));
  return [header, separator, ...body].join('\n');
}

function formatPretty(data: unknown): string {
  if (Array.isArray(data)) {
    return data.map((item, i) => `${chalk.cyan(`[${i + 1}]`)} ${formatPrettyItem(item)}`).join('\n\n');
  }
  return formatPrettyItem(data);
}

function formatPrettyItem(item: unknown, indent = 0): string {
  if (item === null || item === undefined) {
    return chalk.gray('null');
  }
  if (typeof item !== 'object') {
    return String(item);
  }

  const spaces = '  '.repeat(indent);
  return Object.entries(item as Record<string, unknown>)
    .map(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        return `${spaces}${chalk.blue(key)}:\n${formatPrettyItem(value, indent + 1)}`;
      }
      return `${spaces}${chalk.blue(key)}: ${chalk.white(String(value))}`;
    })
    .join('\n');
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

export function parseQueryPairs(pairs: string[] | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  if (!pairs) return params;
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) {
      params[pair] = '';
    } else {
      params[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
  }
  return params;
}

export function parseJsonBody(json?: string): Record<string, unknown> {
  if (!json) {
    return {};
  }
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('JSON body must be an object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`);
  }
}
