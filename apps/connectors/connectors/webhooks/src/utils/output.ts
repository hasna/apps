import chalk from 'chalk';

export type OutputFormat = 'json' | 'pretty';

export function formatOutput(data: unknown, format: OutputFormat = 'pretty'): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  return formatPretty(data);
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
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return `${spaces}${chalk.blue(key)}:\n${formatPrettyItem(value, indent + 1)}`;
      }
      return `${spaces}${chalk.blue(key)}: ${String(value)}`;
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

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  console.log(formatOutput(data, format));
}
