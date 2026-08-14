#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { StripeApps } from '../api';
import { StripeAppsApiError } from '../types';
import type { HttpMethod, RawRequestOptions } from '../types';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  clearConfig,
  getConfigDir,
  getBaseConfigDir,
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

const CONNECTOR_NAME = 'connect-stripeapps';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Apps API CLI - items, events, search, and raw requests')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-b, --base-url <url>', 'Base URL (overrides config)')
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
      process.env.STRIPEAPPS_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.STRIPEAPPS_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let parent: Command | null = cmd;
  while (parent) {
    const fmt = parent.opts().format;
    if (fmt) return fmt as OutputFormat;
    parent = parent.parent;
  }
  return 'pretty';
}

function getClient(): StripeApps {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPEAPPS_API_KEY environment variable.`);
    process.exit(1);
  }
  return new StripeApps({ apiKey, baseUrl: getBaseUrl() });
}

function handleError(err: unknown): never {
  if (err instanceof StripeAppsApiError) {
    error(`API error (${err.statusCode}): ${err.message}`);
  } else if (err instanceof Error) {
    error(err.message);
  } else {
    error(String(err));
  }
  process.exit(1);
}

function parseIntOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) {
    error(`Invalid number: ${value}`);
    process.exit(1);
  }
  return n;
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    error(`Invalid JSON for ${label}: ${(e as Error).message}`);
    process.exit(1);
  }
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

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
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'Base URL')
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

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set a custom API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    console.log();
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);
    console.log();
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.stripeapps.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Item Commands
// ============================================
program
  .command('list-items')
  .description('List items (GET /items)')
  .option('-n, --limit <number>', 'Maximum number of items to return')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.items.list({
        limit: parseIntOption(opts.limit),
        cursor: opts.cursor,
        status: opts.status,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('create-item')
  .description('Create an item (POST /items)')
  .option('--name <name>', 'Item name')
  .option('--description <description>', 'Item description')
  .option('--metadata <json>', 'Metadata as a JSON object')
  .option('--data <json>', 'Full request body as a JSON object (overrides other flags)')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.data, '--data') ?? {};
      if (opts.name !== undefined) body.name = opts.name;
      if (opts.description !== undefined) body.description = opts.description;
      const metadata = parseJsonOption(opts.metadata, '--metadata');
      if (metadata) body.metadata = metadata;

      if (Object.keys(body).length === 0) {
        error('Provide at least one field via --name, --description, --metadata, or --data');
        process.exit(1);
      }

      const result = await client.items.create(body);
      print(result, getFormat(cmd));
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('get-item <itemId>')
  .description('Fetch a single item (GET /items/{itemId})')
  .action(async (itemId: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.items.get(itemId);
      print(result, getFormat(cmd));
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// Event Commands
// ============================================
program
  .command('list-events')
  .description('List events (GET /events)')
  .option('-n, --limit <number>', 'Maximum number of events to return')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .option('-t, --type <type>', 'Filter by event type')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.events.list({
        limit: parseIntOption(opts.limit),
        cursor: opts.cursor,
        type: opts.type,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// Search Command
// ============================================
program
  .command('search <query>')
  .description('Search (POST /search)')
  .option('-n, --limit <number>', 'Maximum number of results to return')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .option('--filters <json>', 'Filters as a JSON object')
  .action(async (query: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.search.search({
        query,
        limit: parseIntOption(opts.limit),
        cursor: opts.cursor,
        filters: parseJsonOption(opts.filters, '--filters'),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// Raw Request Command
// ============================================
program
  .command('raw-request <path>')
  .description('Perform a raw request against any endpoint')
  .option('-X, --method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)', 'GET')
  .option('-d, --data <json>', 'Request body as JSON')
  .option('-q, --query <json>', 'Query parameters as a JSON object')
  .action(async (path: string, opts, cmd) => {
    try {
      const client = getClient();
      const method = String(opts.method).toUpperCase() as HttpMethod;
      const options: RawRequestOptions = { path, method };

      if (opts.data !== undefined) {
        try {
          options.body = JSON.parse(opts.data);
        } catch {
          options.body = opts.data; // allow raw string bodies
        }
      }

      const query = parseJsonOption(opts.query, '--query');
      if (query) {
        options.params = query as Record<string, string | number | boolean | undefined>;
      }

      const result = await client.raw(options);
      print(result, getFormat(cmd));
    } catch (err) {
      handleError(err);
    }
  });

program.parseAsync(process.argv).catch(handleError);
