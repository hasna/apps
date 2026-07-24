#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TwilioApiPlatform } from '../api';
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

const CONNECTOR_NAME = 'connect-twilio-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Twilio Api Platform REST API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'API base URL override')
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
      process.env.TWILIO_API_PLATFORM_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.baseUrl) {
      process.env.TWILIO_API_PLATFORM_BASE_URL = opts.baseUrl;
      debug(`Base URL set from command line flag: ${opts.baseUrl}`);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TwilioApiPlatform {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TWILIO_API_PLATFORM_API_KEY.`);
    process.exit(1);
  }
  return new TwilioApiPlatform({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid JSON for ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
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
    for (const p of profiles) {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    }
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
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || 'https://api.twilioapiplatform.com/v1 (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const itemsCmd = program.command('items').description('Manage platform items');

itemsCmd
  .command('list')
  .description('List items')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts: { query?: string }) => {
    try {
      const client = getClient();
      const params = opts.query ? parseJsonOption(opts.query, 'query') as Record<string, string | number | boolean | undefined> : undefined;
      const result = await client.listItems(params);
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('get <itemId>')
  .description('Get an item by ID')
  .action(async (itemId: string) => {
    try {
      const client = getClient();
      const result = await client.getItem(itemId);
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('create')
  .description('Create an item')
  .requiredOption('-b, --body <json>', 'Request body as JSON object')
  .action(async (opts: { body: string }) => {
    try {
      const client = getClient();
      const result = await client.createItem(parseJsonOption(opts.body, 'body'));
      success('Item created');
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Platform events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts: { query?: string }) => {
    try {
      const client = getClient();
      const params = opts.query ? parseJsonOption(opts.query, 'query') as Record<string, string | number | boolean | undefined> : undefined;
      const result = await client.listEvents(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search the platform')
  .requiredOption('-b, --body <json>', 'Search request body as JSON object')
  .action(async (opts: { body: string }) => {
    try {
      const client = getClient();
      const result = await client.search(parseJsonOption(opts.body, 'body'));
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw')
  .description('Send an arbitrary API request')
  .requiredOption('-P, --path <path>', 'API path (e.g. /items or /items/abc)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('-b, --body <json>', 'Request body as JSON')
  .option('-q, --query <json>', 'Query parameters as JSON object')
  .action(async (opts: { path: string; method: string; body?: string; query?: string }) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        body: opts.body ? parseJsonOption(opts.body, 'body') : undefined,
        params: opts.query ? parseJsonOption(opts.query, 'query') as Record<string, string | number | boolean | undefined> : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
