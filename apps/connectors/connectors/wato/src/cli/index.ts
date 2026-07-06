#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Wato } from '../api';
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'wato';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wato API connector — shared agent memories, workflows, tools, and artifacts')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.WATO_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    error(`Invalid ${label} JSON`);
    process.exit(1);
  }
}

function parseQueryOption(value: string | undefined): Record<string, string | number | boolean | undefined> | undefined {
  const parsed = parseJsonOption(value, 'query');
  if (!parsed) return undefined;
  const query: Record<string, string | number | boolean | undefined> = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      query[key] = val;
    } else {
      query[key] = JSON.stringify(val);
    }
  }
  return query;
}

function getClient(): Wato {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WATO_API_KEY.`);
    process.exit(1);
  }
  return new Wato({ apiKey, baseUrl: getBaseUrl() });
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
    info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
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
  .command('set-base-url <baseUrl>')
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
    const baseUrl = getBaseUrl();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('not set (defaults to https://api.watolabs.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const memoriesCmd = program.command('memories').description('Shared agent memories');

memoriesCmd
  .command('list')
  .description('List memories')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listMemories(parseQueryOption(opts.query));
      print(result, getFormat(memoriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memoriesCmd
  .command('get <memoryId>')
  .description('Get a memory by ID')
  .action(async (memoryId: string) => {
    try {
      const client = getClient();
      const result = await client.getMemory(memoryId);
      print(result, getFormat(memoriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memoriesCmd
  .command('upsert')
  .description('Create or update a memory')
  .option('--body <json>', 'Request body as JSON object')
  .option('--title <title>', 'Memory title')
  .option('--content <content>', 'Memory content')
  .action(async (opts) => {
    try {
      const body = parseJsonOption(opts.body, 'body') || {};
      if (opts.title) body.title = opts.title;
      if (opts.content) body.content = opts.content;
      const client = getClient();
      const result = await client.upsertMemory(body);
      print(result, getFormat(memoriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const workflowsCmd = program.command('workflows').description('Agent workflows');

workflowsCmd
  .command('list')
  .description('List workflows')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listWorkflows(parseQueryOption(opts.query));
      print(result, getFormat(workflowsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workflowsCmd
  .command('run <workflowId>')
  .description('Run a workflow')
  .option('--body <json>', 'Request body as JSON object')
  .option('--input <json>', 'Workflow input as JSON object')
  .action(async (workflowId: string, opts) => {
    try {
      const body = parseJsonOption(opts.body, 'body') || {};
      const input = parseJsonOption(opts.input, 'input');
      if (input) body.input = input;
      const client = getClient();
      const result = await client.runWorkflow(workflowId, body);
      print(result, getFormat(workflowsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const toolsCmd = program.command('tools').description('Connected tools');

toolsCmd
  .command('list')
  .description('List tools')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTools(parseQueryOption(opts.query));
      print(result, getFormat(toolsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const artifactsCmd = program.command('artifacts').description('Workflow artifacts');

artifactsCmd
  .command('get <artifactId>')
  .description('Get an artifact by ID')
  .action(async (artifactId: string) => {
    try {
      const client = getClient();
      const result = await client.getArtifact(artifactId);
      print(result, getFormat(artifactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send an arbitrary request to the Wato API')
  .requiredOption('--path <path>', 'API path (e.g. /memories)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body as JSON object')
  .option('--query <json>', 'Query parameters as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest(opts.path, {
        method: opts.method,
        body: parseJsonOption(opts.body, 'body'),
        params: parseQueryOption(opts.query),
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
