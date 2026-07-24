import chalk from 'chalk';
import type { OutputFormat } from '../types';

export type { OutputFormat };

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
  if (items.length === 0) {
    return 'No data';
  }

  const firstItem = items[0];
  if (!firstItem || typeof firstItem !== 'object') {
    return JSON.stringify(data, null, 2);
  }

  const keys = Object.keys(firstItem as Record<string, unknown>);
  const colWidths = keys.map((key) => {
    const maxValue = Math.max(
      key.length,
      ...items.map((item) => String((item as Record<string, unknown>)[key] ?? '').length),
    );
    return Math.min(maxValue, 40);
  });

  const header = keys.map((key, index) => key.padEnd(colWidths[index] ?? 10)).join(' | ');
  const separator = colWidths.map((width) => '-'.repeat(width)).join('-+-');
  const rows = items.map((item) =>
    keys
      .map((key, index) => {
        const value = String((item as Record<string, unknown>)[key] ?? '');
        const width = colWidths[index] ?? 10;
        return value.length > width ? `${value.substring(0, width - 3)}...` : value.padEnd(width);
      })
      .join(' | '),
  );

  return [header, separator, ...rows].join('\n');
}

function formatPretty(data: unknown): string {
  if (Array.isArray(data)) {
    return data.map((item, index) => `${chalk.cyan(`[${index + 1}]`)} ${formatPrettyItem(item)}`).join('\n\n');
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
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return `${spaces}${chalk.blue(key)}: ${chalk.gray('[]')}`;
        }
        if (typeof value[0] === 'object') {
          return `${spaces}${chalk.blue(key)}:\n${value.map((entry) => formatPrettyItem(entry, indent + 1)).join('\n')}`;
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
