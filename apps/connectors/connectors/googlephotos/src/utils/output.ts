import chalk from 'chalk';

export type OutputFormat = 'json' | 'table' | 'pretty';

/**
 * Print success message
 */
export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

/**
 * Print error message
 */
export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

/**
 * Print info message
 */
export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

/**
 * Print warning message
 */
export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

/**
 * Print data in specified format
 */
export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  switch (format) {
    case 'json':
      console.log(JSON.stringify(data, null, 2));
      break;
    case 'table':
      printTable(data);
      break;
    case 'pretty':
    default:
      printPretty(data);
      break;
  }
}

/**
 * Print data as table
 */
function printTable(data: unknown): void {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log('No data');
      return;
    }

    // Get all unique keys from all objects
    const keys = Array.from(
      new Set(data.flatMap(item => (typeof item === 'object' && item ? Object.keys(item) : [])))
    );

    if (keys.length === 0) {
      console.log(data);
      return;
    }

    // Calculate column widths
    const widths: Record<string, number> = {};
    for (const key of keys) {
      widths[key] = Math.max(
        key.length,
        ...data.map(item => {
          const val = (item as Record<string, unknown>)?.[key];
          return String(val ?? '').substring(0, 50).length;
        })
      );
    }

    // Print header
    const header = keys.map(k => k.padEnd(widths[k])).join(' | ');
    console.log(chalk.bold(header));
    console.log(keys.map(k => '-'.repeat(widths[k])).join('-+-'));

    // Print rows
    for (const item of data) {
      const row = keys.map(k => {
        const val = (item as Record<string, unknown>)?.[k];
        return String(val ?? '').substring(0, 50).padEnd(widths[k]);
      }).join(' | ');
      console.log(row);
    }
  } else if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data);
    const maxKeyLen = Math.max(...entries.map(([k]) => k.length));

    for (const [key, value] of entries) {
      const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      console.log(`${chalk.cyan(key.padEnd(maxKeyLen))}: ${displayValue}`);
    }
  } else {
    console.log(data);
  }
}

/**
 * Print data in pretty format
 */
function printPretty(data: unknown): void {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log('No data');
      return;
    }

    for (let i = 0; i < data.length; i++) {
      if (i > 0) console.log('');
      printPrettyObject(data[i], i + 1);
    }
  } else if (typeof data === 'object' && data !== null) {
    printPrettyObject(data);
  } else {
    console.log(data);
  }
}

/**
 * Print a single object in pretty format
 */
function printPrettyObject(obj: unknown, index?: number): void {
  if (typeof obj !== 'object' || obj === null) {
    console.log(obj);
    return;
  }

  const entries = Object.entries(obj);

  if (index !== undefined) {
    console.log(chalk.gray(`[${index}]`));
  }

  for (const [key, value] of entries) {
    const displayKey = formatKey(key);
    const displayValue = formatValue(value);
    console.log(`  ${chalk.cyan(displayKey)}: ${displayValue}`);
  }
}

/**
 * Format a key for display
 */
function formatKey(key: string): string {
  // Convert camelCase to Title Case
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.gray('—');
  }

  if (typeof value === 'boolean') {
    return value ? chalk.green('Yes') : chalk.red('No');
  }

  if (typeof value === 'number') {
    return chalk.yellow(String(value));
  }

  if (typeof value === 'string') {
    // Check if it's a URL
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return chalk.blue(value);
    }
    // Check if it's a date
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return chalk.magenta(value);
    }
    // Truncate long strings
    if (value.length > 100) {
      return value.substring(0, 100) + chalk.gray('...');
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return chalk.gray('[]');
    }
    return chalk.gray(`[${value.length} items]`);
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return chalk.gray('{}');
    }
    return chalk.gray(`{${keys.join(', ')}}`);
  }

  return String(value);
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format duration in seconds to human readable
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
