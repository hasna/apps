#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
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
import { parseOptionalIntegerOption } from '../utils/parse';

const CONNECTOR_NAME = 'connect-zapier-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zapier API Platform connector - items, events, search, and raw requests')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (_thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals();

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
      process.env.ZAPIER_API_PLATFORM_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  return (cmd.optsWithGlobals().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ZAPIER_API_PLATFORM_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({
    apiKey,
    baseUrl: process.env.ZAPIER_API_PLATFORM_BASE_URL,
  });
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
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${process.env.ZAPIER_API_PLATFORM_BASE_URL || chalk.gray('default (https://api.zapierapiplatform.com/v1)')}`);
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
  .option('--limit <number>', 'Maximum items to return')
  .option('--offset <number>', 'Offset for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      params.limit = parseOptionalIntegerOption(opts.limit, '--limit');
      params.offset = parseOptionalIntegerOption(opts.offset, '--offset');
      const result = await client.items.list(params);
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('get <itemId>')
  .description('Get a specific item by ID')
  .action(async (itemId: string) => {
    try {
      const client = getClient();
      const result = await client.items.get(itemId);
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('create')
  .description('Create a new item')
  .requiredOption('-d, --data <json>', 'Item data as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data = JSON.parse(opts.data);
      const result = await client.items.create(data);
      success('Item created!');
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('List platform events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--limit <number>', 'Maximum events to return')
  .option('--offset <number>', 'Offset for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      params.limit = parseOptionalIntegerOption(opts.limit, '--limit');
      params.offset = parseOptionalIntegerOption(opts.offset, '--offset');
      const result = await client.events.list(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search the platform');

searchCmd
  .command('run')
  .description('Run a search query')
  .requiredOption('-d, --data <json>', 'Search payload as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data = JSON.parse(opts.data);
      const result = await client.search.search(data);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Send a raw HTTP request');

rawCmd
  .command('request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'Request path (e.g. /items)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('-d, --data <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.raw.request({
        method: opts.method.toUpperCase(),
        path: opts.path,
        body: opts.data ? JSON.parse(opts.data) : undefined,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

if (import.meta.main) {
  program.parse();
}
