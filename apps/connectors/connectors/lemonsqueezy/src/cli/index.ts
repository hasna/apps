#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { LemonSqueezy } from '../api';
import {
  getApiKey,
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
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-lemonsqueezy';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Lemon Squeezy connector - Digital products, subscriptions, and license keys')
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
      process.env.LEMONSQUEEZY_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): LemonSqueezy {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set LEMONSQUEEZY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new LemonSqueezy({ apiKey });
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

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
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
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
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
  .command('user')
  .description('User information');

userCmd
  .command('me')
  .description('Get authenticated user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getAuthenticatedUser();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Store Commands
// ============================================
const storeCmd = program
  .command('store')
  .description('Store management');

storeCmd
  .command('list')
  .description('List all stores')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listStores({
        page: opts.page ? parseInt(opts.page) : undefined,
        perPage: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(storeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

storeCmd
  .command('get <id>')
  .description('Get a store by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getStore(id);
      print(result, getFormat(storeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Product Commands
// ============================================
const productCmd = program
  .command('product')
  .description('Product management');

productCmd
  .command('list')
  .description('List all products')
  .option('--store-id <id>', 'Filter by store ID')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listProducts({
        storeId: opts.storeId,
        page: opts.page ? parseInt(opts.page) : undefined,
        perPage: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(productCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

productCmd
  .command('get <id>')
  .description('Get a product by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getProduct(id);
      print(result, getFormat(productCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Variant Commands
// ============================================
const variantCmd = program
  .command('variant')
  .description('Variant management');

variantCmd
  .command('list')
  .description('List all variants')
  .option('--product-id <id>', 'Filter by product ID')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listVariants({
        productId: opts.productId,
        page: opts.page ? parseInt(opts.page) : undefined,
        perPage: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(variantCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

variantCmd
  .command('get <id>')
  .description('Get a variant by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getVariant(id);
      print(result, getFormat(variantCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Order Commands
// ============================================
const orderCmd = program
  .command('order')
  .description('Order management');

orderCmd
  .command('list')
  .description('List all orders')
  .option('--store-id <id>', 'Filter by store ID')
  .option('--user-email <email>', 'Filter by user email')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listOrders({
        storeId: opts.storeId,
        userEmail: opts.userEmail,
        page: opts.page ? parseInt(opts.page) : undefined,
        perPage: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(orderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orderCmd
  .command('get <id>')
  .description('Get an order by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getOrder(id);
      print(result, getFormat(orderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Subscription Commands
// ============================================
const subscriptionCmd = program
  .command('subscription')
  .description('Subscription management');

subscriptionCmd
  .command('list')
  .description('List all subscriptions')
  .option('--store-id <id>', 'Filter by store ID')
  .option('--order-id <id>', 'Filter by order ID')
  .option('--product-id <id>', 'Filter by product ID')
  .option('--status <status>', 'Filter by status')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSubscriptions({
        storeId: opts.storeId,
        orderId: opts.orderId,
        productId: opts.productId,
        status: opts.status,
        page: opts.page ? parseInt(opts.page) : undefined,
        perPage: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(subscriptionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionCmd
  .command('get <id>')
  .description('Get a subscription by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getSubscription(id);
      print(result, getFormat(subscriptionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionCmd
  .command('cancel <id>')
  .description('Cancel a subscription')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.cancelSubscription(id);
      success('Subscription cancelled');
      print(result, getFormat(subscriptionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionCmd
  .command('pause <id>')
  .description('Pause a subscription')
  .option('--mode <mode>', 'Pause mode (void or free)', 'void')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.pauseSubscription(id, opts.mode as 'void' | 'free');
      success('Subscription paused');
      print(result, getFormat(subscriptionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionCmd
  .command('resume <id>')
  .description('Resume a paused subscription')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.resumeSubscription(id);
      success('Subscription resumed');
      print(result, getFormat(subscriptionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Customer Commands
// ============================================
const customerCmd = program
  .command('customer')
  .description('Customer management');

customerCmd
  .command('list')
  .description('List all customers')
  .option('--store-id <id>', 'Filter by store ID')
  .option('--email <email>', 'Filter by email')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listCustomers({
        storeId: opts.storeId,
        email: opts.email,
        page: opts.page ? parseInt(opts.page) : undefined,
        perPage: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(customerCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customerCmd
  .command('get <id>')
  .description('Get a customer by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getCustomer(id);
      print(result, getFormat(customerCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// License Key Commands
// ============================================
const licenseCmd = program
  .command('license')
  .description('License key management');

licenseCmd
  .command('list')
  .description('List all license keys')
  .option('--store-id <id>', 'Filter by store ID')
  .option('--order-id <id>', 'Filter by order ID')
  .option('--product-id <id>', 'Filter by product ID')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listLicenseKeys({
        storeId: opts.storeId,
        orderId: opts.orderId,
        productId: opts.productId,
        page: opts.page ? parseInt(opts.page) : undefined,
        perPage: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(licenseCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

licenseCmd
  .command('get <id>')
  .description('Get a license key by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getLicenseKey(id);
      print(result, getFormat(licenseCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Discount Commands
// ============================================
const discountCmd = program
  .command('discount')
  .description('Discount management');

discountCmd
  .command('list')
  .description('List all discounts')
  .option('--store-id <id>', 'Filter by store ID')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listDiscounts({
        storeId: opts.storeId,
        page: opts.page ? parseInt(opts.page) : undefined,
        perPage: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(discountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

discountCmd
  .command('get <id>')
  .description('Get a discount by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getDiscount(id);
      print(result, getFormat(discountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

discountCmd
  .command('create')
  .description('Create a new discount')
  .requiredOption('--store-id <id>', 'Store ID')
  .requiredOption('--name <name>', 'Discount name')
  .requiredOption('--code <code>', 'Discount code')
  .requiredOption('--amount <amount>', 'Discount amount')
  .requiredOption('--amount-type <type>', 'Amount type (percent or fixed)')
  .option('--duration <duration>', 'Duration (once, repeating, forever)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createDiscount({
        storeId: parseInt(opts.storeId),
        name: opts.name,
        code: opts.code,
        amount: parseInt(opts.amount),
        amountType: opts.amountType as 'percent' | 'fixed',
        duration: opts.duration,
      });
      success('Discount created!');
      print(result, getFormat(discountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

discountCmd
  .command('delete <id>')
  .description('Delete a discount')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteDiscount(id);
      success(`Discount ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Webhook Commands
// ============================================
const webhookCmd = program
  .command('webhook')
  .description('Webhook management');

webhookCmd
  .command('list')
  .description('List all webhooks')
  .option('--store-id <id>', 'Filter by store ID')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listWebhooks({
        storeId: opts.storeId,
        page: opts.page ? parseInt(opts.page) : undefined,
        perPage: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(result, getFormat(webhookCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhookCmd
  .command('get <id>')
  .description('Get a webhook by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getWebhook(id);
      print(result, getFormat(webhookCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhookCmd
  .command('create')
  .description('Create a new webhook')
  .requiredOption('--store-id <id>', 'Store ID')
  .requiredOption('--url <url>', 'Webhook URL')
  .requiredOption('--secret <secret>', 'Webhook secret')
  .requiredOption('--events <events>', 'Comma-separated list of events')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createWebhook({
        storeId: parseInt(opts.storeId),
        url: opts.url,
        secret: opts.secret,
        events: opts.events.split(','),
      });
      success('Webhook created!');
      print(result, getFormat(webhookCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhookCmd
  .command('delete <id>')
  .description('Delete a webhook')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteWebhook(id);
      success(`Webhook ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
