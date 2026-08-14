import chalk from 'chalk';

export type OutputFormat = 'json' | 'pretty';

export function formatOutput(data: unknown, format: OutputFormat = 'pretty'): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  return formatPretty(data);
}

function formatPretty(data: unknown, indent = 0): string {
  if (data === null || data === undefined) {
    return chalk.gray('null');
  }

  if (typeof data !== 'object') {
    return String(data);
  }

  if (Array.isArray(data)) {
    return data.map((item, i) => `${chalk.cyan(`[${i + 1}]`)} ${formatPretty(item, indent + 1)}`).join('\n\n');
  }

  const spaces = '  '.repeat(indent);
  return Object.entries(data as Record<string, unknown>)
    .map(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        return `${spaces}${chalk.blue(key)}:\n${formatPretty(value, indent + 1)}`;
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
