#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Sprinklr } from '../api';
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

const CONNECTOR_NAME = 'connect-sprinklr';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Sprinklr connector - Customer experience platform cases, events, and search')
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
      process.env.SPRINKLR_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Sprinklr {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SPRINKLR_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Sprinklr({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.sprinklr.com/v1)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <key>')
  .description('Set API key')
  .action((key: string) => {
    setApiKey(key);
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
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.sprinklr.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Cases Commands
// ============================================
const casesCmd = program
  .command('cases')
  .description('Manage Sprinklr cases');

casesCmd
  .command('list')
  .description('List cases')
  .option('--limit <number>', 'Maximum number of cases')
  .option('--offset <number>', 'Offset for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      if (opts.offset) params.offset = parseInt(opts.offset, 10);
      const result = await client.listCases(params);
      print(result, getFormat(casesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

casesCmd
  .command('get <caseId>')
  .description('Get a case by ID')
  .action(async (caseId: string) => {
    try {
      const client = getClient();
      const result = await client.getCase(caseId);
      print(result, getFormat(casesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

casesCmd
  .command('create')
  .description('Create a new case')
  .option('--body <json>', 'Case payload as JSON')
  .option('--file <path>', 'Path to JSON file with case payload')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.file) {
        body = JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>;
      } else if (opts.body) {
        body = parseJsonOption(opts.body, '--body') || {};
      } else {
        error('Provide --body <json> or --file <path>');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.createCase(body);
      success('Case created!');
      print(result, getFormat(casesCmd));
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
  .description('Manage Sprinklr events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--limit <number>', 'Maximum number of events')
  .option('--offset <number>', 'Offset for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      if (opts.offset) params.offset = parseInt(opts.offset, 10);
      const result = await client.listEvents(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Search Command
// ============================================
program
  .command('search')
  .description('Search Sprinklr data')
  .option('--body <json>', 'Search payload as JSON')
  .option('--file <path>', 'Path to JSON file with search payload')
  .option('--query <text>', 'Search query text')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.file) {
        body = JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>;
      } else if (opts.body) {
        body = parseJsonOption(opts.body, '--body') || {};
      } else if (opts.query) {
        body = { query: opts.query };
      } else {
        error('Provide --body <json>, --file <path>, or --query <text>');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.search(body);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Raw Request Command
// ============================================
program
  .command('raw')
  .description('Make a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /cases)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body as JSON')
  .option('--file <path>', 'Path to JSON file with request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      let body: Record<string, unknown> | undefined;
      if (opts.file) {
        body = JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>;
      } else if (opts.body) {
        body = parseJsonOption(opts.body, '--body');
      }

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
