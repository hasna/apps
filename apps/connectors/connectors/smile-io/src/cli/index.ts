#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Smile } from '../api';
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

const CONNECTOR_NAME = 'connect-smile-io';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Smile.io connector CLI - loyalty, points, rewards, and referrals')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile) && opts.profile !== 'default') {
        error(
          `Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`,
        );
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Smile {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No Smile.io API key configured. Set one with "${CONNECTOR_NAME} config set-key <key>" or the SMILEIO_API_KEY environment variable.`,
    );
    process.exit(1);
  }
  return new Smile({ apiKey, baseUrl: getBaseUrl() });
}

function fail(err: unknown): never {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage API credentials');

configCmd
  .command('set-key <apiKey>')
  .description('Store the Smile.io private API key for the active profile')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Override the API base URL (defaults to https://api.smile.io/v1)')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL set to ${url}`);
  });

configCmd
  .command('show')
  .description('Show the current configuration')
  .action(() => {
    const apiKey = getApiKey();
    console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('https://api.smile.io/v1 (default)')}`);
  });

configCmd
  .command('clear')
  .description('Clear stored credentials for the active profile')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// Profile Commands
// ============================================
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
      const active = p === current ? chalk.green(' (active)') : '';
      const hasKey = loadProfile(p).apiKey ? chalk.gray(' - key set') : '';
      console.log(`  ${p}${active}${hasKey}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name) && name !== 'default') {
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {});
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

// ============================================
// Customer Commands
// ============================================
const customersCmd = program.command('customers').description('Loyalty program members');

customersCmd
  .command('list')
  .description('List customers')
  .option('-e, --email <email>', 'Filter by email')
  .option('-s, --state <state>', 'Filter by state (candidate, member, disabled)')
  .option('-l, --limit <n>', 'Results per page (max 250)')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .option('--include <fields>', 'Nested objects to include (e.g. vip_status)')
  .action(async (opts) => {
    try {
      const { customers, metadata } = await getClient().customers.list({
        email: opts.email,
        state: opts.state,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
        include: opts.include,
      });
      print(customers, getFormat());
      if (metadata?.next_cursor) {
        info(`More available. Use --cursor ${metadata.next_cursor}`);
      }
    } catch (err) {
      fail(err);
    }
  });

customersCmd
  .command('get <id>')
  .description('Retrieve a customer by ID')
  .option('--include <fields>', 'Nested objects to include (e.g. vip_status)')
  .action(async (id: string, opts) => {
    try {
      const customer = await getClient().customers.get(parseInt(id, 10), opts.include);
      print(customer, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Customer Identity Commands
// ============================================
program
  .command('identity')
  .description('Create or update a customer identity')
  .requiredOption('-e, --email <email>', 'Customer email')
  .requiredOption('-d, --distinct-id <id>', 'External unique identifier')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .action(async (opts) => {
    try {
      const identity = await getClient().customerIdentities.createOrUpdate({
        email: opts.email,
        distinct_id: opts.distinctId,
        first_name: opts.firstName,
        last_name: opts.lastName,
      });
      success('Customer identity saved');
      print(identity, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Points Commands
// ============================================
const pointsCmd = program.command('points').description('Points transactions and products');

pointsCmd
  .command('list')
  .description('List points transactions')
  .option('-c, --customer <id>', 'Filter by customer ID')
  .option('-l, --limit <n>', 'Results per page (max 250)')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const { points_transactions, metadata } = await getClient().pointsTransactions.list({
        customer_id: opts.customer ? parseInt(opts.customer, 10) : undefined,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(points_transactions, getFormat());
      if (metadata?.next_cursor) {
        info(`More available. Use --cursor ${metadata.next_cursor}`);
      }
    } catch (err) {
      fail(err);
    }
  });

pointsCmd
  .command('get <id>')
  .description('Retrieve a points transaction by ID')
  .action(async (id: string) => {
    try {
      const tx = await getClient().pointsTransactions.get(parseInt(id, 10));
      print(tx, getFormat());
    } catch (err) {
      fail(err);
    }
  });

pointsCmd
  .command('adjust <customerId> <pointsChange>')
  .description('Create a points transaction (positive adds, negative subtracts)')
  .option('-d, --description <text>', 'Customer-visible reason')
  .option('-n, --note <text>', 'Merchant-only internal note')
  .action(async (customerId: string, pointsChange: string, opts) => {
    try {
      const tx = await getClient().pointsTransactions.create({
        customer_id: parseInt(customerId, 10),
        points_change: parseInt(pointsChange, 10),
        description: opts.description,
        internal_note: opts.note,
      });
      success(`Points transaction created (${tx.points_change >= 0 ? '+' : ''}${tx.points_change})`);
      print(tx, getFormat());
    } catch (err) {
      fail(err);
    }
  });

const productsCmd = pointsCmd.command('products').description('Points products (reward options)');

productsCmd
  .command('list')
  .description('List points products')
  .option('-t, --exchange-type <type>', 'Filter by exchange type (fixed, variable)')
  .option('--page <n>', 'Page number')
  .option('--page-size <n>', 'Results per page (max 250)')
  .action(async (opts) => {
    try {
      const { points_products } = await getClient().pointsProducts.list({
        exchange_type: opts.exchangeType,
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        page_size: opts.pageSize ? parseInt(opts.pageSize, 10) : undefined,
      });
      print(points_products, getFormat());
    } catch (err) {
      fail(err);
    }
  });

productsCmd
  .command('get <id>')
  .description('Retrieve a points product by ID')
  .action(async (id: string) => {
    try {
      const product = await getClient().pointsProducts.get(parseInt(id, 10));
      print(product, getFormat());
    } catch (err) {
      fail(err);
    }
  });

productsCmd
  .command('purchase <id> <customerId>')
  .description('Redeem a points product on behalf of a customer')
  .option('-s, --points-to-spend <n>', 'Points to spend (variable products only)')
  .action(async (id: string, customerId: string, opts) => {
    try {
      const purchase = await getClient().pointsProducts.purchase(parseInt(id, 10), {
        customer_id: parseInt(customerId, 10),
        points_to_spend: opts.pointsToSpend ? parseInt(opts.pointsToSpend, 10) : undefined,
      });
      success(`Purchased points product (${purchase.points_spent} points spent)`);
      print(purchase, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Activity Command
// ============================================
program
  .command('activity <token>')
  .description('Record a customer activity for reward evaluation')
  .option('-c, --customer <id>', 'Customer ID')
  .option('-e, --email <email>', 'Customer email (alternative to --customer)')
  .option('-d, --distinct-id <id>', 'External activity identifier')
  .action(async (token: string, opts) => {
    try {
      if (!opts.customer && !opts.email) {
        error('Provide --customer <id> or --email <email>');
        process.exit(1);
      }
      const activity = await getClient().activities.create({
        token,
        customer_id: opts.customer ? parseInt(opts.customer, 10) : undefined,
        customer_email: opts.email,
        distinct_id: opts.distinctId,
      });
      success('Activity recorded');
      print(activity, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Earning Rules Command
// ============================================
program
  .command('earning-rules')
  .description('List the ways customers earn points')
  .option('-l, --limit <n>', 'Results per page (max 250)')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const { earning_rules, metadata } = await getClient().earningRules.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(earning_rules, getFormat());
      if (metadata?.next_cursor) {
        info(`More available. Use --cursor ${metadata.next_cursor}`);
      }
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// VIP Tiers Command
// ============================================
program
  .command('vip-tiers')
  .description('List the program VIP tiers')
  .option('--include <fields>', 'Nested objects (perks, entry_rewards)')
  .action(async (opts) => {
    try {
      const tiers = await getClient().vipTiers.list({ include: opts.include });
      print(tiers, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Points Settings Command
// ============================================
program
  .command('settings')
  .description('Show the account points settings')
  .action(async () => {
    try {
      const settings = await getClient().pointsSettings.get();
      print(settings, getFormat());
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Reward Fulfillments Command
// ============================================
program
  .command('rewards')
  .description('List reward fulfillments issued to customers')
  .option('-c, --customer <id>', 'Filter by customer ID')
  .option('--fulfillment-status <status>', 'pending, issued, cancelled, failed')
  .option('--usage-status <status>', 'used, unused, untracked')
  .option('-l, --limit <n>', 'Results per page (max 250)')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const { reward_fulfillments, metadata } = await getClient().rewardFulfillments.list({
        customer_id: opts.customer ? parseInt(opts.customer, 10) : undefined,
        fulfillment_status: opts.fulfillmentStatus,
        usage_status: opts.usageStatus,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(reward_fulfillments, getFormat());
      if (metadata?.next_cursor) {
        info(`More available. Use --cursor ${metadata.next_cursor}`);
      }
    } catch (err) {
      fail(err);
    }
  });

program.parse();
