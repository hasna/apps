import chalk from 'chalk';

let verbose = false;

export function setVerbose(value: boolean): void {
  verbose = value;
}

export function isVerbose(): boolean {
  return verbose;
}

export function debug(message: string, ...args: unknown[]): void {
  if (verbose) {
    console.error(chalk.gray(`[debug] ${message}`), ...args);
  }
}
