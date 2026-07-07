#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { SseTrigger } from '../api';
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

const CONNECTOR_NAME = 'connect-sse-trigger';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('SseTrigger connector CLI - SSE workflow triggers and event streams')
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
      process.env.SSE_TRIGGER_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): SseTrigger {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SSE_TRIGGER_API_KEY environment variable.`);
    process.exit(1);
  }
  return new SseTrigger({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> {
  if (!value) return {};
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

function parseQueryOption(value: string | undefined, label: string): Record<string, string | number | boolean | undefined> {
  const obj = parseJsonOption(value, label);
  const query: Record<string, string | number | boolean | undefined> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      query[key] = val;
    } else {
      query[key] = String(val);
    }
  }
  return query;
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

profileCmd.command('create <name>').description('Create a new profile')
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
  info(`Base URL: ${baseUrl || chalk.gray('default (https://api.sse-trigger.com/v1)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const streamsCmd = program.command('streams').description('Stream management commands');

streamsCmd.command('list').description('List streams')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listStreams(parseQueryOption(opts.query, 'query'));
      print(result, getFormat(streamsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

streamsCmd.command('create').description('Create a stream')
  .option('--body <json>', 'Stream payload as JSON object')
  .option('--body-file <path>', 'Read stream payload from JSON file')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else if (opts.body) {
        body = parseJsonOption(opts.body, 'body');
      }
      const client = getClient();
      const result = await client.createStream(body);
      print(result, getFormat(streamsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

streamsCmd.command('get <streamId>').description('Get a stream by ID').action(async (streamId: string) => {
  try {
    const client = getClient();
    const result = await client.getStream(streamId);
    print(result, getFormat(streamsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const eventsCmd = program.command('events').description('Event commands');

eventsCmd.command('list').description('List events')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents(parseQueryOption(opts.query, 'query'));
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search events');

searchCmd.command('run').description('Run a search query')
  .option('--body <json>', 'Search payload as JSON object')
  .option('--body-file <path>', 'Read search payload from JSON file')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else if (opts.body) {
        body = parseJsonOption(opts.body, 'body');
      }
      const client = getClient();
      const result = await client.searchEvents(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Send an arbitrary API request');

rawCmd.command('request').description('Call any API path')
  .requiredOption('--path <path>', 'API path (e.g. /streams)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON object')
  .option('--body-file <path>', 'Read request body from JSON file')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> | undefined;
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else if (opts.body) {
        body = parseJsonOption(opts.body, 'body');
      }
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method.toUpperCase(),
        query: parseQueryOption(opts.query, 'query'),
        body,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
