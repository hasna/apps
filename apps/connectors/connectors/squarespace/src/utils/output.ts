import chalk from 'chalk';

export type OutputFormat = 'json' | 'table' | 'pretty';

const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|bearer|credential|password|private[-_]?key|secret|token)/i;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactValue(child),
      ]),
    );
  }

  return value;
}

export function formatOutput(data: unknown, format: OutputFormat = 'pretty'): string {
  const safeData = redactValue(data);
  switch (format) {
    case 'json':
      return JSON.stringify(safeData, null, 2);
    case 'table':
      return formatAsTable(safeData);
    case 'pretty':
    default:
      return formatPretty(safeData);
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
  const colWidths = keys.map(key => {
    const maxValue = Math.max(
      key.length,
      ...items.map(item => String(item[key] ?? '').length)
    );
    return Math.min(maxValue, 40);
  });

  const header = keys.map((key, i) => key.padEnd(colWidths[i] ?? 10)).join(' | ');
  const separator = colWidths.map(w => '-'.repeat(w)).join('-+-');

  const rows = items.map(item =>
    keys.map((key, i) => {
      const value = String(item[key] ?? '');
      const width = colWidths[i] ?? 10;
      return value.length > width
        ? value.substring(0, width - 3) + '...'
        : value.padEnd(width);
    }).join(' | ')
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
          return `${spaces}${chalk.blue(key)}:\n${value.map(v => formatPrettyItem(v, indent + 1)).join('\n')}`;
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
  console.log(chalk.green('OK'), message);
}

export function error(message: string): void {
  console.error(chalk.red('ERROR'), message);
}

export function warn(message: string): void {
  console.warn(chalk.yellow('WARN'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('INFO'), message);
}

export function heading(message: string): void {
  console.log(chalk.bold.cyan(`\n${message}\n`));
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  console.log(formatOutput(data, format));
}
