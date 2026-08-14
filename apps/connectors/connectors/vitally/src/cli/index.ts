#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Vitally } from '../api';
import {
  getApiKey,
  setApiKey,
  getSubdomain,
  setSubdomain,
  setRegion,
  getRegion,
  buildVitallyConfig,
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
import type { CreateAccountInput } from '../types';

const CONNECTOR_NAME = 'connect-vitally';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vitally connector - customer success platform for accounts, events, and search')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API secret key (overrides config)')
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
      process.env.VITALLY_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Vitally {
  try {
    return new Vitally(buildVitallyConfig());
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

function parseJsonBody(value: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
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
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API secret key')
  .option('--subdomain <subdomain>', 'Vitally workspace subdomain')
  .option('--region <region>', 'Data region: us or eu', 'us')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      subdomain: opts.subdomain,
      region: opts.region === 'eu' ? 'eu' : 'us',
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
    info(`Subdomain: ${config.subdomain || chalk.gray('not set')}`);
    info(`Region: ${config.region || 'us'}`);
    info(`Base URL override: ${config.baseUrl || chalk.gray('not set')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration (active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API secret key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-subdomain <subdomain>')
  .description('Set Vitally workspace subdomain (US region)')
  .action((subdomain: string) => {
    setSubdomain(subdomain);
    success(`Subdomain saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-region <region>')
  .description('Set data region (us or eu)')
  .action((region: string) => {
    if (region !== 'us' && region !== 'eu') {
      error('Region must be "us" or "eu"');
      process.exit(1);
    }
    setRegion(region);
    success(`Region saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const subdomain = getSubdomain();
    const region = getRegion();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Subdomain: ${subdomain || chalk.gray('not set')}`);
    info(`Region: ${region}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Account commands
const accountCmd = program.command('account').description('Account management');

accountCmd
  .command('list')
  .description('List accounts')
  .option('--from <cursor>', 'Pagination cursor')
  .option('--limit <number>', 'Page size', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listAccounts({
        from: opts.from,
        limit: parseInt(opts.limit, 10),
      });
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('get <id>')
  .description('Get an account by ID or external ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getAccount(id);
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('create')
  .description('Create or upsert an account')
  .requiredOption('--external-id <id>', 'External account ID in your system')
  .option('--name <name>', 'Account display name')
  .option('--body <json>', 'Full JSON body (overrides other fields)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body: CreateAccountInput = opts.body
        ? (parseJsonBody(opts.body, '--body') as CreateAccountInput)
        : {
            externalId: opts.externalId,
            ...(opts.name ? { name: opts.name } : {}),
          };
      const result = await client.createAccount(body);
      success('Account created/updated');
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Event commands
const eventCmd = program.command('event').description('Product event management');

eventCmd
  .command('list')
  .description('List tracked events')
  .option('--from <cursor>', 'Pagination cursor')
  .option('--limit <number>', 'Page size', '50')
  .option('--account-id <id>', 'Filter by account ID')
  .option('--user-id <id>', 'Filter by user ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents({
        from: opts.from,
        limit: parseInt(opts.limit, 10),
        accountId: opts.accountId,
        userId: opts.userId,
      });
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Search command
program
  .command('search')
  .description('Search Vitally resources')
  .option('--query <query>', 'Search query string')
  .option('--limit <number>', 'Maximum results', '25')
  .option('--body <json>', 'Full JSON search request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonBody(opts.body, '--body')
        : {
            ...(opts.query ? { query: opts.query } : {}),
            limit: parseInt(opts.limit, 10),
          };
      const result = await client.search(body);
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
  .requiredOption('--method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)')
  .requiredOption('--path <path>', 'API path (e.g. /resources/accounts)')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <file>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      const method = opts.method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        error('Method must be GET, POST, PUT, PATCH, or DELETE');
        process.exit(1);
      }

      let body: Record<string, unknown> | undefined;
      if (opts.bodyFile) {
        body = parseJsonBody(readFileSync(opts.bodyFile, 'utf-8'), '--body-file');
      } else if (opts.body) {
        body = parseJsonBody(opts.body, '--body');
      }

      const client = getClient();
      const result = await client.rawRequest(method, opts.path, { body });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
