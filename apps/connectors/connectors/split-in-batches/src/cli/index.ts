#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  clearConfig,
  getConfigDir,
  getConnectorConfig,
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

const CONNECTOR_NAME = 'connect-split-in-batches';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Split In Batches connector CLI - batch workflow splitting and automation')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'API base URL (overrides config)')
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
      process.env.SPLIT_IN_BATCHES_API_KEY = opts.apiKey;
    }

    if (opts.baseUrl) {
      process.env.SPLIT_IN_BATCHES_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const config = getConnectorConfig();
  if (!config) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SPLIT_IN_BATCHES_API_KEY.`);
    process.exit(1);
  }
  return new Connector(config);
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
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
  .option('--base-url <url>', 'API base URL')
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
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.split-in-batches.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const batchesCmd = program.command('batches').description('Manage batches');

batchesCmd
  .command('list')
  .description('List batches')
  .option('--limit <n>', 'Maximum number of results')
  .option('--offset <n>', 'Pagination offset')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {};
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      if (opts.offset) params.offset = parseInt(opts.offset, 10);
      const result = await client.batches.list(params);
      print(result, getFormat(batchesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

batchesCmd
  .command('get <batchId>')
  .description('Get a batch by ID')
  .action(async (batchId: string) => {
    try {
      const client = getClient();
      const result = await client.batches.get(batchId);
      print(result, getFormat(batchesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

batchesCmd
  .command('create')
  .description('Create a new batch')
  .option('--json <json>', 'Batch payload as JSON object')
  .option('--json-file <path>', 'Path to JSON file with batch payload')
  .option('--name <name>', 'Batch name (shorthand)')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};

      if (opts.jsonFile) {
        body = JSON.parse(readFileSync(opts.jsonFile, 'utf-8'));
      } else if (opts.json) {
        body = parseJsonOption(opts.json, '--json');
      } else if (opts.name) {
        body = { name: opts.name };
      } else {
        error('Provide --json, --json-file, or --name');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.batches.create(body);
      success('Batch created');
      print(result, getFormat(batchesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('List batch events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--batch-id <id>', 'Filter by batch ID')
  .option('--limit <n>', 'Maximum number of results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {};
      if (opts.batchId) params.batch_id = opts.batchId;
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      const result = await client.events.list(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search batches and related resources')
  .option('--json <json>', 'Search payload as JSON object')
  .option('--query <query>', 'Search query (shorthand)')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};

      if (opts.json) {
        body = parseJsonOption(opts.json, '--json');
      } else if (opts.query) {
        body = { query: opts.query };
      } else {
        error('Provide --json or --query');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.search.search(body);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /batches)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        method: opts.method.toUpperCase(),
        path: opts.path,
        query: opts.query
          ? (parseJsonOption(opts.query, '--query') as Record<string, string | number | boolean | undefined>)
          : undefined,
        body: opts.body ? parseJsonOption(opts.body, '--body') : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
