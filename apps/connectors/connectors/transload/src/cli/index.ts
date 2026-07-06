#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-transload';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Transload connector CLI - freight dimension measurement and warehouse vision')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.TRANSLOAD_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRANSLOAD_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: getBaseUrl() });
}

function parseQueryOptions(opts: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && value !== null && !['format', 'profile', 'apiKey', 'verbose', 'body'].includes(key)) {
      params[key] = String(value);
    }
  }
  return params;
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) {
    success(`Profile "${name}" deleted`);
  } else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl()}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Sites commands
const sitesCmd = program.command('sites').description('Manage warehouse sites');

sitesCmd.command('list')
  .description('List warehouse sites')
  .option('--limit <number>', 'Limit results')
  .option('--offset <number>', 'Offset for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.sites.list(parseQueryOptions(opts));
      print(result, getFormat(sitesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sitesCmd.command('get <siteId>')
  .description('Get a warehouse site by ID')
  .action(async (siteId: string) => {
    try {
      const client = getClient();
      const result = await client.sites.get(siteId);
      print(result, getFormat(sitesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Shipments commands
const shipmentsCmd = program.command('shipments').description('Manage freight shipments');

shipmentsCmd.command('list')
  .description('List shipments')
  .option('--site-id <id>', 'Filter by site ID')
  .option('--limit <number>', 'Limit results')
  .option('--offset <number>', 'Offset for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params = parseQueryOptions(opts);
      if (opts.siteId) params.site_id = opts.siteId;
      const result = await client.shipments.list(params);
      print(result, getFormat(shipmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

shipmentsCmd.command('get <shipmentId>')
  .description('Get a shipment by ID')
  .action(async (shipmentId: string) => {
    try {
      const client = getClient();
      const result = await client.shipments.get(shipmentId);
      print(result, getFormat(shipmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Measurement command
const measurementCmd = program.command('measurement').description('Shipment measurements');

measurementCmd.command('get <shipmentId>')
  .description('Get computer-vision measurement for a shipment')
  .action(async (shipmentId: string) => {
    try {
      const client = getClient();
      const result = await client.shipments.getMeasurement(shipmentId);
      print(result, getFormat(measurementCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Cameras commands
const camerasCmd = program.command('cameras').description('Manage warehouse cameras');

camerasCmd.command('list')
  .description('List warehouse CCTV cameras')
  .option('--site-id <id>', 'Filter by site ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params = parseQueryOptions(opts);
      if (opts.siteId) params.site_id = opts.siteId;
      const result = await client.cameras.list(params);
      print(result, getFormat(camerasCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Measurements sync command
const measurementsCmd = program.command('measurements').description('Measurement sync operations');

measurementsCmd.command('sync')
  .description('Sync shipment measurements from cameras')
  .option('--body <json>', 'JSON request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : {};
      const result = await client.measurements.sync(body);
      success('Measurements sync initiated');
      print(result, getFormat(measurementsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request command
program.command('raw-request')
  .description('Call any Transload API path')
  .requiredOption('--path <path>', 'API path (e.g. /sites)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params = opts.query ? JSON.parse(opts.query) : undefined;
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const method = (opts.method || 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      const result = await client.rawRequest(opts.path, { method, params, body });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
