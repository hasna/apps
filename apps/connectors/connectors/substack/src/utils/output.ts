import chalk from 'chalk';

export type OutputFormat = 'json' | 'yaml' | 'pretty';

export function formatOutput(data: unknown, format: OutputFormat = 'pretty'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'yaml':
      return formatAsYaml(data);
    case 'pretty':
    default:
      return formatPretty(data);
  }
}

function formatAsYaml(data: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (data === null || data === undefined) {
    return 'null';
  }

  if (typeof data === 'boolean' || typeof data === 'number') {
    return String(data);
  }

  if (typeof data === 'string') {
    // Check if string needs quoting
    if (data.includes('\n') || data.includes(':') || data.includes('#')) {
      return `"${data.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return data;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return '[]';
    }

    return data
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          const formatted = formatAsYaml(item, indent + 1);
          const lines = formatted.split('\n');
          return `${spaces}- ${lines[0]}\n${lines.slice(1).map(l => `${spaces}  ${l}`).join('\n')}`.trimEnd();
        }
        return `${spaces}- ${formatAsYaml(item, indent + 1)}`;
      })
      .join('\n');
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) {
      return '{}';
    }

    return entries
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          const formatted = formatAsYaml(value, indent + 1);
          if (Array.isArray(value) && value.length > 0) {
            return `${spaces}${key}:\n${formatted}`;
          }
          if (formatted.includes('\n')) {
            return `${spaces}${key}:\n${formatted.split('\n').map(l => `${spaces}  ${l}`).join('\n')}`;
          }
          return `${spaces}${key}: ${formatted}`;
        }
        return `${spaces}${key}: ${formatAsYaml(value, indent)}`;
      })
      .join('\n');
  }

  return String(data);
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
    .filter(([, value]) => value !== undefined)
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
