#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getAccountId,
  setAccountId,
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
import { success, error, info, print, warn } from '../utils/output';
import type { FinancingOfferStatus } from '../types';

// Stripe Capital connector name and version
const CONNECTOR_NAME = 'connect-stripecapital';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Capital API connector CLI (Capital for platforms)')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-a, --account <id>', 'Connected account to act on behalf of (Stripe-Account)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set API key / account from flags if provided
    if (opts.apiKey) {
      process.env.STRIPE_CAPITAL_API_KEY = opts.apiKey;
    }
    if (opts.account) {
      process.env.STRIPE_CAPITAL_ACCOUNT_ID = opts.account;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_CAPITAL_API_KEY environment variable.`);
    process.exit(1);
  }
  const accountId = getAccountId();
  return new Connector({ apiKey, accountId });
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
  .option('--account <id>', 'Connected account ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      accountId: opts.account,
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
    if (config.accountId) {
      info(`Account ID: ${config.accountId}`);
    }
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
  .command('set-account <accountId>')
  .description('Set connected account ID (Stripe-Account header)')
  .action((accountId: string) => {
    if (!accountId.startsWith('acct_')) {
      warn('Account ID should start with "acct_"');
    }
    setAccountId(accountId);
    success(`Account ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const accountId = getAccountId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    if (accountId) {
      info(`Account ID: ${accountId}`);
    }
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Financing Offers Commands
// ============================================
const offersCmd = program
  .command('offers')
  .description('Manage Capital financing offers');

offersCmd
  .command('list')
  .description('List financing offers')
  .option('-l, --limit <number>', 'Maximum number of offers', '10')
  .option('--connected-account <id>', 'Filter by connected account')
  .option('--status <status>', 'Filter by status (e.g. delivered, accepted, paid_out)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.financingOffers.list({
        limit: parseInt(opts.limit),
        connected_account: opts.connectedAccount,
        status: opts.status as FinancingOfferStatus | undefined,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

offersCmd
  .command('get <id>')
  .description('Retrieve a financing offer by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.financingOffers.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

offersCmd
  .command('mark-delivered <id>')
  .description('Acknowledge that a financing offer was delivered to the connected account')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.financingOffers.markDelivered(id, {
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Financing offer marked as delivered');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Financing Summary Commands
// ============================================
program
  .command('summary')
  .description('Retrieve the financing summary for the account')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.financingSummary.retrieve();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
