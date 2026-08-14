import chalk from 'chalk';

export type OutputFormat = 'json' | 'pretty';

export function formatOutput(data: unknown, format: OutputFormat = 'pretty'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'pretty':
    default:
      return formatPretty(data);
  }
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
  console.error(chalk.red('ERR'), message);
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
