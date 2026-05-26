import chalk from 'chalk';

export type OutputFormat = 'json' | 'pretty';

export function formatOutput(data: unknown, format: OutputFormat = 'pretty'): string {
  if (format === 'json') return JSON.stringify(data, null, 2);
  return formatPretty(data);
}

function formatPretty(data: unknown, indent = 0): string {
  if (data === null || data === undefined) return chalk.gray('null');
  if (typeof data !== 'object') return String(data);

  const spaces = '  '.repeat(indent);
  const entries = Object.entries(data as Record<string, unknown>);

  return entries
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length === 0) return `${spaces}${chalk.blue(key)}: ${chalk.gray('[]')}`;
        if (typeof value[0] === 'object') {
          return `${spaces}${chalk.blue(key)}:\n${value.map(v => formatPretty(v, indent + 1)).join('\n')}`;
        }
        return `${spaces}${chalk.blue(key)}: ${value.join(', ')}`;
      }
      if (typeof value === 'object' && value !== null) {
        return `${spaces}${chalk.blue(key)}:\n${formatPretty(value, indent + 1)}`;
      }
      return `${spaces}${chalk.blue(key)}: ${chalk.white(String(value))}`;
    })
    .join('\n');
}

export function success(message: string): void { console.log(chalk.green('✓'), message); }
export function error(message: string): void { console.error(chalk.red('✗'), message); }
export function warn(message: string): void { console.warn(chalk.yellow('⚠'), message); }
export function info(message: string): void { console.log(chalk.blue('ℹ'), message); }
export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  console.log(formatOutput(data, format));
}
