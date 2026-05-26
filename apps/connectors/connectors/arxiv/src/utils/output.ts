import chalk from 'chalk';
import type { OutputFormat } from '../types';

export function success(message: string): void {
  console.log(chalk.green('\u2713'), message);
}

export function error(message: string): void {
  console.error(chalk.red('\u2717'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('\u26a0'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('\u2139'), message);
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else if (format === 'table' && Array.isArray(data)) {
    console.table(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
