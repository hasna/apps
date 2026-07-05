import chalk from 'chalk';

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface OutputOptions {
  redactSecrets?: boolean;
}

const SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'api-key',
  'authorization',
  'password',
  'read_only_token',
  'refresh_token',
  'secret',
  'token',
]);

function shouldRedactKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase());
}

function redactSecretFields(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => redactSecretFields(item));
  }

  if (!data || typeof data !== 'object') {
    return data;
  }

  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>).map(([key, value]) => [
      key,
      shouldRedactKey(key) ? '[redacted]' : redactSecretFields(value),
    ]),
  );
}

export function formatOutput(data: unknown, format: OutputFormat = 'pretty', options: OutputOptions = {}): string {
  const printable = options.redactSecrets === false ? data : redactSecretFields(data);

  switch (format) {
    case 'json':
      return JSON.stringify(printable, null, 2);
    case 'table':
      return formatAsTable(printable);
    case 'pretty':
    default:
      return formatPretty(printable);
  }
}

function formatAsTable(data: unknown): string {
  if (!Array.isArray(data)) {
    data = [data];
  }

  const items = data as Record<string, unknown>[];
  if (items.length === 0) {
    return 'No data';
  }

  const firstItem = items[0];
  if (!firstItem || typeof firstItem !== 'object') {
    return 'No data';
  }

  const keys = Object.keys(firstItem);
  const colWidths = keys.map((key) => {
    const maxValue = Math.max(key.length, ...items.map((item) => String(item[key] ?? '').length));
    return Math.min(maxValue, 40);
  });

  const header = keys.map((key, i) => key.padEnd(colWidths[i] ?? 10)).join(' | ');
  const separator = colWidths.map((w) => '-'.repeat(w)).join('-+-');
  const rows = items.map((item) =>
    keys
      .map((key, i) => {
        const value = String(item[key] ?? '');
        const width = colWidths[i] ?? 10;
        return value.length > width ? `${value.substring(0, width - 3)}...` : value.padEnd(width);
      })
      .join(' | '),
  );

  return [header, separator, ...rows].join('\n');
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
  const entries = Object.entries(item as Record<string, unknown>);

  return entries
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return `${spaces}${chalk.blue(key)}: ${chalk.gray('[]')}`;
        }
        if (typeof value[0] === 'object') {
          return `${spaces}${chalk.blue(key)}:\n${value.map((v) => formatPrettyItem(v, indent + 1)).join('\n')}`;
        }
        return `${spaces}${chalk.blue(key)}: ${value.join(', ')}`;
      }

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

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function print(data: unknown, format: OutputFormat = 'pretty', options?: OutputOptions): void {
  console.log(formatOutput(data, format, options));
}
