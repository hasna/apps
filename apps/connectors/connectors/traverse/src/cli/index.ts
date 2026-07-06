#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Traverse } from '../api';
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

const CONNECTOR_NAME = 'connect-traverse';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Traverse API connector - RL training environments, episodes, judgments, and datasets')
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
      process.env.TRAVERSE_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Traverse {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRAVERSE_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Traverse({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected object');
    }
    return parsed as Record<string, unknown>;
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
  info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.traverse.so/v1)')}`);
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
  const baseUrl = getBaseUrl();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${baseUrl || chalk.gray('https://api.traverse.so/v1')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Environments commands
const environmentsCmd = program.command('environments').alias('env').description('Environment operations');

environmentsCmd.command('list').description('List environments').action(async () => {
  try {
    const client = getClient();
    const result = await client.environments.list();
    print(result, getFormat(environmentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

environmentsCmd.command('get <id>').description('Get an environment by ID').action(async (id: string) => {
  try {
    const client = getClient();
    const result = await client.environments.get(id);
    print(result, getFormat(environmentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

environmentsCmd
  .command('create')
  .description('Create an environment')
  .option('--body <json>', 'JSON body for the environment')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body');
      const result = await client.environments.create(body);
      print(result, getFormat(environmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Episodes commands
const episodesCmd = program.command('episodes').description('Episode operations');

episodesCmd.command('list').description('List episodes').action(async () => {
  try {
    const client = getClient();
    const result = await client.episodes.list();
    print(result, getFormat(episodesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

episodesCmd.command('get <id>').description('Get an episode by ID').action(async (id: string) => {
  try {
    const client = getClient();
    const result = await client.episodes.get(id);
    print(result, getFormat(episodesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Judgments commands
const judgmentsCmd = program.command('judgments').description('Judgment operations');

judgmentsCmd
  .command('submit <episodeId>')
  .description('Submit a judgment for an episode')
  .option('--score <score>', 'Judgment score', parseFloat)
  .option('--body <json>', 'JSON body (merged with --score)')
  .action(async (episodeId: string, opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body');
      if (opts.score !== undefined) {
        body.score = opts.score;
      }
      const result = await client.episodes.submitJudgment(episodeId, body);
      print(result, getFormat(judgmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Datasets commands
const datasetsCmd = program.command('datasets').description('Dataset operations');

datasetsCmd.command('list').description('List datasets').action(async () => {
  try {
    const client = getClient();
    const result = await client.datasets.list();
    print(result, getFormat(datasetsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Raw request
program
  .command('raw-request')
  .description('Make a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /environments)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'JSON request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body ? parseJsonOption(opts.body, '--body') : undefined;
      const result = await client.rawRequest(opts.path, {
        method: opts.method,
        body,
      });
      print(result, program.opts().format as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
