import chalk from 'chalk';
import type { OutputFormat } from '../types';

let verboseMode = false;

export function setVerboseMode(enabled: boolean): void {
  verboseMode = enabled;
}

export function isVerboseMode(): boolean {
  return verboseMode;
}

export function debug(message: string, data?: unknown): void {
  if (!verboseMode) return;
  console.log(chalk.gray(message));
  if (data !== undefined) {
    console.log(chalk.gray(typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data)));
  }
}

export function formatOutput(data: unknown, format: OutputFormat = 'pretty'): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  if (typeof data === 'string') {
    return data;
  }
  return JSON.stringify(data, null, 2);
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

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  console.log(formatOutput(data, format));
}

export async function printStream(response: Response, raw = false): Promise<void> {
  if (!response.body) {
    console.log(await response.text());
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (raw) {
      process.stdout.write(chunk);
    } else {
      print(chunk, 'json');
    }
  }
}

export type { OutputFormat };
