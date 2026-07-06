#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TheHiveProject } from '../api';
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

const CONNECTOR_NAME = 'connect-the-hive-project';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TheHiveProject API connector — security case management platform')
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
      process.env.THE_HIVE_PROJECT_API_KEY = opts.apiKey;
    }

    if (opts.baseUrl) {
      process.env.THE_HIVE_PROJECT_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TheHiveProject {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set THE_HIVE_PROJECT_API_KEY.`);
    process.exit(1);
  }
  return new TheHiveProject({ apiKey, baseUrl: getBaseUrl() });
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
  .action((name: string, opts: { apiKey?: string; baseUrl?: string; use?: boolean }) => {
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
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.thehive-project.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const casesCmd = program.command('cases').description('Case management');

casesCmd
  .command('list')
  .description('List cases')
  .action(async function (this: Command) {
    const client = getClient();
    const result = await client.cases.list();
    print(result, getFormat(this));
  });

casesCmd
  .command('get <caseId>')
  .description('Get a case by ID')
  .action(async function (this: Command, caseId: string) {
    const client = getClient();
    const result = await client.cases.get(caseId);
    print(result, getFormat(this));
  });

casesCmd
  .command('create')
  .description('Create a case')
  .option('--title <title>', 'Case title')
  .option('--description <description>', 'Case description')
  .option('--severity <severity>', 'Severity level', parseInt)
  .option('--body <json>', 'Full JSON body (overrides other options)')
  .action(async function (
    this: Command,
    opts: { title?: string; description?: string; severity?: number; body?: string }
  ) {
    const client = getClient();
    let body: Record<string, unknown>;

    if (opts.body) {
      body = JSON.parse(opts.body);
    } else {
      body = {};
      if (opts.title) body.title = opts.title;
      if (opts.description) body.description = opts.description;
      if (opts.severity !== undefined) body.severity = opts.severity;
    }

    const result = await client.cases.create(body);
    print(result, getFormat(this));
  });

const eventsCmd = program.command('events').description('Event management');

eventsCmd
  .command('list')
  .description('List events')
  .action(async function (this: Command) {
    const client = getClient();
    const result = await client.events.list();
    print(result, getFormat(this));
  });

const searchCmd = program.command('search').description('Search API');

searchCmd
  .command('run')
  .description('Run a search query')
  .requiredOption('--body <json>', 'Search request JSON body')
  .action(async function (this: Command, opts: { body: string }) {
    const client = getClient();
    const body = JSON.parse(opts.body);
    const result = await client.search.search(body);
    print(result, getFormat(this));
  });

program
  .command('raw-request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /cases)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body JSON')
  .option('--query <json>', 'Query parameters JSON')
  .action(async function (
    this: Command,
    opts: { path: string; method: string; body?: string; query?: string }
  ) {
    const client = getClient();
    const result = await client.rawRequest({
      path: opts.path,
      method: opts.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      body: opts.body ? JSON.parse(opts.body) : undefined,
      params: opts.query ? JSON.parse(opts.query) : undefined,
    });
    print(result, getFormat(this));
  });

program.parse();
