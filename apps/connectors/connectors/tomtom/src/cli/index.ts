#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TomTom } from '../api';
import { getApiKey, setApiKey, clearConfig, getConfigDir } from '../utils/config';
import type { OutputFormat } from '../types';
import {
  success,
  error,
  info,
  warn,
  print,
  printSearchResults,
  printRoutes,
} from '../utils/output';

const CONNECTOR_NAME = 'connect-tomtom';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TomTom connector - Geocoding, reverse geocoding, POI search, and routing')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty');

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TomTom {
  const apiKey = getApiKey();

  if (!apiKey) {
    error('No API key configured. Run "' + CONNECTOR_NAME + ' config set-key <apiKey>"');
    error('Get your API key at: https://developer.tomtom.com/');
    process.exit(1);
  }

  return new TomTom({ apiKey });
}

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set TomTom API key').action((apiKey: string) => {
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

program
  .command('geocode <query>')
  .description('Geocode an address or place query')
  .option('--limit <n>', 'Maximum number of results', '10')
  .option('--country-set <codes>', 'Comma-separated ISO country codes')
  .action(async function (this: Command, query: string, opts) {
    try {
      const client = getClient();
      const result = await client.geocode(query, {
        limit: parseInt(opts.limit, 10),
        countrySet: opts.countrySet,
      });
      const results = result.results ?? [];

      if (results.length === 0) {
        warn('No results found');
        return;
      }

      info(`Found ${results.length} result(s)`);
      printSearchResults(results, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('reverse-geocode <lat> <lon>')
  .description('Reverse geocode coordinates to an address')
  .action(async function (this: Command, lat: string, lon: string) {
    try {
      const client = getClient();
      const result = await client.reverseGeocode(parseFloat(lat), parseFloat(lon));
      const results = result.results ?? [];

      if (results.length === 0) {
        warn('No results found');
        return;
      }

      info(`Found ${results.length} result(s)`);
      printSearchResults(results, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search-poi <query>')
  .description('Search points of interest by text query')
  .option('--limit <n>', 'Maximum number of results', '10')
  .option('--country-set <codes>', 'Comma-separated ISO country codes')
  .action(async function (this: Command, query: string, opts) {
    try {
      const client = getClient();
      const result = await client.poiSearch(query, {
        limit: parseInt(opts.limit, 10),
        countrySet: opts.countrySet,
      });
      const results = result.results ?? [];

      if (results.length === 0) {
        warn('No POIs found');
        return;
      }

      info(`Found ${results.length} POI(s)`);
      printSearchResults(results, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('calculate-route')
  .description('Calculate a route between two coordinate pairs')
  .requiredOption('--origin-lat <lat>', 'Origin latitude')
  .requiredOption('--origin-lon <lon>', 'Origin longitude')
  .requiredOption('--destination-lat <lat>', 'Destination latitude')
  .requiredOption('--destination-lon <lon>', 'Destination longitude')
  .option('--travel-mode <mode>', 'Travel mode (car, truck, pedestrian, bicycle, etc.)', 'car')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.calculateRoute(
        parseFloat(opts.originLat),
        parseFloat(opts.originLon),
        parseFloat(opts.destinationLat),
        parseFloat(opts.destinationLon),
        { travelMode: opts.travelMode }
      );
      const routes = result.routes ?? [];

      if (routes.length === 0) {
        warn('No routes found');
        return;
      }

      info(`Found ${routes.length} route(s)`);
      printRoutes(routes, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
