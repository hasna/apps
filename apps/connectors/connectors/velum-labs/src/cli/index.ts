#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { VelumLabs } from '../api';
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

const CONNECTOR_NAME = 'connect-velum-labs';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Velum Labs connector CLI - Data lab platform for datasets, events, and search')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): VelumLabs {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VELUM_LABS_API_KEY`);
    process.exit(1);
  }
  return new VelumLabs({ apiKey, baseUrl: getBaseUrl() });
}

function parseQueryFlags(opts: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  const params: Record<string, string | number | boolean | undefined> = {};
  if (opts.limit !== undefined) params.limit = Number(opts.limit);
  if (opts.offset !== undefined) params.offset = Number(opts.offset);
  if (opts.type) params.type = String(opts.type);
  return params;
}

// Profile Commands
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) { info('No profiles found'); return; }
  profiles.forEach(p => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  });
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) { error(`Profile "${name}" does not exist`); process.exit(1); }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) { error(`Profile "${name}" already exists`); process.exit(1); }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    success(`Profile "${name}" created`);
    if (opts.use) { setCurrentProfile(name); info(`Switched to profile: ${name}`); }
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') { error('Cannot delete default profile'); process.exit(1); }
  if (deleteProfile(name)) { success(`Profile "${name}" deleted`); }
  else { error(`Profile "${name}" not found`); process.exit(1); }
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success('API key saved');
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success('Base URL saved');
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const apiKey = getApiKey();
  info(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.velum-labs.com/v1)')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Dataset Commands
const datasetsCmd = program.command('datasets').description('Manage datasets');

datasetsCmd.command('list')
  .description('List datasets')
  .option('--limit <n>', 'Limit results')
  .option('--offset <n>', 'Offset for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listDatasets(parseQueryFlags(opts));
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

datasetsCmd.command('get <datasetId>')
  .description('Get a dataset by ID')
  .action(async (datasetId: string) => {
    try {
      const client = getClient();
      const result = await client.getDataset(datasetId);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

datasetsCmd.command('create')
  .description('Create a dataset')
  .requiredOption('--name <name>', 'Dataset name')
  .option('--description <text>', 'Dataset description')
  .option('--body <json>', 'Full JSON body (overrides --name/--description)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? JSON.parse(opts.body)
        : { name: opts.name, ...(opts.description ? { description: opts.description } : {}) };
      const result = await client.createDataset(body);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Events Commands
program.command('events')
  .description('List events')
  .option('--limit <n>', 'Limit results')
  .option('--offset <n>', 'Offset for pagination')
  .option('--type <type>', 'Filter by event type')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents(parseQueryFlags(opts));
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Search Command
program.command('search <query>')
  .description('Search across datasets')
  .option('--dataset-id <id>', 'Limit search to a dataset')
  .option('--limit <n>', 'Limit results')
  .option('--offset <n>', 'Offset for pagination')
  .option('--body <json>', 'Full JSON search body (overrides positional query)')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? JSON.parse(opts.body)
        : {
            query,
            ...(opts.datasetId ? { dataset_id: opts.datasetId } : {}),
            ...(opts.limit ? { limit: Number(opts.limit) } : {}),
            ...(opts.offset ? { offset: Number(opts.offset) } : {}),
          };
      const result = await client.search(body);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw Request Command
program.command('raw-request')
  .description('Send an arbitrary API request')
  .requiredOption('--path <path>', 'API path (e.g. /datasets)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        method: opts.method.toUpperCase(),
        path: opts.path,
        query: opts.query ? JSON.parse(opts.query) : undefined,
        body: opts.body ? JSON.parse(opts.body) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
