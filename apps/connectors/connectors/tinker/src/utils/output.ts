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

  if (typeof data === 'boolean') {
    return data ? 'true' : 'false';
  }

  if (typeof data === 'number') {
    return String(data);
  }

  if (typeof data === 'string') {
    // Handle multi-line strings
    if (data.includes('\n')) {
      return '|\n' + data.split('\n').map(line => spaces + '  ' + line).join('\n');
    }
    // Quote strings that might be parsed as other types
    if (/^[0-9]/.test(data) || /^(true|false|null|yes|no)$/i.test(data) || data.includes(':') || data.includes('#')) {
      return `"${data.replace(/"/g, '\\"')}"`;
    }
    return data;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return '[]';
    }
    return data.map(item => {
      const formatted = formatAsYaml(item, indent + 1);
      if (typeof item === 'object' && item !== null) {
        return `${spaces}- ${formatted.trim().replace(/^\s+/gm, (m, offset) => offset === 0 ? '' : m)}`;
      }
      return `${spaces}- ${formatted}`;
    }).join('\n');
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) {
      return '{}';
    }
    return entries.map(([key, value]) => {
      const formatted = formatAsYaml(value, indent + 1);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return `${spaces}${key}:\n${formatted}`;
      }
      if (Array.isArray(value) && value.length > 0) {
        return `${spaces}${key}:\n${formatted}`;
      }
      return `${spaces}${key}: ${formatted}`;
    }).join('\n');
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

export function heading(message: string): void {
  console.log(chalk.bold.cyan(`\n${message}\n`));
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  console.log(formatOutput(data, format));
}
