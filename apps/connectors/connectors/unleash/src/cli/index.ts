#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getProjectId,
  setProjectId,
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

const CONNECTOR_NAME = 'connect-unleash';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Unleash feature flag management connector')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
  .option('-u, --base-url <url>', 'Unleash API base URL')
  .option('--project <id>', 'Unleash project ID')
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
      process.env.UNLEASH_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.baseUrl) {
      process.env.UNLEASH_BASE_URL = opts.baseUrl;
    }

    if (opts.project) {
      process.env.UNLEASH_PROJECT = opts.project;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set UNLEASH_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({
    apiKey,
    baseUrl: getBaseUrl(),
    projectId: getProjectId(),
  });
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

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
  .option('--project <id>', 'Default project ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      projectId: opts.project,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('not set (uses default)')}`);
    info(`Project: ${config.projectId || 'default'}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API token')
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
  .command('set-project <id>')
  .description('Set default project ID')
  .action((id: string) => {
    setProjectId(id);
    success(`Project ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('not set (uses default)')}`);
    info(`Project: ${getProjectId()}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Feature Flag Commands
// ============================================
const flagsCmd = program
  .command('flags')
  .description('Manage Unleash feature flags');

flagsCmd
  .command('list')
  .description('List feature flags in the configured project')
  .option('--project <id>', 'Override project ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.flags.list(opts.project);
      print(result, getFormat(flagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

flagsCmd
  .command('get <name>')
  .description('Get a feature flag by name')
  .option('--project <id>', 'Override project ID')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.flags.get(name, opts.project);
      print(result, getFormat(flagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

flagsCmd
  .command('create')
  .description('Create a new feature flag')
  .requiredOption('-n, --name <name>', 'Feature flag name')
  .option('-d, --description <text>', 'Feature description')
  .option('-t, --type <type>', 'Feature type (release, experiment, operational, permission)', 'release')
  .option('--project <id>', 'Override project ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.flags.create({
        name: opts.name,
        description: opts.description,
        type: opts.type,
      }, opts.project);
      success('Feature flag created!');
      print(result, getFormat(flagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Events Commands
// ============================================
const eventsCmd = program
  .command('events')
  .description('Unleash event log');

eventsCmd
  .command('list')
  .description('List recent events')
  .option('--project <id>', 'Filter by project')
  .option('--feature <name>', 'Filter by feature name')
  .option('-n, --limit <number>', 'Maximum events to return', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.events.list({
        project: opts.project,
        feature: opts.feature,
        limit: parseInt(opts.limit, 10),
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Raw Request
// ============================================
const requestCmd = program
  .command('request')
  .description('Make a raw Admin API request');

requestCmd
  .command('raw')
  .description('Send a raw request to the Unleash Admin API')
  .requiredOption('-m, --method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)')
  .requiredOption('-p, --path <path>', 'API path (e.g. /admin/events)')
  .option('-b, --body <json>', 'Request body as JSON string')
  .action(async (opts) => {
    try {
      const method = opts.method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        error('Method must be GET, POST, PUT, PATCH, or DELETE');
        process.exit(1);
      }

      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const client = getClient();
      const result = await client.rawRequest(method, opts.path, { body });
      print(result, getFormat(requestCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
