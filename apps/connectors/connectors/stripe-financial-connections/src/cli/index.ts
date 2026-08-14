#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { StripeFinancialConnections } from '../api';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-stripe-financial-connections';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Financial Connections connector - Banking data and account linking')
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
      process.env.STRIPE_FINANCIAL_CONNECTIONS_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): StripeFinancialConnections {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_FINANCIAL_CONNECTIONS_API_KEY.`);
    process.exit(1);
  }
  return new StripeFinancialConnections({ apiKey, baseUrl: getBaseUrl() });
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

// Profile commands
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

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
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
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.stripefinancialconnections.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Items commands
const itemsCmd = program.command('items').description('Financial connection item operations');

itemsCmd
  .command('list')
  .description('List financial connection items')
  .option('--limit <n>', 'Limit results')
  .option('--starting-after <id>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      if (opts.startingAfter) params.starting_after = opts.startingAfter;
      const result = await client.listItems(params);
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('create')
  .description('Create a financial connection item')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body') || {};
      const result = await client.createItem(body);
      success('Item created');
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('get <itemId>')
  .description('Get a financial connection item by ID')
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

// Events commands
const eventsCmd = program.command('events').description('Financial connection event operations');

eventsCmd
  .command('list')
  .description('List financial connection events')
  .option('--limit <n>', 'Limit results')
  .option('--starting-after <id>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      if (opts.startingAfter) params.starting_after = opts.startingAfter;
      const result = await client.listEvents(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Search command
program
  .command('search')
  .description('Search financial connection data')
  .option('--body <json>', 'Search request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body') || {};
      const result = await client.search(body);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request command
program
  .command('raw')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /items)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        method: opts.method,
        path: opts.path,
        query: parseJsonOption(opts.query, '--query'),
        body: parseJsonOption(opts.body, '--body'),
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
