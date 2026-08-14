import chalk from 'chalk';

export type OutputFormat = 'json' | 'pretty';

let verboseMode = false;

export function setVerboseMode(enabled: boolean): void {
  verboseMode = enabled;
}

export function isVerboseMode(): boolean {
  return verboseMode;
}

export function debug(message: string, data?: unknown): void {
  if (!verboseMode) return;
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(chalk.gray(`[${timestamp}]`), chalk.dim(message));
  if (data !== undefined) {
    if (typeof data === 'object') {
      console.log(chalk.gray(JSON.stringify(data, null, 2)));
    } else {
      console.log(chalk.gray(String(data)));
    }
  }
}

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
  if (data === null || data === undefined) {
    return chalk.gray('(empty)');
  }
  if (typeof data === 'string') {
    return data;
  }
  return JSON.stringify(data, null, 2);
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  console.log(formatOutput(data, format));
}

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('!'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('i'), message);
}

export function heading(message: string): void {
  console.log(chalk.bold(message));
}
