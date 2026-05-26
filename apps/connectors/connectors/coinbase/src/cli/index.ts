#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Coinbase } from '../api';
import {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
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

const CONNECTOR_NAME = 'connect-coinbase';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Coinbase connector - Cryptocurrency accounts, prices, and transactions')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-s, --api-secret <secret>', 'API secret (overrides config)')
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
    // Set API key/secret from flag if provided
    if (opts.apiKey) {
      process.env.COINBASE_API_KEY = opts.apiKey;
    }
    if (opts.apiSecret) {
      process.env.COINBASE_API_SECRET = opts.apiSecret;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Coinbase {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set COINBASE_API_KEY environment variable.`);
    process.exit(1);
  }
  if (!apiSecret) {
    error(`No API secret configured. Run "${CONNECTOR_NAME} config set-secret <secret>" or set COINBASE_API_SECRET environment variable.`);
    process.exit(1);
  }
  return new Coinbase({ apiKey, apiSecret });
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
  .option('--api-secret <secret>', 'API secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      apiSecret: opts.apiSecret,
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
    info(`API Secret: ${config.apiSecret ? `${config.apiSecret.substring(0, 8)}...` : chalk.gray('not set')}`);
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
  .command('set-secret <apiSecret>')
  .description('Set API secret')
  .action((apiSecret: string) => {
    setApiSecret(apiSecret);
    success(`API secret saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Secret: ${apiSecret ? `${apiSecret.substring(0, 8)}...` : chalk.gray('not set')}`);
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
  .description('Manage user information');

userCmd
  .command('me')
  .description('Get current user information')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getCurrentUser();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('get <id>')
  .description('Get user by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getUser(id);
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Account Commands
// ============================================
const accountCmd = program
  .command('account')
  .description('Manage cryptocurrency accounts');

accountCmd
  .command('list')
  .description('List all accounts')
  .option('-l, --limit <number>', 'Maximum results', '25')
  .option('--order <order>', 'Order (asc, desc)', 'desc')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listAccounts({
        limit: parseInt(opts.limit),
        order: opts.order,
      });
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('get <id>')
  .description('Get account by ID')
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
  .command('update <id>')
  .description('Update account name')
  .requiredOption('-n, --name <name>', 'New account name')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.updateAccount(id, opts.name);
      success('Account updated!');
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Address Commands
// ============================================
const addressCmd = program
  .command('address')
  .description('Manage account addresses');

addressCmd
  .command('list <accountId>')
  .description('List addresses for an account')
  .option('-l, --limit <number>', 'Maximum results', '25')
  .action(async (accountId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listAddresses(accountId, {
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(addressCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

addressCmd
  .command('get <accountId> <addressId>')
  .description('Get address by ID')
  .action(async (accountId: string, addressId: string) => {
    try {
      const client = getClient();
      const result = await client.getAddress(accountId, addressId);
      print(result, getFormat(addressCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

addressCmd
  .command('create <accountId>')
  .description('Create new address for an account')
  .option('-n, --name <name>', 'Address label')
  .action(async (accountId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createAddress(accountId, opts.name);
      success('Address created!');
      print(result, getFormat(addressCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Transaction Commands
// ============================================
const transactionCmd = program
  .command('transaction')
  .description('Manage transactions');

transactionCmd
  .command('list <accountId>')
  .description('List transactions for an account')
  .option('-l, --limit <number>', 'Maximum results', '25')
  .option('--order <order>', 'Order (asc, desc)', 'desc')
  .action(async (accountId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listTransactions(accountId, {
        limit: parseInt(opts.limit),
        order: opts.order,
      });
      print(result, getFormat(transactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transactionCmd
  .command('get <accountId> <transactionId>')
  .description('Get transaction by ID')
  .action(async (accountId: string, transactionId: string) => {
    try {
      const client = getClient();
      const result = await client.getTransaction(accountId, transactionId);
      print(result, getFormat(transactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transactionCmd
  .command('send <accountId>')
  .description('Send money')
  .requiredOption('--to <address>', 'Recipient address or email')
  .requiredOption('--amount <amount>', 'Amount to send')
  .requiredOption('--currency <currency>', 'Currency code (e.g., BTC, ETH)')
  .option('--description <text>', 'Transaction description')
  .option('--idem <key>', 'Idempotency key')
  .action(async (accountId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.sendMoney(accountId, {
        type: 'send',
        to: opts.to,
        amount: opts.amount,
        currency: opts.currency,
        description: opts.description,
        idem: opts.idem,
      });
      success('Money sent!');
      print(result, getFormat(transactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Price Commands
// ============================================
const priceCmd = program
  .command('price')
  .description('Get cryptocurrency prices');

priceCmd
  .command('spot <pair>')
  .description('Get spot price for a currency pair (e.g., BTC-USD)')
  .option('--date <date>', 'Historical date (YYYY-MM-DD)')
  .action(async (pair: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getSpotPrice(pair, { date: opts.date });
      print(result, getFormat(priceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

priceCmd
  .command('buy <pair>')
  .description('Get buy price for a currency pair')
  .action(async (pair: string) => {
    try {
      const client = getClient();
      const result = await client.getBuyPrice(pair);
      print(result, getFormat(priceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

priceCmd
  .command('sell <pair>')
  .description('Get sell price for a currency pair')
  .action(async (pair: string) => {
    try {
      const client = getClient();
      const result = await client.getSellPrice(pair);
      print(result, getFormat(priceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Exchange Rate Commands
// ============================================
const rateCmd = program
  .command('rate')
  .description('Get exchange rates');

rateCmd
  .command('get')
  .description('Get exchange rates')
  .option('-c, --currency <code>', 'Base currency (default: USD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.getExchangeRates(opts.currency);
      print(result, getFormat(rateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Currency Commands
// ============================================
const currencyCmd = program
  .command('currency')
  .description('Get currency information');

currencyCmd
  .command('list')
  .description('List supported currencies')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getCurrencies();
      print(result, getFormat(currencyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Time Command
// ============================================
program
  .command('time')
  .description('Get server time')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getTime();
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
