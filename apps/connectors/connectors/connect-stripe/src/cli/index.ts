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

// Stripe connector name and version
const CONNECTOR_NAME = 'connect-stripe';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
    // Set API key from flag if provided
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

    success(`Profiles:`);
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

    createProfile(name, {
      apiKey: opts.apiKey,
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
    const isOrgKey = config.apiKey?.startsWith('sk_org_');

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    if (isOrgKey || config.accountId) {
      info(`Account ID: ${config.accountId || chalk.yellow('not set')}`);
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
  .description('Set account ID (required for org API keys)')
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
    const isOrgKey = apiKey?.startsWith('sk_org_');

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    if (isOrgKey) {
      info(`Account ID: ${accountId || chalk.yellow('not set (required for org keys)')}`);
    } else if (accountId) {
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
// Balance Commands
// ============================================
program
  .command('balance')
  .description('Get account balance')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.balance.get();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Products Commands
// ============================================
const productsCmd = program
  .command('products')
  .description('Manage products');

productsCmd
  .command('list')
  .description('List all products')
  .option('-l, --limit <number>', 'Maximum number of products', '10')
  .option('--active <boolean>', 'Filter by active status')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.products.list({
        limit: parseInt(opts.limit),
        active: opts.active === 'true' ? true : opts.active === 'false' ? false : undefined,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('get <id>')
  .description('Get a product by ID')
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

productsCmd
  .command('create')
  .description('Create a product')
  .requiredOption('-n, --name <name>', 'Product name')
  .option('-d, --description <text>', 'Product description')
  .option('--active <boolean>', 'Whether product is active', 'true')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.products.create({
        name: opts.name,
        description: opts.description,
        active: opts.active === 'true',
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Product created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('update <id>')
  .description('Update a product')
  .option('-n, --name <name>', 'Product name')
  .option('-d, --description <text>', 'Product description')
  .option('--active <boolean>', 'Whether product is active')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.products.update(id, {
        name: opts.name,
        description: opts.description,
        active: opts.active === 'true' ? true : opts.active === 'false' ? false : undefined,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Product updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('delete <id>')
  .description('Delete a product')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.products.del(id);
      success('Product deleted');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productsCmd
  .command('search')
  .description('Search products')
  .requiredOption('-q, --query <query>', 'Search query')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.products.search(opts.query, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Prices Commands
// ============================================
const pricesCmd = program
  .command('prices')
  .description('Manage prices');

pricesCmd
  .command('list')
  .description('List all prices')
  .option('-l, --limit <number>', 'Maximum number of prices', '10')
  .option('--product <id>', 'Filter by product ID')
  .option('--active <boolean>', 'Filter by active status')
  .option('--type <type>', 'Filter by type (one_time, recurring)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.prices.list({
        limit: parseInt(opts.limit),
        product: opts.product,
        active: opts.active === 'true' ? true : opts.active === 'false' ? false : undefined,
        type: opts.type as 'one_time' | 'recurring' | undefined,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pricesCmd
  .command('get <id>')
  .description('Get a price by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.prices.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pricesCmd
  .command('create')
  .description('Create a price')
  .requiredOption('--product <id>', 'Product ID')
  .requiredOption('--currency <currency>', 'Currency code (usd, eur, etc.)')
  .option('--unit-amount <cents>', 'Amount in cents')
  .option('--recurring-interval <interval>', 'Recurring interval (day, week, month, year)')
  .option('--recurring-interval-count <count>', 'Interval count')
  .option('--active <boolean>', 'Whether price is active', 'true')
  .option('--nickname <name>', 'Price nickname')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.prices.create({
        product: opts.product,
        currency: opts.currency,
        unit_amount: opts.unitAmount ? parseInt(opts.unitAmount) : undefined,
        active: opts.active === 'true',
        nickname: opts.nickname,
        recurring: opts.recurringInterval ? {
          interval: opts.recurringInterval as 'day' | 'week' | 'month' | 'year',
          interval_count: opts.recurringIntervalCount ? parseInt(opts.recurringIntervalCount) : undefined,
        } : undefined,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Price created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pricesCmd
  .command('update <id>')
  .description('Update a price')
  .option('--active <boolean>', 'Whether price is active')
  .option('--nickname <name>', 'Price nickname')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.prices.update(id, {
        active: opts.active === 'true' ? true : opts.active === 'false' ? false : undefined,
        nickname: opts.nickname,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Price updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pricesCmd
  .command('search')
  .description('Search prices')
  .requiredOption('-q, --query <query>', 'Search query')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.prices.search(opts.query, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Customers Commands
// ============================================
const customersCmd = program
  .command('customers')
  .description('Manage customers');

customersCmd
  .command('list')
  .description('List all customers')
  .option('-l, --limit <number>', 'Maximum number of customers', '10')
  .option('--email <email>', 'Filter by email')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.customers.list({
        limit: parseInt(opts.limit),
        email: opts.email,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('get <id>')
  .description('Get a customer by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.customers.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('create')
  .description('Create a customer')
  .option('-e, --email <email>', 'Customer email')
  .option('-n, --name <name>', 'Customer name')
  .option('--phone <phone>', 'Customer phone')
  .option('-d, --description <text>', 'Customer description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.customers.create({
        email: opts.email,
        name: opts.name,
        phone: opts.phone,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Customer created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('update <id>')
  .description('Update a customer')
  .option('-e, --email <email>', 'Customer email')
  .option('-n, --name <name>', 'Customer name')
  .option('--phone <phone>', 'Customer phone')
  .option('-d, --description <text>', 'Customer description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.customers.update(id, {
        email: opts.email,
        name: opts.name,
        phone: opts.phone,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Customer updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('delete <id>')
  .description('Delete a customer')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.customers.del(id);
      success('Customer deleted');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('search')
  .description('Search customers')
  .requiredOption('-q, --query <query>', 'Search query')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.customers.search(opts.query, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Subscriptions Commands
// ============================================
const subscriptionsCmd = program
  .command('subscriptions')
  .description('Manage subscriptions');

subscriptionsCmd
  .command('list')
  .description('List all subscriptions')
  .option('-l, --limit <number>', 'Maximum number of subscriptions', '10')
  .option('--customer <id>', 'Filter by customer ID')
  .option('--price <id>', 'Filter by price ID')
  .option('--status <status>', 'Filter by status (active, canceled, past_due, etc.)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.subscriptions.list({
        limit: parseInt(opts.limit),
        customer: opts.customer,
        price: opts.price,
        status: opts.status,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionsCmd
  .command('get <id>')
  .description('Get a subscription by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.subscriptions.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionsCmd
  .command('create')
  .description('Create a subscription')
  .requiredOption('--customer <id>', 'Customer ID')
  .requiredOption('--price <id>', 'Price ID')
  .option('--quantity <number>', 'Quantity')
  .option('--trial-period-days <days>', 'Trial period in days')
  .option('--cancel-at-period-end <boolean>', 'Cancel at period end')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.subscriptions.create({
        customer: opts.customer,
        items: [{ price: opts.price, quantity: opts.quantity ? parseInt(opts.quantity) : undefined }],
        trial_period_days: opts.trialPeriodDays ? parseInt(opts.trialPeriodDays) : undefined,
        cancel_at_period_end: opts.cancelAtPeriodEnd === 'true',
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Subscription created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionsCmd
  .command('update <id>')
  .description('Update a subscription')
  .option('--cancel-at-period-end <boolean>', 'Cancel at period end')
  .option('--proration-behavior <behavior>', 'Proration behavior (always_invoice, create_prorations, none)')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.subscriptions.update(id, {
        cancel_at_period_end: opts.cancelAtPeriodEnd === 'true' ? true : opts.cancelAtPeriodEnd === 'false' ? false : undefined,
        proration_behavior: opts.prorationBehavior,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Subscription updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionsCmd
  .command('cancel <id>')
  .description('Cancel a subscription')
  .option('--prorate', 'Prorate the cancellation')
  .option('--invoice-now', 'Invoice now for prorated amount')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.subscriptions.cancel(id, {
        prorate: opts.prorate,
        invoice_now: opts.invoiceNow,
      });
      success('Subscription canceled');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionsCmd
  .command('resume <id>')
  .description('Resume a paused subscription')
  .option('--proration-behavior <behavior>', 'Proration behavior')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.subscriptions.resume(id, {
        proration_behavior: opts.prorationBehavior,
      });
      success('Subscription resumed');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionsCmd
  .command('search')
  .description('Search subscriptions')
  .requiredOption('-q, --query <query>', 'Search query')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.subscriptions.search(opts.query, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Payment Intents Commands
// ============================================
const paymentIntentsCmd = program
  .command('payment-intents')
  .description('Manage payment intents');

paymentIntentsCmd
  .command('list')
  .description('List all payment intents')
  .option('-l, --limit <number>', 'Maximum number of payment intents', '10')
  .option('--customer <id>', 'Filter by customer ID')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.paymentIntents.list({
        limit: parseInt(opts.limit),
        customer: opts.customer,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentIntentsCmd
  .command('get <id>')
  .description('Get a payment intent by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.paymentIntents.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentIntentsCmd
  .command('create')
  .description('Create a payment intent')
  .requiredOption('--amount <cents>', 'Amount in cents')
  .requiredOption('--currency <currency>', 'Currency code')
  .option('--customer <id>', 'Customer ID')
  .option('--payment-method <id>', 'Payment method ID')
  .option('--capture-method <method>', 'Capture method (automatic, manual)')
  .option('--confirm', 'Confirm the payment intent')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.paymentIntents.create({
        amount: parseInt(opts.amount),
        currency: opts.currency,
        customer: opts.customer,
        payment_method: opts.paymentMethod,
        capture_method: opts.captureMethod,
        confirm: opts.confirm,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Payment intent created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentIntentsCmd
  .command('update <id>')
  .description('Update a payment intent')
  .option('--amount <cents>', 'Amount in cents')
  .option('--customer <id>', 'Customer ID')
  .option('--payment-method <id>', 'Payment method ID')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.paymentIntents.update(id, {
        amount: opts.amount ? parseInt(opts.amount) : undefined,
        customer: opts.customer,
        payment_method: opts.paymentMethod,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Payment intent updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentIntentsCmd
  .command('confirm <id>')
  .description('Confirm a payment intent')
  .option('--payment-method <id>', 'Payment method ID')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.paymentIntents.confirm(id, {
        payment_method: opts.paymentMethod,
      });
      success('Payment intent confirmed');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentIntentsCmd
  .command('cancel <id>')
  .description('Cancel a payment intent')
  .option('--reason <reason>', 'Cancellation reason (abandoned, duplicate, fraudulent, requested_by_customer)')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.paymentIntents.cancel(id, {
        cancellation_reason: opts.reason,
      });
      success('Payment intent canceled');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentIntentsCmd
  .command('capture <id>')
  .description('Capture a payment intent')
  .option('--amount-to-capture <cents>', 'Amount to capture in cents')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.paymentIntents.capture(id, {
        amount_to_capture: opts.amountToCapture ? parseInt(opts.amountToCapture) : undefined,
      });
      success('Payment intent captured');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentIntentsCmd
  .command('search')
  .description('Search payment intents')
  .requiredOption('-q, --query <query>', 'Search query')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.paymentIntents.search(opts.query, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Payment Methods Commands
// ============================================
const paymentMethodsCmd = program
  .command('payment-methods')
  .description('Manage payment methods');

paymentMethodsCmd
  .command('list')
  .description('List payment methods for a customer')
  .requiredOption('--customer <id>', 'Customer ID')
  .requiredOption('--type <type>', 'Payment method type (card, us_bank_account, etc.)')
  .option('-l, --limit <number>', 'Maximum number of payment methods', '10')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.paymentMethods.list({
        customer: opts.customer,
        type: opts.type,
        limit: parseInt(opts.limit),
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentMethodsCmd
  .command('get <id>')
  .description('Get a payment method by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.paymentMethods.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentMethodsCmd
  .command('attach <id>')
  .description('Attach a payment method to a customer')
  .requiredOption('--customer <id>', 'Customer ID')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.paymentMethods.attach(id, {
        customer: opts.customer,
      });
      success('Payment method attached');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentMethodsCmd
  .command('detach <id>')
  .description('Detach a payment method from a customer')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.paymentMethods.detach(id);
      success('Payment method detached');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Charges Commands
// ============================================
const chargesCmd = program
  .command('charges')
  .description('Manage charges');

chargesCmd
  .command('list')
  .description('List all charges')
  .option('-l, --limit <number>', 'Maximum number of charges', '10')
  .option('--customer <id>', 'Filter by customer ID')
  .option('--payment-intent <id>', 'Filter by payment intent ID')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.charges.list({
        limit: parseInt(opts.limit),
        customer: opts.customer,
        payment_intent: opts.paymentIntent,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chargesCmd
  .command('get <id>')
  .description('Get a charge by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.charges.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chargesCmd
  .command('create')
  .description('Create a charge')
  .requiredOption('--amount <cents>', 'Amount in cents')
  .requiredOption('--currency <currency>', 'Currency code')
  .option('--customer <id>', 'Customer ID')
  .option('--source <id>', 'Source ID (card, bank account)')
  .option('--capture <boolean>', 'Capture the charge', 'true')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.charges.create({
        amount: parseInt(opts.amount),
        currency: opts.currency,
        customer: opts.customer,
        source: opts.source,
        capture: opts.capture === 'true',
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Charge created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chargesCmd
  .command('update <id>')
  .description('Update a charge')
  .option('--customer <id>', 'Customer ID')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.charges.update(id, {
        customer: opts.customer,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Charge updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chargesCmd
  .command('capture <id>')
  .description('Capture an uncaptured charge')
  .option('--amount <cents>', 'Amount to capture in cents')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.charges.capture(id, {
        amount: opts.amount ? parseInt(opts.amount) : undefined,
      });
      success('Charge captured');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chargesCmd
  .command('search')
  .description('Search charges')
  .requiredOption('-q, --query <query>', 'Search query')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.charges.search(opts.query, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Invoices Commands
// ============================================
const invoicesCmd = program
  .command('invoices')
  .description('Manage invoices');

invoicesCmd
  .command('list')
  .description('List all invoices')
  .option('-l, --limit <number>', 'Maximum number of invoices', '10')
  .option('--customer <id>', 'Filter by customer ID')
  .option('--subscription <id>', 'Filter by subscription ID')
  .option('--status <status>', 'Filter by status (draft, open, paid, uncollectible, void)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.invoices.list({
        limit: parseInt(opts.limit),
        customer: opts.customer,
        subscription: opts.subscription,
        status: opts.status,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('get <id>')
  .description('Get an invoice by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.invoices.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('create')
  .description('Create an invoice')
  .option('--customer <id>', 'Customer ID')
  .option('--auto-advance <boolean>', 'Auto-finalize the invoice')
  .option('--collection-method <method>', 'Collection method (charge_automatically, send_invoice)')
  .option('--days-until-due <days>', 'Days until due (for send_invoice)')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.invoices.create({
        customer: opts.customer,
        auto_advance: opts.autoAdvance === 'true' ? true : opts.autoAdvance === 'false' ? false : undefined,
        collection_method: opts.collectionMethod,
        days_until_due: opts.daysUntilDue ? parseInt(opts.daysUntilDue) : undefined,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Invoice created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('update <id>')
  .description('Update an invoice')
  .option('--auto-advance <boolean>', 'Auto-finalize the invoice')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.invoices.update(id, {
        auto_advance: opts.autoAdvance === 'true' ? true : opts.autoAdvance === 'false' ? false : undefined,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Invoice updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('delete <id>')
  .description('Delete a draft invoice')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.invoices.del(id);
      success('Invoice deleted');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('finalize <id>')
  .description('Finalize a draft invoice')
  .option('--auto-advance <boolean>', 'Auto-advance to send')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.invoices.finalize(id, {
        auto_advance: opts.autoAdvance === 'true' ? true : opts.autoAdvance === 'false' ? false : undefined,
      });
      success('Invoice finalized');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('pay <id>')
  .description('Pay an invoice')
  .option('--payment-method <id>', 'Payment method ID')
  .option('--forgive', 'Forgive any uncollectible invoice items')
  .option('--off-session', 'Use off-session confirmation')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.invoices.pay(id, {
        payment_method: opts.paymentMethod,
        forgive: opts.forgive,
        off_session: opts.offSession,
      });
      success('Invoice paid');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('send <id>')
  .description('Send an invoice to customer')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.invoices.send(id);
      success('Invoice sent');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('void <id>')
  .description('Void an invoice')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.invoices.void(id);
      success('Invoice voided');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('mark-uncollectible <id>')
  .description('Mark an invoice as uncollectible')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.invoices.markUncollectible(id);
      success('Invoice marked as uncollectible');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('search')
  .description('Search invoices')
  .requiredOption('-q, --query <query>', 'Search query')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.invoices.search(opts.query, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Invoice Items Commands
// ============================================
const invoiceItemsCmd = program
  .command('invoice-items')
  .description('Manage invoice items');

invoiceItemsCmd
  .command('list')
  .description('List all invoice items')
  .option('-l, --limit <number>', 'Maximum number of items', '10')
  .option('--customer <id>', 'Filter by customer ID')
  .option('--invoice <id>', 'Filter by invoice ID')
  .option('--pending', 'Only show pending items')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.invoiceItems.list({
        limit: parseInt(opts.limit),
        customer: opts.customer,
        invoice: opts.invoice,
        pending: opts.pending,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoiceItemsCmd
  .command('get <id>')
  .description('Get an invoice item by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.invoiceItems.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoiceItemsCmd
  .command('create')
  .description('Create an invoice item')
  .requiredOption('--customer <id>', 'Customer ID')
  .option('--amount <cents>', 'Amount in cents')
  .option('--currency <currency>', 'Currency code')
  .option('--price <id>', 'Price ID')
  .option('--quantity <number>', 'Quantity')
  .option('--invoice <id>', 'Invoice ID to add item to')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.invoiceItems.create({
        customer: opts.customer,
        amount: opts.amount ? parseInt(opts.amount) : undefined,
        currency: opts.currency,
        price: opts.price,
        quantity: opts.quantity ? parseInt(opts.quantity) : undefined,
        invoice: opts.invoice,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Invoice item created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoiceItemsCmd
  .command('update <id>')
  .description('Update an invoice item')
  .option('--amount <cents>', 'Amount in cents')
  .option('--quantity <number>', 'Quantity')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.invoiceItems.update(id, {
        amount: opts.amount ? parseInt(opts.amount) : undefined,
        quantity: opts.quantity ? parseInt(opts.quantity) : undefined,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Invoice item updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoiceItemsCmd
  .command('delete <id>')
  .description('Delete an invoice item')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.invoiceItems.del(id);
      success('Invoice item deleted');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Coupons Commands
// ============================================
const couponsCmd = program
  .command('coupons')
  .description('Manage coupons');

couponsCmd
  .command('list')
  .description('List all coupons')
  .option('-l, --limit <number>', 'Maximum number of coupons', '10')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.coupons.list({
        limit: parseInt(opts.limit),
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

couponsCmd
  .command('get <id>')
  .description('Get a coupon by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.coupons.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

couponsCmd
  .command('create')
  .description('Create a coupon')
  .requiredOption('--duration <duration>', 'Duration (forever, once, repeating)')
  .option('--id <id>', 'Custom coupon ID')
  .option('--percent-off <percent>', 'Percent off (0-100)')
  .option('--amount-off <cents>', 'Amount off in cents')
  .option('--currency <currency>', 'Currency for amount off')
  .option('--duration-in-months <months>', 'Duration in months (for repeating)')
  .option('--max-redemptions <number>', 'Maximum redemptions')
  .option('-n, --name <name>', 'Coupon name')
  .option('--redeem-by <timestamp>', 'Redeem by timestamp')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.coupons.create({
        duration: opts.duration as 'forever' | 'once' | 'repeating',
        id: opts.id,
        percent_off: opts.percentOff ? parseFloat(opts.percentOff) : undefined,
        amount_off: opts.amountOff ? parseInt(opts.amountOff) : undefined,
        currency: opts.currency,
        duration_in_months: opts.durationInMonths ? parseInt(opts.durationInMonths) : undefined,
        max_redemptions: opts.maxRedemptions ? parseInt(opts.maxRedemptions) : undefined,
        name: opts.name,
        redeem_by: opts.redeemBy ? parseInt(opts.redeemBy) : undefined,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Coupon created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

couponsCmd
  .command('update <id>')
  .description('Update a coupon')
  .option('-n, --name <name>', 'Coupon name')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.coupons.update(id, {
        name: opts.name,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Coupon updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

couponsCmd
  .command('delete <id>')
  .description('Delete a coupon')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.coupons.del(id);
      success('Coupon deleted');
      print(result, getFormat(this));
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
  .description('View events');

eventsCmd
  .command('list')
  .description('List all events')
  .option('-l, --limit <number>', 'Maximum number of events', '10')
  .option('--type <type>', 'Filter by event type (e.g., invoice.paid)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.events.list({
        limit: parseInt(opts.limit),
        type: opts.type,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('get <id>')
  .description('Get an event by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.events.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Webhooks Commands
// ============================================
const webhooksCmd = program
  .command('webhooks')
  .description('Manage webhook endpoints');

webhooksCmd
  .command('list')
  .description('List all webhook endpoints')
  .option('-l, --limit <number>', 'Maximum number of endpoints', '10')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.webhooks.list({
        limit: parseInt(opts.limit),
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('get <id>')
  .description('Get a webhook endpoint by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.webhooks.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a webhook endpoint')
  .requiredOption('--url <url>', 'Webhook endpoint URL')
  .requiredOption('--events <events>', 'Comma-separated list of events (e.g., invoice.paid,customer.created)')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.webhooks.create({
        url: opts.url,
        enabled_events: opts.events.split(',').map((e: string) => e.trim()),
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Webhook endpoint created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('update <id>')
  .description('Update a webhook endpoint')
  .option('--url <url>', 'Webhook endpoint URL')
  .option('--events <events>', 'Comma-separated list of events')
  .option('--disabled <boolean>', 'Disable the webhook')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.webhooks.update(id, {
        url: opts.url,
        enabled_events: opts.events ? opts.events.split(',').map((e: string) => e.trim()) : undefined,
        disabled: opts.disabled === 'true' ? true : opts.disabled === 'false' ? false : undefined,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Webhook endpoint updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <id>')
  .description('Delete a webhook endpoint')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.webhooks.del(id);
      success('Webhook endpoint deleted');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Checkout Sessions Commands
// ============================================
const checkoutCmd = program
  .command('checkout')
  .description('Manage checkout sessions (generate payment links)');

checkoutCmd
  .command('create')
  .description('Create a checkout session and get payment URL')
  .requiredOption('--mode <mode>', 'Session mode (payment, subscription, setup)')
  .option('--price <id>', 'Price ID for line item')
  .option('--quantity <number>', 'Quantity', '1')
  .option('--customer <id>', 'Customer ID')
  .option('--customer-email <email>', 'Customer email')
  .option('--success-url <url>', 'Redirect URL after success')
  .option('--cancel-url <url>', 'Redirect URL on cancel')
  .option('--allow-promotion-codes', 'Allow promotion codes')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.checkoutSessions.create({
        mode: opts.mode as 'payment' | 'subscription' | 'setup',
        line_items: opts.price ? [{ price: opts.price, quantity: parseInt(opts.quantity) }] : undefined,
        customer: opts.customer,
        customer_email: opts.customerEmail,
        success_url: opts.successUrl,
        cancel_url: opts.cancelUrl,
        allow_promotion_codes: opts.allowPromotionCodes,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Checkout session created');
      if (result.url) {
        info(`Payment URL: ${result.url}`);
      }
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checkoutCmd
  .command('get <id>')
  .description('Get a checkout session by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.checkoutSessions.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checkoutCmd
  .command('list')
  .description('List all checkout sessions')
  .option('-l, --limit <number>', 'Maximum number of sessions', '10')
  .option('--customer <id>', 'Filter by customer ID')
  .option('--status <status>', 'Filter by status (open, complete, expired)')
  .option('--payment-intent <id>', 'Filter by payment intent ID')
  .option('--subscription <id>', 'Filter by subscription ID')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.checkoutSessions.list({
        limit: parseInt(opts.limit),
        customer: opts.customer,
        status: opts.status,
        payment_intent: opts.paymentIntent,
        subscription: opts.subscription,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checkoutCmd
  .command('expire <id>')
  .description('Expire an open checkout session')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.checkoutSessions.expire(id);
      success('Checkout session expired');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Payment Links Commands
// ============================================
const paymentLinksCmd = program
  .command('payment-links')
  .description('Manage reusable payment links');

paymentLinksCmd
  .command('create')
  .description('Create a reusable payment link')
  .requiredOption('--price <id>', 'Price ID')
  .option('--quantity <number>', 'Quantity', '1')
  .option('--allow-promotion-codes', 'Allow promotion codes')
  .option('--after-completion-type <type>', 'After completion type (hosted_confirmation, redirect)')
  .option('--after-completion-url <url>', 'Redirect URL after completion')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.paymentLinks.create({
        line_items: [{ price: opts.price, quantity: parseInt(opts.quantity) }],
        allow_promotion_codes: opts.allowPromotionCodes,
        after_completion: opts.afterCompletionType ? {
          type: opts.afterCompletionType as 'hosted_confirmation' | 'redirect',
          redirect: opts.afterCompletionUrl ? { url: opts.afterCompletionUrl } : undefined,
        } : undefined,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Payment link created');
      info(`Payment URL: ${result.url}`);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentLinksCmd
  .command('get <id>')
  .description('Get a payment link by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.paymentLinks.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentLinksCmd
  .command('list')
  .description('List all payment links')
  .option('-l, --limit <number>', 'Maximum number of links', '10')
  .option('--active <boolean>', 'Filter by active status')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.paymentLinks.list({
        limit: parseInt(opts.limit),
        active: opts.active === 'true' ? true : opts.active === 'false' ? false : undefined,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentLinksCmd
  .command('update <id>')
  .description('Update a payment link')
  .option('--active <boolean>', 'Set active status (false to deactivate)')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.paymentLinks.update(id, {
        active: opts.active === 'true' ? true : opts.active === 'false' ? false : undefined,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Payment link updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentLinksCmd
  .command('deactivate <id>')
  .description('Deactivate a payment link')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.paymentLinks.update(id, { active: false });
      success('Payment link deactivated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Billing Portal Commands
// ============================================
const billingPortalCmd = program
  .command('billing-portal')
  .description('Manage customer billing portal');

billingPortalCmd
  .command('create-session')
  .description('Create a billing portal session URL for a customer')
  .requiredOption('--customer <id>', 'Customer ID')
  .option('--return-url <url>', 'URL to return to after portal')
  .option('--configuration <id>', 'Portal configuration ID')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.billingPortal.createSession({
        customer: opts.customer,
        return_url: opts.returnUrl,
        configuration: opts.configuration,
      });
      success('Billing portal session created');
      info(`Portal URL: ${result.url}`);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

billingPortalCmd
  .command('list-configurations')
  .description('List billing portal configurations')
  .option('-l, --limit <number>', 'Maximum number of configurations', '10')
  .option('--active <boolean>', 'Filter by active status')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.billingPortal.listConfigurations({
        limit: parseInt(opts.limit),
        active: opts.active === 'true' ? true : opts.active === 'false' ? false : undefined,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

billingPortalCmd
  .command('get-configuration <id>')
  .description('Get a billing portal configuration')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.billingPortal.getConfiguration(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
