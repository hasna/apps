#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Usebidflow } from '../api';
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

const CONNECTOR_NAME = 'connect-usebidflow';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Bidflow Platform API connector CLI - manage bids, events, and marketplace search')
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
      process.env.USEBIDFLOW_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  const format = parent?.opts().format || 'pretty';
  return format === 'json' ? 'json' : 'pretty';
}

function getClient(): Usebidflow {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set USEBIDFLOW_API_KEY.`);
    process.exit(1);
  }
  return new Usebidflow({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.usebidflow.com/v1)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const bidsCmd = program.command('bids').description('Bid operations');

bidsCmd
  .command('list')
  .description('List bids')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | undefined> = {};
      if (opts.page) params.page = Number(opts.page);
      if (opts.limit) params.limit = Number(opts.limit);
      print(await client.bids.list(params), getFormat(bidsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bidsCmd.command('get <bidId>').description('Get a bid by ID').action(async (bidId: string) => {
  try {
    const client = getClient();
    print(await client.bids.get(bidId), getFormat(bidsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

bidsCmd
  .command('create')
  .description('Create a bid')
  .option('--data <json>', 'Bid payload as JSON object')
  .option('--file <path>', 'Path to JSON file with bid payload')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.file) {
        body = parseJsonOption(readFileSync(opts.file, 'utf-8'), '--file');
      } else if (opts.data) {
        body = parseJsonOption(opts.data, '--data');
      } else {
        error('Provide --data or --file with bid payload');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.bids.create(body);
      success('Bid created');
      print(result, getFormat(bidsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Event operations');

eventsCmd
  .command('list')
  .description('List events')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | undefined> = {};
      if (opts.page) params.page = Number(opts.page);
      if (opts.limit) params.limit = Number(opts.limit);
      print(await client.events.list(params), getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search the Bidflow marketplace')
  .option('--data <json>', 'Search payload as JSON object')
  .option('--query <text>', 'Shortcut: set query field in search payload')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.data) {
        body = parseJsonOption(opts.data, '--data');
      } else if (opts.query) {
        body = { query: opts.query };
      } else {
        error('Provide --data or --query');
        process.exit(1);
      }
      const client = getClient();
      print(await client.events.search(body), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Send a raw API request');

rawCmd
  .requiredOption('--path <path>', 'API path (e.g. /bids)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--data <json>', 'Request body as JSON object')
  .option('--file <path>', 'Path to JSON file with request body')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> | undefined;
      if (opts.file) {
        body = parseJsonOption(readFileSync(opts.file, 'utf-8'), '--file');
      } else if (opts.data) {
        body = parseJsonOption(opts.data, '--data');
      }
      const client = getClient();
      print(
        await client.rawRequest({
          method: opts.method,
          path: opts.path,
          body,
        }),
        getFormat(rawCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
