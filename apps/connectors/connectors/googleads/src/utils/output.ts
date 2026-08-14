import chalk from 'chalk';

export type OutputFormat = 'json' | 'pretty';

export function success(message: string): void {
  console.log(chalk.green('OK'), message);
}

export function error(message: string): void {
  console.error(chalk.red('Error'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('Info'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('Warn'), message);
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

export function formatMicros(micros: string | number | undefined): string {
  if (micros === undefined || micros === null) return '$0.00';
  const num = typeof micros === 'string' ? parseInt(micros, 10) : micros;
  return `$${(num / 1_000_000).toFixed(2)}`;
}

export function formatNumber(num: string | number | undefined): string {
  if (num === undefined || num === null) return '0';
  const n = typeof num === 'string' ? parseInt(num, 10) : num;
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toString();
}

export function formatPercent(num: number | undefined): string {
  if (num === undefined || num === null) return '0%';
  return `${(num * 100).toFixed(2)}%`;
}

export function formatCustomerId(id: string): string {
  // Format as XXX-XXX-XXXX
  const clean = id.replace(/\D/g, '');
  if (clean.length !== 10) return id;
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
}

export function parseCustomerId(id: string): string {
  // Remove dashes and return just digits
  return id.replace(/\D/g, '');
}
