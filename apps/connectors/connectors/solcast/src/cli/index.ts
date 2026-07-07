#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Solcast } from '../api';
import {
  clearConfig,
  getApiKey,
  getBaseUrl,
  loadConfig,
  setApiKey,
  setBaseUrl,
} from '../utils/config';
import type { OutputFormat } from '../types';
import { error, info, print, success } from '../utils/output';

const pkg = await import('../../package.json');
const VERSION = pkg.version || '0.0.0';

const program = new Command();

program
  .name('connect-solcast')
  .description('Solcast solar PV forecast API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Solcast API key')
  .option('-f, --format <format>', 'Output format: json, pretty', 'pretty')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.apiKey) {
      process.env.SOLCAST_API_KEY = opts.apiKey;
    }
  });

function getClient(): Solcast {
  const apiKey = getApiKey();
  if (!apiKey) {
    error('No API key configured. Run "connect-solcast config set-key <key>" or set SOLCAST_API_KEY');
    process.exit(1);
  }
  return new Solcast({ apiKey, baseUrl: getBaseUrl() });
}

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || program.opts().format || 'pretty') as OutputFormat;
}

function parseNumber(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    error(`Invalid ${label}: ${value}`);
    process.exit(1);
  }
  return n;
}

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set Solcast API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success('API key saved');
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL set to: ${url}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    const apiKey = getApiKey();
    console.log(chalk.bold('Solcast Configuration:'));
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.solcast.com.au)')}`);
    if (config.baseUrl) {
      info(`Stored base URL: ${config.baseUrl}`);
    }
  });

configCmd
  .command('clear')
  .description('Clear stored configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

function rooftopOptions(cmd: Command) {
  return cmd
    .requiredOption('--lat <latitude>', 'Latitude')
    .requiredOption('--lon <longitude>', 'Longitude')
    .requiredOption('--capacity <kw>', 'Installed capacity in kW')
    .option('--hours <hours>', 'Forecast horizon in hours')
    .option('--period <period>', 'Time period (e.g. PT30M)')
    .option('--output-parameters <params>', 'Output parameters', 'pv_power_rooftop')
    .option('--tilt <degrees>', 'Panel tilt in degrees')
    .option('--azimuth <degrees>', 'Panel azimuth in degrees')
    .option('--loss-factor <factor>', 'Bulk loss factor')
    .option('--start <iso>', 'Start time (historic)')
    .option('--end <iso>', 'End time (historic)');
}

function parseRooftopOpts(opts: Record<string, string | undefined>) {
  return {
    latitude: parseNumber(opts.lat!, 'latitude'),
    longitude: parseNumber(opts.lon!, 'longitude'),
    capacity: parseNumber(opts.capacity!, 'capacity'),
    hours: opts.hours ? parseNumber(opts.hours, 'hours') : undefined,
    period: opts.period,
    output_parameters: opts.outputParameters,
    tilt: opts.tilt ? parseNumber(opts.tilt, 'tilt') : undefined,
    azimuth: opts.azimuth ? parseNumber(opts.azimuth, 'azimuth') : undefined,
    loss_factor: opts.lossFactor ? parseNumber(opts.lossFactor, 'loss factor') : undefined,
    start: opts.start,
    end: opts.end,
  };
}

const forecastCmd = program.command('forecast').description('PV power forecasts');

rooftopOptions(
  forecastCmd
    .command('rooftop-pv-power')
    .description('Get rooftop PV power forecast for a location')
    .action(async (opts) => {
      try {
        const client = getClient();
        const data = await client.api.forecastRooftopPvPower(parseRooftopOpts(opts));
        print(data, getFormat(forecastCmd));
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    }),
);

const liveCmd = program.command('live').description('Live PV estimated actuals');

rooftopOptions(
  liveCmd
    .command('rooftop-pv-power')
    .description('Get live rooftop PV power estimates')
    .action(async (opts) => {
      try {
        const client = getClient();
        const data = await client.api.liveRooftopPvPower(parseRooftopOpts(opts));
        print(data, getFormat(liveCmd));
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    }),
);

const historicCmd = program.command('historic').description('Historic PV data');

rooftopOptions(
  historicCmd
    .command('rooftop-pv-power')
    .description('Get historic rooftop PV power data')
    .action(async (opts) => {
      try {
        const client = getClient();
        const data = await client.api.historicRooftopPvPower(parseRooftopOpts(opts));
        print(data, getFormat(historicCmd));
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    }),
);

const siteCmd = program.command('site').description('Registered rooftop site data');

siteCmd
  .command('forecasts <siteId>')
  .description('Get forecasts for a registered rooftop site')
  .option('--hours <hours>', 'Hours of forecast data')
  .option('--period <period>', 'Time period (e.g. PT30M)')
  .option('--output-parameters <params>', 'Output parameters')
  .option('--start <iso>', 'Start time')
  .option('--end <iso>', 'End time')
  .action(async (siteId: string, opts) => {
    try {
      const client = getClient();
      const data = await client.api.rooftopSiteForecasts(siteId, {
        hours: opts.hours ? parseNumber(opts.hours, 'hours') : undefined,
        period: opts.period,
        output_parameters: opts.outputParameters,
        start: opts.start,
        end: opts.end,
      });
      print(data, getFormat(siteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

siteCmd
  .command('actuals <siteId>')
  .description('Get estimated actuals for a registered rooftop site')
  .option('--hours <hours>', 'Hours of data')
  .option('--period <period>', 'Time period (e.g. PT30M)')
  .option('--output-parameters <params>', 'Output parameters')
  .option('--start <iso>', 'Start time')
  .option('--end <iso>', 'End time')
  .action(async (siteId: string, opts) => {
    try {
      const client = getClient();
      const data = await client.api.rooftopSiteEstimatedActuals(siteId, {
        hours: opts.hours ? parseNumber(opts.hours, 'hours') : undefined,
        period: opts.period,
        output_parameters: opts.outputParameters,
        start: opts.start,
        end: opts.end,
      });
      print(data, getFormat(siteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw')
  .description('Raw GET request against the Solcast API')
  .requiredOption('--path <path>', 'API path (e.g. /data/forecast/rooftop_pv_power)')
  .option('--lat <latitude>', 'Latitude query param')
  .option('--lon <longitude>', 'Longitude query param')
  .option('--capacity <kw>', 'Capacity query param')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | undefined> = {};
      if (opts.lat) params.latitude = parseNumber(opts.lat, 'latitude');
      if (opts.lon) params.longitude = parseNumber(opts.lon, 'longitude');
      if (opts.capacity) params.capacity = parseNumber(opts.capacity, 'capacity');
      const data = await client.api.rawGet(opts.path, params);
      print(data, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
