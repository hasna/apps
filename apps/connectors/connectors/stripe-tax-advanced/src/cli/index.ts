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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-stripe-tax-advanced';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Tax API connector CLI — calculations, transactions, registrations, settings')
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
      process.env.STRIPE_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_API_KEY.`);
    process.exit(1);
  }
  return new Connector({ apiKey, accountId: getAccountId() });
}

function parseJsonOption(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
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
      error(`Profile "${name}" does not exist.`);
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
    info(`API key: ${config.apiKey ? `${config.apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <key>')
  .description('Set Stripe API key')
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-account <accountId>')
  .description('Set Stripe account ID (required for org API keys)')
  .action((accountId: string) => {
    setAccountId(accountId);
    success(`Account ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const config = loadProfile();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API key: ${config.apiKey ? `${config.apiKey.substring(0, 6)}...` : chalk.gray('not set')}`);
    info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Calculations
const calcCmd = program.command('calculations').description('Tax calculation operations');

calcCmd
  .command('create')
  .description('Create a tax calculation')
  .requiredOption('--currency <currency>', 'Three-letter ISO currency code')
  .requiredOption('--line-items <json>', 'JSON array of line items')
  .option('--customer <id>', 'Stripe customer ID')
  .option('--customer-details <json>', 'Customer details JSON')
  .action(async function (this: Command, opts) {
    const client = getClient();
    const lineItems = parseJsonOption(opts.lineItems, '--line-items');
    const body: Record<string, unknown> = {
      currency: opts.currency,
      line_items: lineItems,
    };
    if (opts.customer) body.customer = opts.customer;
    if (opts.customerDetails) body.customer_details = parseJsonOption(opts.customerDetails, '--customer-details');
    const result = await client.calculations.create(body as never);
    print(result, getFormat(this));
  });

calcCmd
  .command('get <id>')
  .description('Retrieve a tax calculation')
  .action(async function (this: Command, id: string) {
    const client = getClient();
    print(await client.calculations.get(id), getFormat(this));
  });

calcCmd
  .command('line-items <id>')
  .description('List line items for a tax calculation')
  .option('--limit <n>', 'Limit', (v) => parseInt(v, 10))
  .action(async function (this: Command, id: string, opts) {
    const client = getClient();
    print(await client.calculations.listLineItems(id, { limit: opts.limit }), getFormat(this));
  });

// Transactions
const txCmd = program.command('transactions').description('Tax transaction operations');

txCmd
  .command('create-from-calculation')
  .description('Create a tax transaction from a calculation')
  .requiredOption('--calculation <id>', 'Tax calculation ID')
  .requiredOption('--reference <ref>', 'Unique reference for the transaction')
  .option('--metadata <json>', 'Metadata JSON object')
  .action(async function (this: Command, opts) {
    const client = getClient();
    const body: Record<string, unknown> = {
      calculation: opts.calculation,
      reference: opts.reference,
    };
    if (opts.metadata) body.metadata = parseJsonOption(opts.metadata, '--metadata');
    print(await client.transactions.createFromCalculation(body as never), getFormat(this));
  });

txCmd
  .command('create-reversal')
  .description('Create a tax transaction reversal')
  .requiredOption('--mode <mode>', 'Reversal mode: full or partial')
  .requiredOption('--original-transaction <id>', 'Original transaction ID')
  .requiredOption('--reference <ref>', 'Unique reference for the reversal')
  .option('--flat-amount <n>', 'Flat amount for partial reversal', (v) => parseInt(v, 10))
  .action(async function (this: Command, opts) {
    const client = getClient();
    const body: Record<string, unknown> = {
      mode: opts.mode,
      original_transaction: opts.originalTransaction,
      reference: opts.reference,
    };
    if (opts.flatAmount !== undefined) body.flat_amount = opts.flatAmount;
    print(await client.transactions.createReversal(body as never), getFormat(this));
  });

txCmd
  .command('get <id>')
  .description('Retrieve a tax transaction')
  .action(async function (this: Command, id: string) {
    const client = getClient();
    print(await client.transactions.get(id), getFormat(this));
  });

txCmd
  .command('line-items <id>')
  .description('List line items for a tax transaction')
  .option('--limit <n>', 'Limit', (v) => parseInt(v, 10))
  .action(async function (this: Command, id: string, opts) {
    const client = getClient();
    print(await client.transactions.listLineItems(id, { limit: opts.limit }), getFormat(this));
  });

// Registrations
const regCmd = program.command('registrations').description('Tax registration operations');

regCmd
  .command('create')
  .description('Create a tax registration')
  .requiredOption('--country <code>', 'Two-letter country code')
  .option('--active-from <value>', 'Active from timestamp or "now"')
  .option('--expires-at <n>', 'Expiration timestamp', (v) => parseInt(v, 10))
  .option('--country-options <json>', 'Country-specific options JSON')
  .action(async function (this: Command, opts) {
    const client = getClient();
    const body: Record<string, unknown> = { country: opts.country };
    if (opts.activeFrom) {
      body.active_from = opts.activeFrom === 'now' ? 'now' : parseInt(opts.activeFrom, 10);
    }
    if (opts.expiresAt !== undefined) body.expires_at = opts.expiresAt;
    if (opts.countryOptions) body.country_options = parseJsonOption(opts.countryOptions, '--country-options');
    print(await client.registrations.create(body as never), getFormat(this));
  });

regCmd
  .command('list')
  .description('List tax registrations')
  .option('--limit <n>', 'Limit', (v) => parseInt(v, 10))
  .option('--status <status>', 'Filter by status')
  .action(async function (this: Command, opts) {
    const client = getClient();
    print(await client.registrations.list({ limit: opts.limit, status: opts.status }), getFormat(this));
  });

regCmd
  .command('get <id>')
  .description('Retrieve a tax registration')
  .action(async function (this: Command, id: string) {
    const client = getClient();
    print(await client.registrations.get(id), getFormat(this));
  });

regCmd
  .command('update <id>')
  .description('Update a tax registration')
  .option('--active-from <n>', 'Active from timestamp', (v) => parseInt(v, 10))
  .option('--expires-at <n>', 'Expiration timestamp', (v) => parseInt(v, 10))
  .action(async function (this: Command, id: string, opts) {
    const client = getClient();
    const body: Record<string, unknown> = {};
    if (opts.activeFrom !== undefined) body.active_from = opts.activeFrom;
    if (opts.expiresAt !== undefined) body.expires_at = opts.expiresAt;
    print(await client.registrations.update(id, body as never), getFormat(this));
  });

// Settings
const settingsCmd = program.command('settings').description('Tax settings operations');

settingsCmd
  .command('get')
  .description('Retrieve tax settings')
  .action(async function (this: Command) {
    const client = getClient();
    print(await client.settings.get(), getFormat(this));
  });

settingsCmd
  .command('update')
  .description('Update tax settings')
  .option('--defaults <json>', 'Defaults JSON object')
  .option('--head-office <json>', 'Head office JSON object')
  .action(async function (this: Command, opts) {
    const client = getClient();
    const body: Record<string, unknown> = {};
    if (opts.defaults) body.defaults = parseJsonOption(opts.defaults, '--defaults');
    if (opts.headOffice) body.head_office = parseJsonOption(opts.headOffice, '--head-office');
    print(await client.settings.update(body as never), getFormat(this));
  });

program.parse();
