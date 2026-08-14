#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { VoxelEnergy } from '../api';
import type { CreateReservationRequest } from '../types';
import {
  getApiKey, setApiKey, getBaseUrl, setBaseUrl, clearConfig, getConfigDir, setProfileOverride,
  getCurrentProfile, setCurrentProfile, listProfiles, createProfile,
  deleteProfile, profileExists, loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-voxel-energy';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Voxel Energy connector CLI - Off-grid data center power, sites, and reservations')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): VoxelEnergy {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VOXEL_ENERGY_API_KEY`);
    process.exit(1);
  }
  return new VoxelEnergy({ apiKey, baseUrl: getBaseUrl() });
}

function parseQuery(query?: string): Record<string, string> | undefined {
  if (!query) return undefined;
  try {
    const parsed = JSON.parse(query) as Record<string, string>;
    return parsed;
  } catch {
    error('Query must be valid JSON object');
    process.exit(1);
  }
}

// Profile Commands
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) { info('No profiles found'); return; }
  profiles.forEach(p => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  });
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) { error(`Profile "${name}" does not exist`); process.exit(1); }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) { error(`Profile "${name}" already exists`); process.exit(1); }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    success(`Profile "${name}" created`);
    if (opts.use) { setCurrentProfile(name); info(`Switched to profile: ${name}`); }
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') { error('Cannot delete default profile'); process.exit(1); }
  if (deleteProfile(name)) { success(`Profile "${name}" deleted`); }
  else { error(`Profile "${name}" not found`); process.exit(1); }
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success('API key saved');
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success('Base URL saved');
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const apiKey = getApiKey();
  info(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.voxelenergy.com/v1)')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Site Commands
const sitesCmd = program.command('sites').description('Manage data center sites');

sitesCmd.command('list')
  .description('List sites')
  .option('-q, --query <json>', 'Query parameters as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSites(parseQuery(opts.query));
      print(result, getFormat(sitesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sitesCmd.command('get <siteId>')
  .description('Get site details')
  .action(async (siteId: string) => {
    try {
      const client = getClient();
      const result = await client.getSite(siteId);
      print(result, getFormat(sitesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sitesCmd.command('power-profile <siteId>')
  .description('Get site power profile')
  .action(async (siteId: string) => {
    try {
      const client = getClient();
      const result = await client.getSitePowerProfile(siteId);
      print(result, getFormat(sitesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sitesCmd.command('capacity <siteId>')
  .description('Get site capacity')
  .action(async (siteId: string) => {
    try {
      const client = getClient();
      const result = await client.getSiteCapacity(siteId);
      print(result, getFormat(sitesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Reservation Commands
const reservationsCmd = program.command('reservations').description('Manage GPU reservations');

reservationsCmd.command('list')
  .description('List reservations')
  .option('-q, --query <json>', 'Query parameters as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listReservations(parseQuery(opts.query));
      print(result, getFormat(reservationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reservationsCmd.command('get <reservationId>')
  .description('Get reservation details')
  .action(async (reservationId: string) => {
    try {
      const client = getClient();
      const result = await client.getReservation(reservationId);
      print(result, getFormat(reservationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reservationsCmd.command('create')
  .description('Create a reservation')
  .requiredOption('-b, --body <json>', 'Reservation body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = JSON.parse(opts.body) as CreateReservationRequest;
      const result = await client.createReservation(body);
      print(result, getFormat(reservationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw Request
program.command('raw')
  .description('Make a raw API request')
  .requiredOption('-p, --path <path>', 'API path (e.g. /sites)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-q, --query <json>', 'Query parameters as JSON')
  .option('-b, --body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const method = opts.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      const result = await client.rawRequest(opts.path, {
        method,
        params: parseQuery(opts.query),
        body: opts.body ? JSON.parse(opts.body) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
