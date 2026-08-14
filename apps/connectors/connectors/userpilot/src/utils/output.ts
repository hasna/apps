import type { OutputFormat } from '../types';

export function formatOutput(data: unknown, format: OutputFormat = 'pretty'): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  return JSON.stringify(data, null, 2);
}

export function printOutput(data: unknown, format: OutputFormat = 'pretty'): void {
  console.log(formatOutput(data, format));
}
