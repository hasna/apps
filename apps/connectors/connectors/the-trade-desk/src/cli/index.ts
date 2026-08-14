#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { createConnector } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
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
  formatCredentialStatus,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug, parseQueryPairs, parseJsonBody } from '../utils/output';
import type { HttpMethod } from '../types';

const CONNECTOR_NAME = 'connect-the-trade-desk';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('The Trade Desk programmatic advertising API connector')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
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
      process.env.THE_TRADE_DESK_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient() {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set THE_TRADE_DESK_API_KEY.`);
    process.exit(1);
  }
  return createConnector({ apiKey, baseUrl: getBaseUrl() });
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
  for (const p of profiles) {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  }
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
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
  info(`API Key: ${formatCredentialStatus(config.apiKey)}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
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
  info(`API Key: ${formatCredentialStatus(apiKey)}`);
  info(`Base URL: ${getBaseUrl()}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Campaign commands
const campaignsCmd = program.command('campaigns').description('Manage campaigns');

campaignsCmd
  .command('list')
  .description('List campaigns')
  .option('--query <pair...>', 'Query parameters as key=value')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.campaigns.list(parseQueryPairs(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('get <campaignId>')
  .description('Get campaign by ID')
  .action(async (campaignId: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.campaigns.get(campaignId);
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('create')
  .description('Create a campaign')
  .option('--json <body>', 'JSON request body')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const body = parseJsonBody(opts.json);
      if (Object.keys(body).length === 0) {
        error('Provide --json with campaign payload');
        process.exit(1);
      }
      const result = await client.campaigns.create(body);
      success('Campaign created');
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Events commands
const eventsCmd = program.command('events').description('Manage events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--query <pair...>', 'Query parameters as key=value')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.events.list(parseQueryPairs(opts.query));
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Search command
program
  .command('search')
  .description('Search The Trade Desk platform')
  .option('--json <body>', 'JSON search request body')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const body = parseJsonBody(opts.json);
      if (Object.keys(body).length === 0) {
        error('Provide --json with search payload');
        process.exit(1);
      }
      const result = await client.search.search(body);
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request
program
  .command('raw-request')
  .description('Send an arbitrary API request')
  .argument('<method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)')
  .argument('<path>', 'API path (e.g. /campaigns)')
  .option('--query <pair...>', 'Query parameters as key=value')
  .option('--json <body>', 'JSON request body for POST/PUT/PATCH')
  .action(async (method: string, path: string, opts, cmd) => {
    try {
      const normalizedMethod = method.toUpperCase() as HttpMethod;
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) {
        error(`Unsupported method: ${method}`);
        process.exit(1);
      }
      const client = getClient();
      const body = ['POST', 'PUT', 'PATCH'].includes(normalizedMethod) ? parseJsonBody(opts.json) : undefined;
      const result = await client.rawRequest({
        method: normalizedMethod,
        path,
        params: parseQueryPairs(opts.query),
        body: body && Object.keys(body).length > 0 ? body : undefined,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
