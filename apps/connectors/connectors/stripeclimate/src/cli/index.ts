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

// Stripe Climate connector name and version
const CONNECTOR_NAME = 'connect-stripeclimate';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Climate API connector CLI - carbon removal products, suppliers, and orders')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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
      process.env.STRIPE_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_API_KEY environment variable.`);
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
  .option('--account-id <id>', 'Connected account ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      accountId: opts.accountId,
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
// Products Commands
// ============================================
const productsCmd = program
  .command('products')
  .description('Browse Climate carbon removal products');

productsCmd
  .command('list')
  .description('List all available Climate products')
  .option('-l, --limit <number>', 'Maximum number of products')
  .option('--starting-after <id>', 'Cursor for pagination')
  .option('--ending-before <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.products.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        starting_after: opts.startingAfter,
        ending_before: opts.endingBefore,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('get <id>')
  .description('Get a Climate product by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.products.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Suppliers Commands
// ============================================
const suppliersCmd = program
  .command('suppliers')
  .description('Browse Climate carbon removal suppliers');

suppliersCmd
  .command('list')
  .description('List all Climate suppliers')
  .option('-l, --limit <number>', 'Maximum number of suppliers')
  .option('--starting-after <id>', 'Cursor for pagination')
  .option('--ending-before <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.suppliers.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        starting_after: opts.startingAfter,
        ending_before: opts.endingBefore,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

suppliersCmd
  .command('get <id>')
  .description('Get a Climate supplier by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.suppliers.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Orders Commands
// ============================================
const ordersCmd = program
  .command('orders')
  .description('Manage Climate carbon removal orders');

ordersCmd
  .command('list')
  .description('List all Climate orders')
  .option('-l, --limit <number>', 'Maximum number of orders')
  .option('--starting-after <id>', 'Cursor for pagination')
  .option('--ending-before <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.orders.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        starting_after: opts.startingAfter,
        ending_before: opts.endingBefore,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('get <id>')
  .description('Get a Climate order by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.orders.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('create')
  .description('Create a Climate order (provide exactly one of --amount or --metric-tons)')
  .requiredOption('--product <id>', 'Climate product ID')
  .option('--amount <number>', 'Requested amount in the currency\'s smallest unit')
  .option('--metric-tons <tons>', 'Requested number of metric tons')
  .option('--currency <code>', 'ISO currency code (defaults to product currency)')
  .option('--beneficiary <name>', 'Public name for the end beneficiary')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      if ((opts.amount && opts.metricTons) || (!opts.amount && !opts.metricTons)) {
        error('Provide exactly one of --amount or --metric-tons');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.orders.create({
        product: opts.product,
        amount: opts.amount ? parseInt(opts.amount) : undefined,
        metric_tons: opts.metricTons,
        currency: opts.currency,
        beneficiary: opts.beneficiary ? { public_name: opts.beneficiary } : undefined,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Climate order created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('update <id>')
  .description('Update a Climate order (beneficiary and/or metadata)')
  .option('--beneficiary <name>', 'Public name for the end beneficiary (empty string to clear)')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const beneficiary =
        opts.beneficiary === undefined
          ? undefined
          : opts.beneficiary === ''
            ? ''
            : { public_name: opts.beneficiary };
      const result = await client.orders.update(id, {
        beneficiary,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Climate order updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('cancel <id>')
  .description('Cancel a Climate order')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.orders.cancel(id);
      success('Climate order canceled');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
