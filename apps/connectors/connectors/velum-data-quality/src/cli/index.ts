#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Connector } from '../api';
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

const CONNECTOR_NAME = 'connect-velum-data-quality';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Velum data quality platform connector CLI')
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
      process.env.VELUM_DATA_QUALITY_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VELUM_DATA_QUALITY_API_KEY environment variable.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new Connector({ apiKey, baseUrl });
}

function parseJsonBody(value?: string): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error('Invalid JSON body');
    process.exit(1);
  }
}

function readStdinJson(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve({});
      return;
    }
    const chunks: Buffer[] = [];
    process.stdin.on('data', chunk => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    process.stdin.on('error', reject);
  });
}

// Profile commands
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

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
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.velum-data-quality.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Checks commands
const checksCmd = program.command('checks').description('Manage data quality checks');

checksCmd
  .command('list')
  .description('List checks')
  .option('--page <number>', 'Page number')
  .option('--page-size <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {};
      if (opts.page) params.page = parseInt(opts.page, 10);
      if (opts.pageSize) params.page_size = parseInt(opts.pageSize, 10);
      const result = await client.checks.list(params);
      print(result, getFormat(checksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checksCmd
  .command('get <checkId>')
  .description('Get a check by ID')
  .action(async (checkId: string) => {
    try {
      const client = getClient();
      const result = await client.checks.get(checkId);
      print(result, getFormat(checksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checksCmd
  .command('create')
  .description('Create a check (pass JSON via --body or stdin)')
  .option('--body <json>', 'JSON request body')
  .option('--file <path>', 'Read JSON body from file')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown>;
      if (opts.file) {
        body = JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>;
      } else if (opts.body) {
        body = parseJsonBody(opts.body);
      } else {
        body = await readStdinJson();
      }

      const client = getClient();
      const result = await client.checks.create(body);
      success('Check created');
      print(result, getFormat(checksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Events commands
const eventsCmd = program.command('events').description('List data quality events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--page <number>', 'Page number')
  .option('--page-size <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {};
      if (opts.page) params.page = parseInt(opts.page, 10);
      if (opts.pageSize) params.page_size = parseInt(opts.pageSize, 10);
      const result = await client.events.list(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Search command
program
  .command('search')
  .description('Search Velum data quality records')
  .option('--body <json>', 'JSON request body')
  .option('--file <path>', 'Read JSON body from file')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown>;
      if (opts.file) {
        body = JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>;
      } else if (opts.body) {
        body = parseJsonBody(opts.body);
      } else {
        body = await readStdinJson();
      }

      const client = getClient();
      const result = await client.search.search(body);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request escape hatch
program
  .command('raw')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /checks)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'JSON request body')
  .option('--file <path>', 'Read JSON body from file')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> | undefined;
      if (opts.file) {
        body = JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>;
      } else if (opts.body) {
        body = parseJsonBody(opts.body);
      }

      const client = getClient();
      const result = await client.rawRequest({
        method: opts.method.toUpperCase(),
        path: opts.path,
        body,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
