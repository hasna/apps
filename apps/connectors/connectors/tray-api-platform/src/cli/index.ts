#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
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
import type { JsonRecord, ListQueryParams } from '../types';

const CONNECTOR_NAME = 'connect-tray-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tray API Platform connector CLI - customer runtime API')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-b, --base-url <url>', 'Base URL override (tenant-specific runtime API)')
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
      process.env.TRAY_API_PLATFORM_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.baseUrl) {
      process.env.TRAY_API_PLATFORM_BASE_URL = opts.baseUrl;
      debug(`Base URL set from command line flag: ${opts.baseUrl}`);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRAY_API_PLATFORM_API_KEY.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new Connector({ apiKey, baseUrl });
}

function parseJsonOption(value: string, label: string): JsonRecord {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as JsonRecord;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function parseQueryOption(value: string): ListQueryParams {
  const parsed = parseJsonOption(value, '--query');
  const params: ListQueryParams = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      params[key] = val;
    }
  }
  return params;
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

    createProfile(name, {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
    });
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

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set base URL override')
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
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('https://api.trayapiplatform.com/v1 (default)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const itemsCmd = program.command('items').description('Manage runtime items');

itemsCmd
  .command('list')
  .description('List items')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params = opts.query ? parseQueryOption(opts.query) : undefined;
      const result = await client.items.list(params);
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('get <itemId>')
  .description('Get an item by ID')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (itemId: string, opts) => {
    try {
      const client = getClient();
      const params = opts.query ? parseQueryOption(opts.query) : undefined;
      const result = await client.items.get(itemId, params);
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('create')
  .description('Create an item')
  .requiredOption('--body <json>', 'Request body as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body');
      const result = await client.items.create(body);
      success('Item created');
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('List runtime events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params = opts.query ? parseQueryOption(opts.query) : undefined;
      const result = await client.events.list(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search runtime data');

searchCmd
  .command('run')
  .description('Run a search query')
  .requiredOption('--body <json>', 'Search request body as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body');
      const result = await client.search.search(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const requestCmd = program.command('request').description('Send a raw API request');

requestCmd
  .command('send')
  .description('Send a raw request to the runtime API')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .requiredOption('-p, --path <path>', 'API path (e.g. /items)')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON object')
  .option('--headers <json>', 'Extra headers as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        method: opts.method.toUpperCase(),
        path: opts.path,
        query: opts.query ? parseQueryOption(opts.query) : undefined,
        body: opts.body ? parseJsonOption(opts.body, '--body') : undefined,
        headers: opts.headers ? (parseJsonOption(opts.headers, '--headers') as Record<string, string>) : undefined,
      });
      print(result, getFormat(requestCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
