import chalk from 'chalk';
import type { OutputFormat } from '../types';

export function success(message: string): void {
  console.log(chalk.green('[ok]'), message);
}

export function error(message: string): void {
  console.error(chalk.red('[error]'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('[warn]'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('[info]'), message);
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
