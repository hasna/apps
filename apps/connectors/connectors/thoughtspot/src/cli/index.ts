#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { ThoughtSpot } from '../api';
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getApiKey,
  getBaseUrl,
  getConfigDir,
  getCurrentProfile,
  listProfiles,
  loadProfile,
  profileExists,
  setApiKey,
  setBaseUrl,
  setCurrentProfile,
  setProfileOverride,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { debug, error, info, print, setVerboseMode, success } from '../utils/output';

const CONNECTOR_NAME = 'connect-thoughtspot';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('ThoughtSpot REST API v2 connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Bearer token (overrides config)')
  .option('-u, --base-url <url>', 'API base URL (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerboseMode(true);
    }
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.THOUGHTSPOT_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.THOUGHTSPOT_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function readJsonFile(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    error(`Failed to read JSON file ${path}: ${String(err)}`);
    process.exit(1);
  }
}

function getClient(): ThoughtSpot {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <token>" or set THOUGHTSPOT_API_KEY.`);
    process.exit(1);
  }
  if (!baseUrl) {
    error(`No base URL configured. Run "${CONNECTOR_NAME} config set-base-url <url>" or set THOUGHTSPOT_BASE_URL.`);
    process.exit(1);
  }
  return new ThoughtSpot({ apiKey, baseUrl });
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();
    if (profiles.length === 0) {
      info('No profiles found.');
      return;
    }
    success('Profiles:');
    for (const p of profiles) {
      const active = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${active}`);
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
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
  .option('--api-key <key>', 'Bearer token')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (!deleteProfile(name)) {
      error(`Could not delete profile "${name}"`);
      process.exit(1);
    }
    success(`Profile "${name}" deleted`);
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    console.log(chalk.bold(`Profile: ${profileName}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set bearer token for active profile')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set ThoughtSpot REST API v2 base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${getApiKey() ? `${getApiKey()!.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Liveboards commands
const liveboardsCmd = program.command('liveboards').description('Liveboard operations');

liveboardsCmd
  .command('list')
  .description('List liveboards')
  .option('--body <json>', 'Additional search body JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body');
      const result = await client.liveboards.list(body);
      print(result, getFormat(liveboardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

liveboardsCmd
  .command('get <liveboardId>')
  .description('Get a liveboard by ID or name')
  .option('--body <json>', 'Additional search body JSON')
  .action(async (liveboardId: string, opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body');
      const result = await client.liveboards.get(liveboardId, body);
      print(result, getFormat(liveboardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

liveboardsCmd
  .command('create')
  .description('Create/import a liveboard via TML import')
  .option('--body <json>', 'TML import request JSON')
  .option('--file <path>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      const body = opts.file ? readJsonFile(opts.file) : parseJsonOption(opts.body, '--body');
      if (!body) {
        error('Provide --body or --file with TML import payload');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.liveboards.create(body);
      print(result, getFormat(liveboardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

liveboardsCmd
  .command('data <liveboardId>')
  .description('Fetch liveboard visualization data')
  .option('--body <json>', 'Additional request body JSON')
  .action(async (liveboardId: string, opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body') || {};
      const result = await client.liveboards.data(liveboardId, body);
      print(result, getFormat(liveboardsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Events commands
const eventsCmd = program.command('events').description('Audit log operations');

eventsCmd
  .command('list')
  .description('Fetch security audit logs')
  .option('--body <json>', 'Request body JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body') || {};
      const result = await client.events.list(body);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Search commands
const searchCmd = program.command('search').description('Search metadata and analytics');

searchCmd
  .command('metadata')
  .description('Search metadata objects')
  .requiredOption('--body <json>', 'Metadata search request JSON')
  .action(async (opts) => {
    try {
      const body = parseJsonOption(opts.body, '--body');
      if (!body) process.exit(1);
      const client = getClient();
      const result = await client.search.metadata(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('data')
  .description('Run analytics search query')
  .requiredOption('--body <json>', 'Search data request JSON')
  .action(async (opts) => {
    try {
      const body = parseJsonOption(opts.body, '--body');
      if (!body) process.exit(1);
      const client = getClient();
      const result = await client.search.data(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('run')
  .description('Auto-route search to metadata or searchdata')
  .requiredOption('--body <json>', 'Search request JSON')
  .action(async (opts) => {
    try {
      const body = parseJsonOption(opts.body, '--body');
      if (!body) process.exit(1);
      const client = getClient();
      const result = await client.search.search(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request
program
  .command('raw')
  .description('Send a raw API request')
  .requiredOption('-m, --method <method>', 'HTTP method')
  .requiredOption('-P, --path <path>', 'API path (e.g. /metadata/search)')
  .option('--query <json>', 'Query params JSON object')
  .option('--body <json>', 'Request body JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const method = opts.method.toUpperCase();
      const query = parseJsonOption(opts.query, '--query') as Record<string, string | number | boolean | undefined> | undefined;
      const body = parseJsonOption(opts.body, '--body');
      const result = await client.rawRequest({
        method,
        path: opts.path,
        query,
        body,
      });
      print(result, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
