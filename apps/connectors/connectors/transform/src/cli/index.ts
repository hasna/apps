#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Transform } from '../api';
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

const CONNECTOR_NAME = 'connect-transform';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Transform API connector CLI - data transform platform for pipelines and events')
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
      process.env.TRANSFORM_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Transform {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRANSFORM_API_KEY.`);
    process.exit(1);
  }

  const baseUrl = getBaseUrl();
  return new Transform({ apiKey, baseUrl });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
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
    for (const p of profiles) {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    }
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
  .action((name: string, opts: { apiKey?: string; baseUrl?: string; use?: boolean }) => {
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.transform.com/v1)')}`);
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
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.transform.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const pipelinesCmd = program.command('pipelines').description('Manage transform pipelines');

pipelinesCmd
  .command('list')
  .description('List pipelines')
  .option('--limit <number>', 'Maximum results')
  .action(async (opts: { limit?: string }) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.limit) params.limit = Number(opts.limit);
      const result = await client.pipelines.list(params);
      print(result, getFormat(pipelinesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pipelinesCmd
  .command('get <pipelineId>')
  .description('Get a pipeline by ID')
  .action(async (pipelineId: string) => {
    try {
      const client = getClient();
      const result = await client.pipelines.get(pipelineId);
      print(result, getFormat(pipelinesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pipelinesCmd
  .command('create')
  .description('Create a pipeline')
  .option('-n, --name <name>', 'Pipeline name')
  .option('-d, --description <description>', 'Pipeline description')
  .option('--body <json>', 'Full request body as JSON')
  .action(async (opts: { name?: string; description?: string; body?: string }) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonOption(opts.body, '--body')
        : {
            ...(opts.name ? { name: opts.name } : {}),
            ...(opts.description ? { description: opts.description } : {}),
          };

      if (!opts.body && !opts.name) {
        error('Provide --name or --body JSON');
        process.exit(1);
      }

      const result = await client.pipelines.create(body);
      success('Pipeline created');
      print(result, getFormat(pipelinesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('List transform events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--pipeline-id <id>', 'Filter by pipeline ID')
  .option('--limit <number>', 'Maximum results')
  .action(async (opts: { pipelineId?: string; limit?: string }) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.pipelineId) params.pipeline_id = opts.pipelineId;
      if (opts.limit) params.limit = Number(opts.limit);
      const result = await client.events.list(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search transform data');

searchCmd
  .command('query')
  .description('Run a search query')
  .option('-q, --query <text>', 'Search query text')
  .option('--body <json>', 'Full search request body as JSON')
  .action(async (opts: { query?: string; body?: string }) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonOption(opts.body, '--body')
        : opts.query
          ? { query: opts.query }
          : null;

      if (!body) {
        error('Provide --query or --body JSON');
        process.exit(1);
      }

      const result = await client.search.search(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Execute a raw API request');

rawCmd
  .command('request')
  .description('Send an arbitrary HTTP request to the Transform API')
  .requiredOption('-m, --method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)')
  .requiredOption('-p, --path <path>', 'API path (e.g. /pipelines)')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON')
  .option('--body-file <file>', 'Request body from JSON file')
  .action(async (opts: { method: string; path: string; query?: string; body?: string; bodyFile?: string }) => {
    try {
      const client = getClient();
      const method = opts.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      const query = opts.query ? parseJsonOption(opts.query, '--query') : undefined;

      let body: Record<string, unknown> | undefined;
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8')) as Record<string, unknown>;
      } else if (opts.body) {
        body = parseJsonOption(opts.body, '--body');
      }

      const result = await client.raw.request({
        method,
        path: opts.path,
        query: query as Record<string, string | number | boolean | undefined> | undefined,
        body,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
