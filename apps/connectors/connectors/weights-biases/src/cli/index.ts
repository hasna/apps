#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { WeightsBiases } from '../api';
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

const CONNECTOR_NAME = 'weights-biases';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Weights & Biases API connector CLI')
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
      process.env.WANDB_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WeightsBiases {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WANDB_API_KEY.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new WeightsBiases({ apiKey, baseUrl });
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
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
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
  info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.wandb.ai/v1)')}`);
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
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${baseUrl || 'https://api.wandb.ai/v1'}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const runsCmd = program.command('runs').description('Manage experiment runs');

runsCmd
  .command('list')
  .description('List runs')
  .option('--entity <entity>', 'Entity (team or user)')
  .option('--project <project>', 'Project name')
  .option('--order <order>', 'Sort order (e.g. +created_at)')
  .option('--per-page <n>', 'Results per page', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.runs.list({
        entity: opts.entity,
        project: opts.project,
        order: opts.order,
        perPage: parseInt(opts.perPage, 10),
      });
      print(result, getFormat(runsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

runsCmd.command('get <runId>').description('Get run by ID').action(async (runId: string) => {
  try {
    const client = getClient();
    const result = await client.runs.get(runId);
    print(result, getFormat(runsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

runsCmd
  .command('create')
  .description('Create a run')
  .option('--body <json>', 'Run payload JSON')
  .option('--entity <entity>', 'Entity')
  .option('--project <project>', 'Project')
  .option('--name <name>', 'Run name')
  .option('--display-name <displayName>', 'Display name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? JSON.parse(opts.body)
        : {
            entity: opts.entity,
            project: opts.project,
            name: opts.name,
            displayName: opts.displayName,
          };
      const result = await client.runs.create(body);
      print(result, getFormat(runsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('List experiment events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--entity <entity>', 'Entity')
  .option('--project <project>', 'Project')
  .option('--run-id <runId>', 'Run ID')
  .option('--per-page <n>', 'Results per page', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.events.list({
        entity: opts.entity,
        project: opts.project,
        runId: opts.runId,
        perPage: parseInt(opts.perPage, 10),
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search runs and resources');

searchCmd
  .command('query')
  .description('Search with a JSON body')
  .requiredOption('--body <json>', 'Search payload JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = JSON.parse(opts.body);
      const result = await client.search.search(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('request <path>')
  .description('Raw API request passthrough')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query params JSON')
  .option('--body <json>', 'Request body JSON')
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const params = opts.query ? JSON.parse(opts.query) : undefined;
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.rawRequest(path, {
        method: opts.method.toUpperCase(),
        params,
        body,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
