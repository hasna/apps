#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { TravoRealEstate } from '../api';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-travo-real-estate';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Travo Data connector CLI — real estate listings, events, and search')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.TRAVO_REAL_ESTATE_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TravoRealEstate {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRAVO_REAL_ESTATE_API_KEY.`);
    process.exit(1);
  }
  return new TravoRealEstate({ apiKey, baseUrl: getBaseUrl() });
}

function parseQueryFlags(opts: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && !['format', 'profile', 'apiKey', 'body', 'bodyFile'].includes(key)) {
      params[key] = String(value);
    }
  }
  return params;
}

function readBody(opts: { body?: string; bodyFile?: string }): Record<string, unknown> {
  if (opts.bodyFile) {
    return JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
  }
  if (opts.body) {
    return JSON.parse(opts.body);
  }
  throw new Error('Provide --body <json> or --body-file <path>');
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
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

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
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
  .action((name: string, opts) => {
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

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
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

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <baseUrl>')
  .description('Set API base URL')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl()}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const listingsCmd = program.command('listings').description('Listing operations');

listingsCmd
  .command('list')
  .description('List listings')
  .allowUnknownOption()
  .action(async function (this: Command) {
    const client = getClient();
    const params = parseQueryFlags(this.parent?.opts() || {});
    const result = await client.listListings(params);
    print(result, getFormat(this));
  });

listingsCmd
  .command('get <listingId>')
  .description('Get a listing by ID')
  .action(async (listingId: string, _opts, cmd) => {
    const client = getClient();
    const result = await client.getListing(listingId);
    print(result, getFormat(cmd));
  });

listingsCmd
  .command('create')
  .description('Create a listing')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts, cmd) => {
    const client = getClient();
    const body = readBody(opts);
    const result = await client.createListing(body);
    print(result, getFormat(cmd));
  });

const eventsCmd = program.command('events').description('Event operations');

eventsCmd
  .command('list')
  .description('List events')
  .allowUnknownOption()
  .action(async function (this: Command) {
    const client = getClient();
    const params = parseQueryFlags(this.parent?.opts() || {});
    const result = await client.listEvents(params);
    print(result, getFormat(this));
  });

program
  .command('search')
  .description('Search listings and data')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts, cmd) => {
    const client = getClient();
    const body = readBody(opts);
    const result = await client.search(body);
    print(result, getFormat(cmd));
  });

program
  .command('raw <method> <path>')
  .description('Send a raw API request')
  .option('--query <json>', 'JSON query parameters object')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (method: string, path: string, opts, cmd) => {
    const client = getClient();
    const query = opts.query ? JSON.parse(opts.query) : undefined;
    let body: Record<string, unknown> | undefined;
    if (opts.body || opts.bodyFile) {
      body = readBody(opts);
    }
    const result = await client.rawRequest({
      method: method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
      path,
      query,
      body,
    });
    print(result, getFormat(cmd));
  });

program.parse();
