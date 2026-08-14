#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-tettra-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tettra Api Platform connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .option('--base-url <url>', 'Override API base URL')
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
      process.env.TETTRA_API_PLATFORM_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.baseUrl) {
      process.env.TETTRA_API_PLATFORM_BASE_URL = opts.baseUrl;
      debug(`Base URL set to: ${opts.baseUrl}`);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TETTRA_API_PLATFORM_API_KEY.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: getBaseUrl() });
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
    profiles.forEach((p) => {
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
  .action((name: string, opts: { apiKey?: string; baseUrl?: string; use?: boolean }) => {
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
  .command('set-key <key>')
  .description('Set API key')
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL')
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
    info(`Base URL: ${baseUrl || chalk.gray('https://api.tettraapiplatform.com/v1 (default)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const itemsCmd = program.command('items').description('Manage items');

itemsCmd
  .command('list')
  .description('List items')
  .option('--limit <n>', 'Limit results')
  .option('--offset <n>', 'Offset for pagination')
  .action(async (opts, cmd) => {
    const client = getClient();
    const params: Record<string, string | number | undefined> = {};
    if (opts.limit) params.limit = Number(opts.limit);
    if (opts.offset) params.offset = Number(opts.offset);
    const result = await client.items.list(params);
    print(result, getFormat(cmd));
  });

itemsCmd
  .command('get <itemId>')
  .description('Get an item by ID')
  .action(async (itemId: string, _opts, cmd) => {
    const client = getClient();
    const result = await client.items.get(itemId);
    print(result, getFormat(cmd));
  });

itemsCmd
  .command('create')
  .description('Create an item')
  .requiredOption('--body <json>', 'JSON body for the new item')
  .action(async (opts, cmd) => {
    const client = getClient();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(opts.body);
    } catch {
      error('Invalid JSON body');
      process.exit(1);
    }
    const result = await client.items.create(body);
    print(result, getFormat(cmd));
  });

const eventsCmd = program.command('events').description('Manage events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--limit <n>', 'Limit results')
  .option('--offset <n>', 'Offset for pagination')
  .action(async (opts, cmd) => {
    const client = getClient();
    const params: Record<string, string | number | undefined> = {};
    if (opts.limit) params.limit = Number(opts.limit);
    if (opts.offset) params.offset = Number(opts.offset);
    const result = await client.events.list(params);
    print(result, getFormat(cmd));
  });

program
  .command('search <query>')
  .description('Search the platform')
  .action(async (query: string, _opts, cmd) => {
    const client = getClient();
    const result = await client.search.search({ query });
    print(result, getFormat(cmd));
  });

program
  .command('raw <method> <path>')
  .description('Make a raw API request')
  .option('--body <json>', 'JSON request body')
  .action(async (method: string, path: string, opts, cmd) => {
    const client = getClient();
    const upperMethod = method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    let body: unknown;
    if (opts.body) {
      try {
        body = JSON.parse(opts.body);
      } catch {
        error('Invalid JSON body');
        process.exit(1);
      }
    }
    const result = await client.raw.request({
      method: upperMethod,
      path,
      body,
    });
    print(result, getFormat(cmd));
  });

program.parse();
