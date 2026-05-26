#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { GoogleMaps } from '../api';
import { getApiKey, setApiKey, clearConfig, getConfigDir } from '../utils/config';
import type { OutputFormat, TravelMode, AvoidType } from '../types';
import {
  success,
  error,
  info,
  warn,
  print,
  printGeocodingResults,
  printPlaces,
  printPlaceDetails,
  printDirections,
  printDistanceMatrix,
} from '../utils/output';

const CONNECTOR_NAME = 'connect-googlemaps';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Google Maps Platform connector - Geocoding, Directions, Places, and Distance Matrix')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty');

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): GoogleMaps {
  const apiKey = getApiKey();

  if (!apiKey) {
    error('No API key configured. Run "' + CONNECTOR_NAME + ' config set-key <apiKey>"');
    error('Get your API key at: https://console.cloud.google.com/google/maps-apis');
    process.exit(1);
  }

  return new GoogleMaps({ apiKey });
}

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set Google Maps API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success('API key saved');
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold('Configuration'));
  info('Config directory: ' + getConfigDir());
  info('API Key: ' + (apiKey ? apiKey.substring(0, 10) + '...' : chalk.gray('not set')));
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success('Configuration cleared');
});

// ============================================
// Geocoding Commands
// ============================================
const geocodeCmd = program.command('geocode').description('Geocoding and reverse geocoding');

geocodeCmd.command('address <address>')
  .description('Convert address to coordinates')
  .action(async function(this: Command, address: string) {
    try {
      const client = getClient();
      const result = await client.geocode(address);

      if (result.results.length === 0) {
        warn('No results found');
        return;
      }

      info(`Found ${result.results.length} result(s)`);
      printGeocodingResults(result.results, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

geocodeCmd.command('coords <lat> <lng>')
  .description('Convert coordinates to address (reverse geocoding)')
  .action(async function(this: Command, lat: string, lng: string) {
    try {
      const client = getClient();
      const result = await client.reverseGeocode(parseFloat(lat), parseFloat(lng));

      if (result.results.length === 0) {
        warn('No results found');
        return;
      }

      info(`Found ${result.results.length} result(s)`);
      printGeocodingResults(result.results, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Places Commands
// ============================================
const placesCmd = program.command('places').description('Search and explore places');

placesCmd.command('search <query>')
  .description('Search for places by text query')
  .option('--location <lat,lng>', 'Bias results to location')
  .option('--radius <meters>', 'Search radius in meters')
  .option('--type <type>', 'Filter by place type (restaurant, hotel, etc.)')
  .option('--opennow', 'Only show places open now')
  .action(async function(this: Command, query: string, opts) {
    try {
      const client = getClient();
      const result = await client.searchPlaces(query, {
        location: opts.location,
        radius: opts.radius ? parseInt(opts.radius) : undefined,
        type: opts.type,
        opennow: opts.opennow,
      });

      if (result.results.length === 0) {
        warn('No places found');
        return;
      }

      info(`Found ${result.results.length} place(s)`);
      printPlaces(result.results, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

placesCmd.command('nearby')
  .description('Search for places near a location')
  .requiredOption('--location <lat,lng>', 'Center location (lat,lng)')
  .option('--radius <meters>', 'Search radius in meters (default: 1500)', '1500')
  .option('--type <type>', 'Filter by place type')
  .option('--keyword <keyword>', 'Keyword to search for')
  .option('--opennow', 'Only show places open now')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.nearbySearch({
        location: opts.location,
        radius: parseInt(opts.radius),
        type: opts.type,
        keyword: opts.keyword,
        opennow: opts.opennow,
      });

      if (result.results.length === 0) {
        warn('No places found nearby');
        return;
      }

      info(`Found ${result.results.length} place(s) nearby`);
      printPlaces(result.results, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

placesCmd.command('details <placeId>')
  .description('Get detailed information about a place')
  .action(async function(this: Command, placeId: string) {
    try {
      const client = getClient();
      const result = await client.getPlaceDetails(placeId);

      printPlaceDetails(result.result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

placesCmd.command('autocomplete <input>')
  .description('Autocomplete place search')
  .option('--location <lat,lng>', 'Bias results to location')
  .option('--radius <meters>', 'Search radius')
  .option('--types <types>', 'Filter by types (geocode, address, establishment, etc.)')
  .action(async function(this: Command, input: string, opts) {
    try {
      const client = getClient();
      const result = await client.autocomplete(input, {
        location: opts.location,
        radius: opts.radius ? parseInt(opts.radius) : undefined,
        types: opts.types,
      });

      if (result.predictions.length === 0) {
        warn('No suggestions found');
        return;
      }

      const format = getFormat(this);
      if (format === 'json') {
        console.log(JSON.stringify(result.predictions, null, 2));
      } else {
        for (const pred of result.predictions) {
          console.log(chalk.bold(pred.description));
          console.log(`  ${chalk.gray('Place ID:')} ${pred.place_id}`);
          console.log(`  ${chalk.gray('Types:')} ${pred.types.join(', ')}`);
          console.log();
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Directions Commands
// ============================================
const directionsCmd = program.command('directions').description('Get directions between locations');

directionsCmd.command('route')
  .description('Get directions from origin to destination')
  .requiredOption('--from <location>', 'Starting location (address or lat,lng)')
  .requiredOption('--to <location>', 'Destination (address or lat,lng)')
  .option('--mode <mode>', 'Travel mode: driving, walking, bicycling, transit', 'driving')
  .option('--waypoints <points>', 'Waypoints separated by |')
  .option('--alternatives', 'Show alternative routes')
  .option('--avoid <types>', 'Avoid: tolls, highways, ferries (comma-separated)')
  .option('--units <units>', 'Units: metric, imperial', 'metric')
  .option('--departure <time>', 'Departure time (unix timestamp or "now")')
  .option('--traffic <model>', 'Traffic model: best_guess, pessimistic, optimistic')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();

      const avoidTypes = opts.avoid
        ? (opts.avoid.split(',') as AvoidType[])
        : undefined;

      const waypoints = opts.waypoints
        ? opts.waypoints.split('|')
        : undefined;

      const departureTime = opts.departure === 'now'
        ? 'now'
        : opts.departure
          ? parseInt(opts.departure)
          : undefined;

      const result = await client.getDirections({
        origin: opts.from,
        destination: opts.to,
        mode: opts.mode as TravelMode,
        waypoints,
        alternatives: opts.alternatives,
        avoid: avoidTypes,
        units: opts.units,
        departure_time: departureTime,
        traffic_model: opts.traffic,
      });

      if (result.routes.length === 0) {
        warn('No routes found');
        return;
      }

      info(`Found ${result.routes.length} route(s)`);
      printDirections(result.routes, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Distance Matrix Commands
// ============================================
const matrixCmd = program.command('matrix').description('Calculate distances between multiple points');

matrixCmd.command('calculate')
  .description('Get travel distances and times between origins and destinations')
  .requiredOption('--origins <locations>', 'Origins separated by |')
  .requiredOption('--destinations <locations>', 'Destinations separated by |')
  .option('--mode <mode>', 'Travel mode: driving, walking, bicycling, transit', 'driving')
  .option('--avoid <types>', 'Avoid: tolls, highways, ferries (comma-separated)')
  .option('--units <units>', 'Units: metric, imperial', 'metric')
  .option('--departure <time>', 'Departure time (unix timestamp or "now")')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();

      const avoidTypes = opts.avoid
        ? (opts.avoid.split(',') as AvoidType[])
        : undefined;

      const departureTime = opts.departure === 'now'
        ? 'now'
        : opts.departure
          ? parseInt(opts.departure)
          : undefined;

      const result = await client.getDistanceMatrix({
        origins: opts.origins.split('|'),
        destinations: opts.destinations.split('|'),
        mode: opts.mode as TravelMode,
        avoid: avoidTypes,
        units: opts.units,
        departure_time: departureTime,
      });

      printDistanceMatrix(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Timezone Command
// ============================================
program.command('timezone <lat> <lng>')
  .description('Get timezone for a location')
  .action(async function(this: Command, lat: string, lng: string) {
    try {
      const client = getClient();
      const result = await client.getTimezone(parseFloat(lat), parseFloat(lng));

      const format = getFormat(this);
      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.bold(result.timeZoneName));
        info(`Timezone ID: ${result.timeZoneId}`);
        info(`UTC Offset: ${result.rawOffset / 3600} hours`);
        info(`DST Offset: ${result.dstOffset / 3600} hours`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Elevation Command
// ============================================
program.command('elevation <locations>')
  .description('Get elevation for locations (format: lat,lng|lat,lng|...)')
  .action(async function(this: Command, locations: string) {
    try {
      const client = getClient();

      const locationArray = locations.split('|').map(loc => {
        const [lat, lng] = loc.split(',');
        return { lat: parseFloat(lat), lng: parseFloat(lng) };
      });

      const result = await client.getElevation(locationArray);

      const format = getFormat(this);
      if (format === 'json') {
        console.log(JSON.stringify(result.results, null, 2));
      } else {
        for (const r of result.results) {
          console.log(`${chalk.gray('Location:')} ${r.location.lat}, ${r.location.lng}`);
          console.log(`${chalk.bold('Elevation:')} ${r.elevation.toFixed(2)}m`);
          console.log(`${chalk.gray('Resolution:')} ${r.resolution.toFixed(2)}m`);
          console.log();
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Static Map URL Command
// ============================================
program.command('staticmap')
  .description('Generate a static map URL')
  .option('--center <location>', 'Center of the map')
  .option('--zoom <level>', 'Zoom level (0-21)')
  .option('--size <WxH>', 'Map size (e.g., 600x400)', '600x400')
  .option('--markers <locations>', 'Marker locations separated by |')
  .option('--maptype <type>', 'Map type: roadmap, satellite, terrain, hybrid', 'roadmap')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();

      const markers = opts.markers
        ? opts.markers.split('|').map((loc: string) => ({ location: loc }))
        : undefined;

      const url = client.getStaticMapUrl({
        center: opts.center,
        zoom: opts.zoom ? parseInt(opts.zoom) : undefined,
        size: opts.size,
        markers,
        maptype: opts.maptype,
      });

      console.log(url);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
