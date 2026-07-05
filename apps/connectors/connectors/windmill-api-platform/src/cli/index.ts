#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { WindmillApiPlatform } from '../api';
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
import type { ItemRecord, SearchRequest } from '../types';

const CONNECTOR_NAME = 'connect-windmill-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Windmill Api Platform connector CLI - REST API integration with multi-profile support')
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
      process.env.WINDMILL_API_PLATFORM_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WindmillApiPlatform {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WINDMILL_API_PLATFORM_API_KEY.`);
    process.exit(1);
  }
  return new WindmillApiPlatform({ apiKey, baseUrl: getBaseUrl() });
}

function parseQueryPairs(pairs: string[] | undefined): Record<string, string> {
  const query: Record<string, string> = {};
  for (const pair of pairs || []) {
    const [key, ...rest] = pair.split('=');
    if (key) query[key] = rest.join('=');
  }
  return query;
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
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
  profiles.forEach(p => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.windmillapiplatform.com/v1)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Items commands
const itemsCmd = program.command('items').description('Item operations');

itemsCmd
  .command('list')
  .description('List items')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listItems(parseQueryPairs(opts.query));
      print(result, getFormat(itemsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemsCmd
  .command('create')
  .description('Create an item')
  .option('-b, --body <json>', 'Item JSON body')
  .option('-f, --file <path>', 'JSON file with item body')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.file) {
        body = JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>;
      } else {
        body = parseJsonOption(opts.body, 'body');
      }
      const client = getClient();
      const result = await client.createItem(body as ItemRecord);
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

// Events commands
const eventsCmd = program.command('events').description('Event operations');

eventsCmd
  .command('list')
  .description('List events')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents(parseQueryPairs(opts.query));
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Search command
program
  .command('search')
  .description('Search the API')
  .option('-b, --body <json>', 'Search request JSON body')
  .option('-f, --file <path>', 'JSON file with search body')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.file) {
        body = JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>;
      } else {
        body = parseJsonOption(opts.body, 'body');
      }
      const client = getClient();
      const result = await client.search(body as SearchRequest);
      print(result, program.opts().format as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request command
program
  .command('raw-request')
  .description('Send an arbitrary API request')
  .requiredOption('-p, --path <path>', 'API path (e.g. /items)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-b, --body <json>', 'Request JSON body')
  .option('-f, --file <path>', 'JSON file with request body')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts) => {
    try {
      let body: unknown;
      if (opts.file) {
        body = JSON.parse(readFileSync(opts.file, 'utf-8'));
      } else if (opts.body) {
        body = parseJsonOption(opts.body, 'body');
      }
      const client = getClient();
      const result = await client.rawRequest({
        method: opts.method,
        path: opts.path,
        body,
        query: parseQueryPairs(opts.query),
      });
      print(result, program.opts().format as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
