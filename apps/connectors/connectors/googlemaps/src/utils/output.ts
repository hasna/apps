import chalk from 'chalk';
import type { OutputFormat, GeocodingResult, Place, PlaceDetails, DirectionsRoute, DistanceMatrixResponse } from '../types';

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

export function printGeocodingResults(results: GeocodingResult[], format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const result of results) {
    console.log(chalk.bold(result.formatted_address));
    console.log(`  ${chalk.gray('Coordinates:')} ${result.geometry.location.lat}, ${result.geometry.location.lng}`);
    console.log(`  ${chalk.gray('Place ID:')} ${result.place_id}`);
    console.log(`  ${chalk.gray('Type:')} ${result.types.join(', ')}`);
    console.log();
  }
}

export function printPlaces(places: Place[], format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(places, null, 2));
    return;
  }

  for (const place of places) {
    const rating = place.rating ? `⭐ ${place.rating} (${place.user_ratings_total} reviews)` : '';
    const priceLevel = place.price_level ? '💰'.repeat(place.price_level) : '';
    const openNow = place.opening_hours?.open_now !== undefined
      ? (place.opening_hours.open_now ? chalk.green('Open') : chalk.red('Closed'))
      : '';

    console.log(chalk.bold(place.name) + (rating ? ` ${rating}` : '') + (priceLevel ? ` ${priceLevel}` : ''));
    if (place.formatted_address || place.vicinity) {
      console.log(`  ${chalk.gray('Address:')} ${place.formatted_address || place.vicinity}`);
    }
    if (openNow) {
      console.log(`  ${chalk.gray('Status:')} ${openNow}`);
    }
    console.log(`  ${chalk.gray('Place ID:')} ${place.place_id}`);
    console.log();
  }
}

export function printPlaceDetails(place: PlaceDetails, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(place, null, 2));
    return;
  }

  const rating = place.rating ? `⭐ ${place.rating} (${place.user_ratings_total} reviews)` : '';
  const priceLevel = place.price_level ? '💰'.repeat(place.price_level) : '';

  console.log(chalk.bold.underline(place.name));
  console.log();

  if (rating) console.log(`${chalk.gray('Rating:')} ${rating}`);
  if (priceLevel) console.log(`${chalk.gray('Price:')} ${priceLevel}`);
  if (place.formatted_address) console.log(`${chalk.gray('Address:')} ${place.formatted_address}`);
  if (place.formatted_phone_number) console.log(`${chalk.gray('Phone:')} ${place.formatted_phone_number}`);
  if (place.website) console.log(`${chalk.gray('Website:')} ${place.website}`);
  if (place.url) console.log(`${chalk.gray('Google Maps:')} ${place.url}`);

  if (place.opening_hours) {
    const status = place.opening_hours.open_now ? chalk.green('Open now') : chalk.red('Closed');
    console.log(`${chalk.gray('Status:')} ${status}`);
    if (place.opening_hours.weekday_text) {
      console.log(`${chalk.gray('Hours:')}`);
      for (const day of place.opening_hours.weekday_text) {
        console.log(`  ${day}`);
      }
    }
  }

  if (place.reviews && place.reviews.length > 0) {
    console.log();
    console.log(chalk.gray('Recent Reviews:'));
    for (const review of place.reviews.slice(0, 3)) {
      console.log(`  ⭐ ${review.rating} - ${review.author_name} (${review.relative_time_description})`);
      console.log(`  ${chalk.italic(review.text.slice(0, 200))}${review.text.length > 200 ? '...' : ''}`);
      console.log();
    }
  }
}

export function printDirections(routes: DirectionsRoute[], format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(routes, null, 2));
    return;
  }

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    console.log(chalk.bold(`Route ${i + 1}: ${route.summary}`));

    for (const leg of route.legs) {
      console.log(`  ${chalk.cyan(leg.start_address)}`);
      console.log(`  ${chalk.gray('→')} ${chalk.cyan(leg.end_address)}`);
      console.log(`  ${chalk.gray('Distance:')} ${leg.distance.text}`);
      console.log(`  ${chalk.gray('Duration:')} ${leg.duration.text}`);
      if (leg.duration_in_traffic) {
        console.log(`  ${chalk.gray('Duration (traffic):')} ${leg.duration_in_traffic.text}`);
      }
      console.log();

      console.log(chalk.gray('  Steps:'));
      for (let j = 0; j < leg.steps.length; j++) {
        const step = leg.steps[j];
        const instruction = step.html_instructions
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ');
        console.log(`  ${j + 1}. ${instruction} (${step.distance.text})`);
      }
    }
    console.log();

    if (route.warnings.length > 0) {
      console.log(chalk.yellow('Warnings:'));
      for (const warning of route.warnings) {
        console.log(`  ⚠ ${warning}`);
      }
    }
    console.log();
  }
}

export function printDistanceMatrix(response: DistanceMatrixResponse, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  console.log(chalk.bold('Distance Matrix'));
  console.log();

  for (let i = 0; i < response.origin_addresses.length; i++) {
    console.log(chalk.cyan(`From: ${response.origin_addresses[i]}`));

    for (let j = 0; j < response.destination_addresses.length; j++) {
      const element = response.rows[i].elements[j];
      console.log(`  ${chalk.gray('To:')} ${response.destination_addresses[j]}`);

      if (element.status === 'OK') {
        console.log(`    ${chalk.gray('Distance:')} ${element.distance.text}`);
        console.log(`    ${chalk.gray('Duration:')} ${element.duration.text}`);
        if (element.duration_in_traffic) {
          console.log(`    ${chalk.gray('Duration (traffic):')} ${element.duration_in_traffic.text}`);
        }
      } else {
        console.log(`    ${chalk.red(element.status)}`);
      }
    }
    console.log();
  }
}
