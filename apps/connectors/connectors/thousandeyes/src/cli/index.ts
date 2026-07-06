#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ThousandEyes } from '../api';
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

const CONNECTOR_NAME = 'connect-thousandeyes';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('ThousandEyes connector - Network monitoring and path visibility tests')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
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
      process.env.THOUSANDEYES_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.THOUSANDEYES_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ThousandEyes {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-api-key <key>" or set THOUSANDEYES_API_KEY.`);
    process.exit(1);
  }

  return new ThousandEyes({ apiKey, baseUrl });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Expected JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function queryParamsFromOptions(opts: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  const params: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && value !== null && value !== '') {
      params[key] = value as string | number | boolean;
    }
  }
  return params;
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
  .option('--api-key <key>', 'API token')
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
    info(`Base URL: ${config.baseUrl || chalk.gray('https://api.thousandeyes.com/v7 (default)')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-api-key <apiKey>')
  .description('Set API token')
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
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('https://api.thousandeyes.com/v7 (default)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program
  .command('validate')
  .description('Validate API credentials')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.validate();
      if (result.valid) {
        success('API credentials are valid');
      } else {
        error('API credentials are invalid');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const testsCmd = program.command('tests').description('Manage network tests');

testsCmd
  .command('list')
  .description('List tests')
  .option('--type <type>', 'Filter by test type')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const params = queryParamsFromOptions({ type: opts.type });
      const result = await client.listTests(params);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('create')
  .description('Create a test')
  .requiredOption('--type <type>', 'ThousandEyes test type path segment (for example, agent-to-server)')
  .requiredOption('--body <json>', 'Test definition JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body');
      const result = await client.createTest(opts.type, body);
      print(result, getFormat(this));
      success('Test created');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

testsCmd
  .command('get <testId>')
  .description('Get a test by ID')
  .action(async function(this: Command, testId: string) {
    try {
      const client = getClient();
      const result = await client.getTest(testId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Manage events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--start <timestamp>', 'Start time (Unix ms)')
  .option('--end <timestamp>', 'End time (Unix ms)')
  .option('--test-id <testId>', 'Filter by test ID')
  .option('--type <type>', 'Filter by event type')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const params = queryParamsFromOptions({
        start: opts.start,
        end: opts.end,
        testId: opts.testId,
        type: opts.type,
      });
      const result = await client.listEvents(params);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search ThousandEyes data')
  .requiredOption('--body <json>', 'Search request JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body');
      const result = await client.search(body);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('request')
  .description('Make a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /tests)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters JSON object')
  .option('--body <json>', 'Request body JSON object')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const method = String(opts.method).toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      const params = opts.query ? parseJsonOption(opts.query, '--query') as Record<string, string | number | boolean | undefined> : undefined;
      const body = opts.body ? parseJsonOption(opts.body, '--body') : undefined;
      const result = await client.rawRequest({ method, path: opts.path, params, body });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
