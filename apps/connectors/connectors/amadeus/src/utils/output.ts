import chalk from 'chalk';
import type { FlightOffer, Location, FlightDestination } from '../types';

export type OutputFormat = 'json' | 'pretty';

export function print(data: unknown, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    prettyPrint(data);
  }
}

function prettyPrint(data: unknown): void {
  if (Array.isArray(data)) {
    data.forEach((item, index) => {
      if (index > 0) console.log('');
      prettyPrint(item);
    });
  } else if (typeof data === 'object' && data !== null) {
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (typeof value === 'object') {
          console.log(chalk.bold(key + ':'));
          if (Array.isArray(value)) {
            value.forEach(v => console.log('  - ' + (typeof v === 'object' ? JSON.stringify(v) : v)));
          } else {
            Object.entries(value).forEach(([k, v]) => console.log('  ' + k + ': ' + v));
          }
        } else {
          console.log(chalk.bold(key) + ': ' + value);
        }
      }
    });
  } else {
    console.log(data);
  }
}

export function printFlightOffers(offers: FlightOffer[], carriers?: Record<string, string>, format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(offers, null, 2));
    return;
  }

  offers.forEach((offer, index) => {
    if (index > 0) console.log('');
    console.log(chalk.bold.blue('Flight Option ' + (index + 1)));
    console.log('  ' + chalk.green(offer.price.currency + ' ' + offer.price.grandTotal));

    offer.itineraries.forEach((itinerary, itinIndex) => {
      const direction = offer.itineraries.length > 1 ? (itinIndex === 0 ? 'Outbound' : 'Return') : 'Flight';
      console.log('  ' + chalk.bold(direction) + ' (' + formatDuration(itinerary.duration) + '):');

      itinerary.segments.forEach((seg, segIndex) => {
        const carrier = carriers?.[seg.carrierCode] || seg.carrierCode;
        const depTime = new Date(seg.departure.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const arrTime = new Date(seg.arrival.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const depDate = new Date(seg.departure.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

        if (segIndex > 0) console.log('    ' + chalk.gray('--- layover ---'));
        console.log('    ' + seg.departure.iataCode + ' ' + depTime + ' -> ' + seg.arrival.iataCode + ' ' + arrTime + ' (' + depDate + ')');
        console.log('    ' + chalk.gray(carrier + ' ' + seg.carrierCode + seg.number + ' | ' + formatDuration(seg.duration)));
      });
    });

    if (offer.numberOfBookableSeats) {
      console.log('  ' + chalk.yellow(offer.numberOfBookableSeats + ' seats left'));
    }
  });
}

export function printLocations(locations: Location[], format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(locations, null, 2));
    return;
  }

  locations.forEach((loc, index) => {
    if (index > 0) console.log('');
    console.log(chalk.bold.blue(loc.iataCode) + ' - ' + loc.name);
    console.log('  ' + loc.address.cityName + ', ' + loc.address.countryName);
    console.log('  ' + chalk.gray(loc.subType));
  });
}

export function printDestinations(destinations: FlightDestination[], format: OutputFormat = 'pretty'): void {
  if (format === 'json') {
    console.log(JSON.stringify(destinations, null, 2));
    return;
  }

  console.log(chalk.bold('Cheapest Destinations from ' + destinations[0]?.origin));
  console.log('');

  destinations.forEach(dest => {
    console.log(chalk.blue(dest.destination) + ': ' + chalk.green(dest.price.total));
    console.log('  ' + dest.departureDate + (dest.returnDate ? ' - ' + dest.returnDate : ''));
  });
}

function formatDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return isoDuration;
  const hours = match[1] || '0';
  const minutes = match[2] || '0';
  return hours + 'h ' + minutes + 'm';
}

export function success(message: string): void {
  console.log(chalk.green('\u2713') + ' ' + message);
}

export function error(message: string): void {
  console.error(chalk.red('\u2717') + ' ' + message);
}

export function info(message: string): void {
  console.log(chalk.blue('\u2139') + ' ' + message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('\u26A0') + ' ' + message);
}
