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
    return;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      console.log(item);
    }
    return;
  }

  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        console.log(chalk.bold(key));
        for (const row of value) {
          console.log(`  ${JSON.stringify(row)}`);
        }
      } else {
        console.log(`${chalk.bold(key)}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      }
    }
    return;
  }

  console.log(data);
}
