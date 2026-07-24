#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Unifold } from '../api';
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

const CONNECTOR_NAME = 'connect-unifold';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Unifold connector - Cross-chain deposit API')
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
      process.env.UNIFOLD_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Unifold {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set UNIFOLD_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Unifold({ apiKey, baseUrl: getBaseUrl() });
}

function parseQueryOptions(opts: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined && !['format', 'profile', 'apiKey'].includes(key)) {
      query[key] = value as string | number | boolean;
    }
  }
  return query;
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.unifold.io/v1)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set custom API base URL')
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
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.unifold.io/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('users')
  .description('User management');

userCmd
  .command('list')
  .description('List users')
  .option('--limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listUsers(parseQueryOptions(opts));
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('get <userId>')
  .description('Get a user by ID')
  .action(async (userId: string) => {
    try {
      const client = getClient();
      const result = await client.getUser(userId);
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Payment Intent Commands
// ============================================
const paymentIntentCmd = program
  .command('payment-intents')
  .description('Payment intent management');

paymentIntentCmd
  .command('list')
  .description('List payment intents')
  .option('--status <status>', 'Filter by status')
  .option('--limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listPaymentIntents(parseQueryOptions(opts));
      print(result, getFormat(paymentIntentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentIntentCmd
  .command('get <paymentIntentId>')
  .description('Get a payment intent by ID')
  .action(async (paymentIntentId: string) => {
    try {
      const client = getClient();
      const result = await client.getPaymentIntent(paymentIntentId);
      print(result, getFormat(paymentIntentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentIntentCmd
  .command('create')
  .description('Create a payment intent')
  .requiredOption('--amount <amount>', 'Amount in smallest currency unit')
  .requiredOption('--currency <currency>', 'Currency code (e.g. USD)')
  .requiredOption('--user-id <userId>', 'User ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createPaymentIntent({
        amount: Number(opts.amount),
        currency: opts.currency,
        userId: opts.userId,
      });
      success('Payment intent created');
      print(result, getFormat(paymentIntentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Treasury Commands
// ============================================
const treasuryCmd = program
  .command('treasury')
  .description('Treasury account management');

treasuryCmd
  .command('create')
  .description('Create a treasury account')
  .requiredOption('--user-id <userId>', 'User ID')
  .requiredOption('--network <network>', 'Blockchain network (e.g. base)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createTreasuryAccount({
        userId: opts.userId,
        network: opts.network,
      });
      success('Treasury account created');
      print(result, getFormat(treasuryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

treasuryCmd
  .command('get <accountId>')
  .description('Get a treasury account by ID')
  .action(async (accountId: string) => {
    try {
      const client = getClient();
      const result = await client.getTreasuryAccount(accountId);
      print(result, getFormat(treasuryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Deposit Address Commands
// ============================================
const depositCmd = program
  .command('deposit-addresses')
  .description('Deposit address management');

depositCmd
  .command('list')
  .description('List deposit addresses')
  .option('--account-id <accountId>', 'Filter by treasury account ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const query = parseQueryOptions(opts);
      if (opts.accountId) {
        query.accountId = opts.accountId;
      }
      const result = await client.listDepositAddresses(query);
      print(result, getFormat(depositCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Raw Request
// ============================================
program
  .command('raw')
  .description('Make a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /payment-intents)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'JSON request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        body,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
