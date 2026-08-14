#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Tipalti } from '../api';
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

const CONNECTOR_NAME = 'connect-tipalti';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tipalti connector - Global payments platform for payees, events, and AP automation')
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
      process.env.TIPALTI_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Tipalti {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TIPALTI_API_KEY.`);
    process.exit(1);
  }
  return new Tipalti({ apiKey, baseUrl: getBaseUrl() });
}

function parseQueryFlags(opts: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  const params: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && !['format', 'profile', 'apiKey', 'body', 'bodyFile'].includes(key)) {
      params[key] = value as string | number | boolean;
    }
  }
  return params;
}

function loadBody(opts: { body?: string; bodyFile?: string }): Record<string, unknown> | undefined {
  if (opts.bodyFile) {
    return JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
  }
  if (opts.body) {
    return JSON.parse(opts.body);
  }
  return undefined;
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all CLI profiles')
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
  .description('Switch to a CLI profile')
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
  .description('Create a new CLI profile')
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
  .description('Delete a CLI profile')
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
  .description('Show CLI profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.tipalti.com/v1)')}`);
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
  .command('set-url <baseUrl>')
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
    info(`Base URL: ${getBaseUrl() || 'https://api.tipalti.com/v1 (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const payeeCmd = program.command('payee').description('Manage payees');

payeeCmd
  .command('list')
  .description('List payees')
  .option('--page <n>', 'Page number')
  .option('--page-size <n>', 'Page size')
  .option('--status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listPayees(parseQueryFlags(opts));
      print(result, getFormat(payeeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

payeeCmd
  .command('get <payeeId>')
  .description('Get a payee by ID')
  .action(async (payeeId: string) => {
    try {
      const client = getClient();
      const result = await client.getPayee(payeeId);
      print(result, getFormat(payeeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

payeeCmd
  .command('create')
  .description('Create a payee')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'Path to JSON request body file')
  .option('--ref-code <code>', 'Payee reference code')
  .option('--email <email>', 'Payee email')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--company-name <name>', 'Company name')
  .option('--country <code>', 'Country code')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = loadBody(opts) || {
        refCode: opts.refCode,
        email: opts.email,
        firstName: opts.firstName,
        lastName: opts.lastName,
        companyName: opts.companyName,
        country: opts.country,
      };
      const result = await client.createPayee(body);
      success('Payee created');
      print(result, getFormat(payeeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('List Tipalti events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--page <n>', 'Page number')
  .option('--page-size <n>', 'Page size')
  .option('--type <type>', 'Filter by event type')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents(parseQueryFlags(opts));
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search Tipalti entities');

searchCmd
  .command('run')
  .description('Run a search query')
  .option('--body <json>', 'JSON search request body')
  .option('--body-file <path>', 'Path to JSON search request file')
  .option('--query <text>', 'Search query text')
  .option('--entity-type <type>', 'Entity type to search')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = loadBody(opts) || {
        query: opts.query,
        entityType: opts.entityType,
      };
      const result = await client.search(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Send a raw API request');

rawCmd
  .command('request')
  .description('Execute a raw Tipalti API request')
  .requiredOption('--path <path>', 'API path (e.g. /payees)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      const client = getClient();
      const query = opts.query ? JSON.parse(opts.query) : undefined;
      const body = loadBody(opts);
      const result = await client.rawRequest({
        method: opts.method,
        path: opts.path,
        query,
        body,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
