#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
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

const CONNECTOR_NAME = 'connect-webhook';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Webhook API connector CLI')
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
      process.env.WEBHOOK_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WEBHOOK_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: getBaseUrl() });
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
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('https://api.webhook.com/v1 (default)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const hooksCmd = program.command('hooks').description('Manage webhook hooks');

hooksCmd
  .command('list')
  .description('List hooks')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-o, --offset <number>', 'Offset for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, number> = {};
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      if (opts.offset) params.offset = parseInt(opts.offset, 10);
      const result = await client.hooks.list(params);
      print(result, getFormat(hooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

hooksCmd
  .command('create')
  .description('Create a hook')
  .option('-n, --name <name>', 'Hook name')
  .option('-u, --url <url>', 'Target URL')
  .option('-b, --body <json>', 'Full JSON body')
  .action(async (opts) => {
    try {
      const client = getClient();
      let body: Record<string, unknown> = {};
      if (opts.body) {
        body = JSON.parse(opts.body);
      } else {
        if (opts.name) body.name = opts.name;
        if (opts.url) body.url = opts.url;
      }
      const result = await client.hooks.create(body);
      success('Hook created');
      print(result, getFormat(hooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

hooksCmd
  .command('get <hookId>')
  .description('Get a hook by ID')
  .action(async (hookId: string) => {
    try {
      const client = getClient();
      const result = await client.hooks.get(hookId);
      print(result, getFormat(hooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('List webhook events');

eventsCmd
  .command('list')
  .description('List events')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-o, --offset <number>', 'Offset for pagination')
  .option('--hook-id <hookId>', 'Filter by hook ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {};
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      if (opts.offset) params.offset = parseInt(opts.offset, 10);
      if (opts.hookId) params.hookId = opts.hookId;
      const result = await client.events.list(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search webhook resources')
  .option('-q, --query <query>', 'Search query')
  .option('-t, --type <type>', 'Resource type filter')
  .option('-b, --body <json>', 'Full JSON search body')
  .action(async (opts) => {
    try {
      const client = getClient();
      let body: Record<string, unknown> = {};
      if (opts.body) {
        body = JSON.parse(opts.body);
      } else {
        if (opts.query) body.query = opts.query;
        if (opts.type) body.type = opts.type;
      }
      const result = await client.search.search(body);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send an arbitrary API request')
  .requiredOption('-p, --path <path>', 'API path (e.g. /hooks)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-b, --body <json>', 'JSON request body')
  .option('-q, --query <json>', 'JSON query parameters object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        body: opts.body ? JSON.parse(opts.body) : undefined,
        query: opts.query ? JSON.parse(opts.query) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
