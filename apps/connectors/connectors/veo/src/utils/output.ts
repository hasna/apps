import chalk from 'chalk';

export type OutputFormat = 'json' | 'table' | 'pretty';

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
  if (items.length === 0) return 'No data';

  const firstItem = items[0];
  if (!firstItem || typeof firstItem !== 'object') return 'No data';

  const keys = Object.keys(firstItem as Record<string, unknown>);
  const colWidths = keys.map((key) => {
    const maxValue = Math.max(key.length, ...items.map((item) => String((item as Record<string, unknown>)[key] ?? '').length));
    return Math.min(maxValue, 40);
  });

  const header = keys.map((key, i) => key.padEnd(colWidths[i] ?? 10)).join(' | ');
  const separator = colWidths.map((w) => '-'.repeat(w)).join('-+-');
  const rows = items.map((item) =>
    keys
      .map((key, i) => {
        const value = String((item as Record<string, unknown>)[key] ?? '');
        const width = colWidths[i] ?? 10;
        return value.length > width ? `${value.substring(0, width - 3)}...` : value.padEnd(width);
      })
      .join(' | ')
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
  if (item === null || item === undefined) return chalk.gray('null');
  if (typeof item !== 'object') return String(item);

  const spaces = '  '.repeat(indent);
  return Object.entries(item as Record<string, unknown>)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length === 0) return `${spaces}${chalk.blue(key)}: ${chalk.gray('[]')}`;
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

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  console.log(formatOutput(data, format));
}

export function parseQueryJson(input?: string): Record<string, string | number | boolean | undefined> {
  if (!input) return {};
  const parsed = JSON.parse(input) as Record<string, unknown>;
  const result: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    } else {
      result[key] = JSON.stringify(value);
    }
  }
  return result;
}

export function parseBodyJson(input?: string): Record<string, unknown> | undefined {
  if (!input) return undefined;
  return JSON.parse(input) as Record<string, unknown>;
}
