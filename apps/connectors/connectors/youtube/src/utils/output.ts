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
  console.error(chalk.red('Error'), message);
}

export function warn(message: string): void {
  console.warn(chalk.yellow('Warning'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('Info'), message);
}

export function heading(message: string): void {
  console.log(chalk.bold.cyan(`\n${message}\n`));
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  console.log(formatOutput(data, format));
}

export function formatDuration(isoDuration: string): string {
  // Parse ISO 8601 duration (e.g., PT1H2M3S)
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return isoDuration;

  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatCount(count: string | number): string {
  const num = typeof count === 'string' ? parseInt(count) : count;
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return String(num);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
