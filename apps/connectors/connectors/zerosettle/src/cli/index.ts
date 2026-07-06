#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZeroSettle } from '../api';
import {
  getPublishableKey,
  setPublishableKey,
  getBaseUrl,
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
import { success, error, info, print, parseJsonBody } from '../utils/output';
import type { HttpMethod } from '../types';

const CONNECTOR_NAME = 'connect-zerosettle';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('ZeroSettle connector - Direct in-app purchase billing API')
  .version(VERSION)
  .option('-k, --publishable-key <key>', 'Publishable API key (overrides config)')
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
    if (opts.publishableKey) {
      process.env.ZEROSETTLE_PUBLISHABLE_KEY = opts.publishableKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const root = cmd.parent ?? cmd;
  return (root.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZeroSettle {
  const publishableKey = getPublishableKey();
  if (!publishableKey) {
    error(
      `No publishable key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ZEROSETTLE_PUBLISHABLE_KEY.`,
    );
    process.exit(1);
  }
  return new ZeroSettle({ publishableKey, baseUrl: getBaseUrl() });
}

function getProfileKeyPreview(config: { publishableKey?: string; apiKey?: string }): string | undefined {
  const key = config.publishableKey || config.apiKey;
  return key ? `${key.substring(0, 8)}...` : undefined;
}

function bodyFromOptions(opts: Record<string, unknown>, exclude: string[] = []): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (exclude.includes(key) || value === undefined) {
      continue;
    }
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    body[snakeKey] = value;
  }
  if (opts.body) {
    Object.assign(body, parseJsonBody(String(opts.body), '--body'));
  }
  return body;
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
      error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--publishable-key <key>', 'Publishable API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { publishableKey: opts.publishableKey });
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
    if (!deleteProfile(name)) {
      error(`Profile "${name}" not found`);
      process.exit(1);
    }
    success(`Profile "${name}" deleted`);
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();
    const keyPreview = getProfileKeyPreview(config);
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Publishable key: ${keyPreview || chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <publishableKey>')
  .description('Set publishable API key')
  .action((publishableKey: string) => {
    setPublishableKey(publishableKey);
    success(`Publishable key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const publishableKey = getPublishableKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Base URL: ${getBaseUrl()}`);
    info(`Publishable key: ${publishableKey ? `${publishableKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const productsCmd = program.command('products').description('IAP product catalog');

productsCmd
  .command('list')
  .description('List available IAP products')
  .option('--user-id <userId>', 'Filter by user ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.getProducts(opts.userId ? { user_id: opts.userId } : undefined);
      print(result, getFormat(productsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const paymentIntentCmd = program.command('payment-intent').description('Payment intents');

paymentIntentCmd
  .command('create')
  .description('Create a payment intent')
  .option('--product-id <productId>', 'Product ID')
  .option('--user-id <userId>', 'User ID')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createPaymentIntent(bodyFromOptions(opts, ['body']));
      print(result, getFormat(paymentIntentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const checkoutCmd = program.command('checkout-session').description('Hosted checkout sessions');

checkoutCmd
  .command('create')
  .description('Create a checkout session')
  .option('--product-id <productId>', 'Product ID')
  .option('--user-id <userId>', 'User ID')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createCheckoutSession(bodyFromOptions(opts, ['body']));
      print(result, getFormat(checkoutCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const transactionCmd = program.command('transaction').description('IAP transactions');

transactionCmd
  .command('get <transactionId>')
  .description('Get a transaction by ID')
  .action(async (transactionId: string) => {
    try {
      const client = getClient();
      const result = await client.getTransaction(transactionId);
      print(result, getFormat(transactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const entitlementsCmd = program.command('entitlements').description('User entitlements');

entitlementsCmd
  .command('list')
  .description('List entitlements')
  .option('--user-id <userId>', 'Filter by user ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.getEntitlements(opts.userId ? { user_id: opts.userId } : undefined);
      print(result, getFormat(entitlementsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const restoreCmd = program.command('restore').description('Restore purchases');

restoreCmd
  .command('run')
  .description('Restore purchases for a user')
  .option('--user-id <userId>', 'User ID')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.restorePurchases(bodyFromOptions(opts, ['body']));
      print(result, getFormat(restoreCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const subscriptionCmd = program.command('subscription').description('IAP subscriptions');

subscriptionCmd
  .command('cancel <subscriptionId>')
  .description('Cancel a subscription')
  .option('--reason <reason>', 'Cancellation reason')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (subscriptionId: string, opts) => {
    try {
      const client = getClient();
      const body = bodyFromOptions(opts, ['body']);
      const result = await client.cancelSubscription(subscriptionId, Object.keys(body).length ? body : undefined);
      print(result, getFormat(subscriptionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventCmd = program.command('event').description('IAP analytics events');

eventCmd
  .command('track')
  .description('Track an IAP event')
  .option('--event <event>', 'Event name')
  .option('--user-id <userId>', 'User ID')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.trackEvent(bodyFromOptions(opts, ['body']));
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'Request path (e.g. /v1/iap/products/)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const query = parseJsonBody(opts.query, '--query') as Record<string, string | number | boolean | undefined> | undefined;
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method as HttpMethod,
        query,
        body: parseJsonBody(opts.body, '--body'),
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
