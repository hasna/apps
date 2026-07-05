#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { UPS } from '../api';
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
  setBaseUrl,
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
import type { UPSHttpMethod } from '../types';

const CONNECTOR_NAME = 'connect-ups';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('UPS connector CLI — shipments, tracking events, and logistics')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key / bearer token (overrides config)')
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
      process.env.UPS_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): UPS {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set UPS_API_KEY.`);
    process.exit(1);
  }
  return new UPS({ apiKey, baseUrl: getBaseUrl() });
}

function readJsonBody(file?: string): Record<string, unknown> {
  if (!file) return {};
  const raw = readFileSync(file, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
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

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; baseUrl?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
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
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
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
  info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.ups.com/v1)')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key / bearer token').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.ups.com/v1)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const shipmentsCmd = program.command('shipments').description('Shipment operations');

shipmentsCmd.command('list').description('List shipments').action(async () => {
  try {
    const client = getClient();
    print(await client.listShipments(), getFormat(shipmentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

shipmentsCmd
  .command('get <shipmentId>')
  .description('Get a shipment by ID')
  .action(async (shipmentId: string) => {
    try {
      const client = getClient();
      print(await client.getShipment(shipmentId), getFormat(shipmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

shipmentsCmd
  .command('create')
  .description('Create a shipment')
  .option('-f, --file <path>', 'JSON request body file')
  .action(async (opts: { file?: string }) => {
    try {
      const client = getClient();
      const body = readJsonBody(opts.file);
      const result = await client.createShipment(body);
      success('Shipment created');
      print(result, getFormat(shipmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Tracking event operations');

eventsCmd.command('list').description('List tracking events').action(async () => {
  try {
    const client = getClient();
    print(await client.listEvents(), getFormat(eventsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program
  .command('search')
  .description('Search shipments or tracking data')
  .option('-f, --file <path>', 'JSON search request body file')
  .action(async (opts: { file?: string }) => {
    try {
      const client = getClient();
      const body = readJsonBody(opts.file);
      print(await client.search(body), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send an arbitrary API request')
  .requiredOption('-p, --path <path>', 'Request path (e.g. /shipments)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-f, --file <path>', 'JSON request body file')
  .action(async (opts: { path: string; method: string; file?: string }) => {
    try {
      const client = getClient();
      const method = opts.method.toUpperCase() as UPSHttpMethod;
      const body = opts.file ? readJsonBody(opts.file) : undefined;
      print(
        await client.rawRequest({ path: opts.path, method, body }),
        getFormat(program),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
