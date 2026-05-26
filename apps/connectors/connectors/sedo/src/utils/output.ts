import chalk from 'chalk';

export type OutputFormat = 'json' | 'table' | 'pretty';

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function error(message: string): void {
  console.log(chalk.red('✗'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (format === 'table' && Array.isArray(data)) {
    console.table(data);
    return;
  }

  // Pretty format
  if (Array.isArray(data)) {
    data.forEach((item, index) => {
      if (index > 0) console.log('---');
      printObject(item);
    });
  } else if (typeof data === 'object' && data !== null) {
    printObject(data as Record<string, unknown>);
  } else {
    console.log(data);
  }
}

function printObject(obj: Record<string, unknown>, indent = 0): void {
  const prefix = '  '.repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      console.log(`${prefix}${chalk.gray(key)}:`);
      printObject(value as Record<string, unknown>, indent + 1);
    } else if (Array.isArray(value)) {
      console.log(`${prefix}${chalk.gray(key)}: ${value.join(', ')}`);
    } else {
      console.log(`${prefix}${chalk.gray(key)}: ${value}`);
    }
  }
}

export function formatPrice(price: number, currencyCode: string): string {
  return `${currencyCode} ${price.toFixed(2)}`;
}
