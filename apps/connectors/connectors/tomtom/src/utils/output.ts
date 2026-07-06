import chalk from 'chalk';
import type {
  OutputFormat,
  TomTomSearchResult,
  TomTomRoute,
} from '../types';

export function success(message: string): void {
  console.log(chalk.green('✓') + ' ' + message);
}

export function error(message: string): void {
  console.error(chalk.red('✗') + ' ' + message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠') + ' ' + message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ') + ' ' + message);
}

export function print(data: unknown, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

function formatAddress(result: TomTomSearchResult): string {
  if (result.address?.freeformAddress) {
    return result.address.freeformAddress;
  }
  const parts = [
    result.poi?.name,
    result.address?.streetName,
    result.address?.municipality,
    result.address?.country,
  ].filter(Boolean);
  return parts.join(', ') || 'Unknown location';
}

export function printSearchResults(results: TomTomSearchResult[], format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const result of results) {
    const label = result.poi?.name || formatAddress(result);
    console.log(chalk.bold(label));
    if (result.position) {
      console.log(`  ${chalk.gray('Coordinates:')} ${result.position.lat}, ${result.position.lon}`);
    }
    if (result.address?.freeformAddress && result.poi?.name) {
      console.log(`  ${chalk.gray('Address:')} ${result.address.freeformAddress}`);
    }
    if (result.score !== undefined) {
      console.log(`  ${chalk.gray('Score:')} ${result.score}`);
    }
    if (result.poi?.categories?.length) {
      console.log(`  ${chalk.gray('Categories:')} ${result.poi.categories.join(', ')}`);
    }
    console.log();
  }
}

export function printRoutes(routes: TomTomRoute[], format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(routes, null, 2));
    return;
  }

  routes.forEach((route, index) => {
    const summary = route.summary;
    console.log(chalk.bold(`Route ${index + 1}`));
    if (summary?.lengthInMeters !== undefined) {
      const km = (summary.lengthInMeters / 1000).toFixed(2);
      console.log(`  ${chalk.gray('Distance:')} ${km} km`);
    }
    if (summary?.travelTimeInSeconds !== undefined) {
      const minutes = Math.round(summary.travelTimeInSeconds / 60);
      console.log(`  ${chalk.gray('Travel time:')} ${minutes} min`);
    }
    if (summary?.trafficDelayInSeconds) {
      console.log(`  ${chalk.gray('Traffic delay:')} ${Math.round(summary.trafficDelayInSeconds / 60)} min`);
    }
    console.log();
  });
}
