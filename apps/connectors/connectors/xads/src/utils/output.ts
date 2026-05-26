import chalk from 'chalk';

export type OutputFormat = 'json' | 'pretty';

let outputFormat: OutputFormat = 'pretty';

export function setOutputFormat(format: OutputFormat): void {
  outputFormat = format;
}

export function getOutputFormat(): OutputFormat {
  return outputFormat;
}

export function output(data: unknown, options?: { title?: string }): void {
  if (outputFormat === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    if (options?.title) {
      console.log(chalk.bold.blue(`\n${options.title}`));
      console.log(chalk.gray('─'.repeat(50)));
    }
    prettyPrint(data);
  }
}

export function prettyPrint(data: unknown, indent = 0): void {
  const prefix = '  '.repeat(indent);

  if (data === null || data === undefined) {
    console.log(`${prefix}${chalk.gray('null')}`);
    return;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(`${prefix}${chalk.gray('[]')}`);
      return;
    }
    data.forEach((item, index) => {
      if (typeof item === 'object' && item !== null) {
        console.log(`${prefix}${chalk.yellow(`[${index}]`)}`);
        prettyPrint(item, indent + 1);
      } else {
        console.log(`${prefix}${chalk.yellow(`[${index}]`)} ${formatValue(item)}`);
      }
    });
    return;
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) {
      console.log(`${prefix}${chalk.gray('{}')}`);
      return;
    }
    for (const [key, value] of entries) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        console.log(`${prefix}${chalk.cyan(key)}:`);
        prettyPrint(value, indent + 1);
      } else if (Array.isArray(value)) {
        console.log(`${prefix}${chalk.cyan(key)}: ${chalk.gray(`[${value.length} items]`)}`);
        if (value.length > 0 && value.length <= 5) {
          prettyPrint(value, indent + 1);
        }
      } else {
        console.log(`${prefix}${chalk.cyan(key)}: ${formatValue(value)}`);
      }
    }
    return;
  }

  console.log(`${prefix}${formatValue(data)}`);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.gray('null');
  }
  if (typeof value === 'boolean') {
    return value ? chalk.green('true') : chalk.red('false');
  }
  if (typeof value === 'number') {
    return chalk.yellow(value.toString());
  }
  if (typeof value === 'string') {
    // Check if it's a date string
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return chalk.magenta(value);
    }
    // Check if it's a status
    if (['ACTIVE', 'ACCEPTED', 'ENABLED'].includes(value)) {
      return chalk.green(value);
    }
    if (['PAUSED', 'PENDING', 'DRAFT', 'UNDER_REVIEW'].includes(value)) {
      return chalk.yellow(value);
    }
    if (['DELETED', 'REJECTED', 'DISABLED', 'NOT_ACTIVE'].includes(value)) {
      return chalk.red(value);
    }
    return chalk.white(value);
  }
  return chalk.white(String(value));
}

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function table(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): void {
  if (outputFormat === 'json') {
    const data = rows.map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((header, i) => {
        obj[header] = row[i];
      });
      return obj;
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const values = [h, ...rows.map((r) => String(r[i] ?? ''))];
    return Math.min(Math.max(...values.map((v) => v.length)), 50);
  });

  // Print header
  const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  console.log(chalk.bold(headerRow));
  console.log(chalk.gray('─'.repeat(headerRow.length)));

  // Print rows
  for (const row of rows) {
    const formattedRow = row
      .map((cell, i) => {
        const str = String(cell ?? '');
        const truncated = str.length > widths[i] ? str.slice(0, widths[i] - 3) + '...' : str;
        return truncated.padEnd(widths[i]);
      })
      .join('  ');
    console.log(formattedRow);
  }
}

// Format micro amounts to regular currency
export function formatMicro(microAmount: number | null | undefined): string {
  if (microAmount === null || microAmount === undefined) {
    return '-';
  }
  return (microAmount / 1_000_000).toFixed(2);
}

// Format percentage
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return `${(value * 100).toFixed(2)}%`;
}
