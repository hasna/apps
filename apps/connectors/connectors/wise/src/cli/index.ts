#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Wise, WiseClient } from '../api';
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

const CONNECTOR_NAME = 'connect-wise';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wise connector - International money transfers, multi-currency accounts, and exchange rates')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('--sandbox', 'Use Wise sandbox environment')
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
      process.env.WISE_API_KEY = opts.apiKey;
    }
    // Set sandbox URL if flag provided
    if (opts.sandbox) {
      process.env.WISE_BASE_URL = WiseClient.getSandboxUrl();
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Wise {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WISE_API_KEY environment variable.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new Wise({ apiKey, baseUrl });
}

// ============================================
// Profile Commands (CLI profiles, not Wise profiles)
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all CLI profiles')
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
  .description('Switch to a CLI profile')
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
  .description('Create a new CLI profile')
  .option('--api-key <key>', 'API key')
  .option('--sandbox', 'Use sandbox environment')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      baseUrl: opts.sandbox ? WiseClient.getSandboxUrl() : undefined,
    });
    success(`Profile "${name}" created`);

    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a CLI profile')
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
  .description('Show CLI profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('production (default)')}`);
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
  .command('set-url <baseUrl>')
  .description('Set base URL (use "sandbox" for sandbox environment)')
  .action((baseUrl: string) => {
    const url = baseUrl === 'sandbox' ? WiseClient.getSandboxUrl() : baseUrl;
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
    info(`Base URL: ${baseUrl || 'production (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Wise Profile Commands (Account profiles)
// ============================================
const wiseProfileCmd = program
  .command('wise-profile')
  .description('Manage Wise account profiles (personal/business)');

wiseProfileCmd
  .command('list')
  .description('List Wise account profiles')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listProfiles();
      print(result, getFormat(wiseProfileCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

wiseProfileCmd
  .command('get <id>')
  .description('Get a Wise account profile by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getProfile(parseInt(id));
      print(result, getFormat(wiseProfileCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Balance Commands
// ============================================
const balanceCmd = program
  .command('balance')
  .description('Manage multi-currency balances');

balanceCmd
  .command('list <profileId>')
  .description('List all balances for a profile')
  .option('--types <types>', 'Balance types (comma-separated: STANDARD,SAVINGS)')
  .action(async (profileId: string, opts) => {
    try {
      const client = getClient();
      const types = opts.types ? opts.types.split(',').map((t: string) => t.trim()) : undefined;
      const result = await client.listBalances(parseInt(profileId), types);
      print(result, getFormat(balanceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

balanceCmd
  .command('get <profileId> <balanceId>')
  .description('Get a specific balance')
  .action(async (profileId: string, balanceId: string) => {
    try {
      const client = getClient();
      const result = await client.getBalance(parseInt(profileId), parseInt(balanceId));
      print(result, getFormat(balanceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Quote Commands
// ============================================
const quoteCmd = program
  .command('quote')
  .description('Manage exchange rate quotes');

quoteCmd
  .command('create <profileId>')
  .description('Create a new quote')
  .requiredOption('--source <currency>', 'Source currency (e.g., USD)')
  .requiredOption('--target <currency>', 'Target currency (e.g., EUR)')
  .option('--source-amount <amount>', 'Amount in source currency')
  .option('--target-amount <amount>', 'Amount in target currency')
  .action(async (profileId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createQuote(parseInt(profileId), {
        sourceCurrency: opts.source,
        targetCurrency: opts.target,
        sourceAmount: opts.sourceAmount ? parseFloat(opts.sourceAmount) : undefined,
        targetAmount: opts.targetAmount ? parseFloat(opts.targetAmount) : undefined,
      });
      success('Quote created!');
      print(result, getFormat(quoteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

quoteCmd
  .command('get <profileId> <quoteId>')
  .description('Get a quote by ID')
  .action(async (profileId: string, quoteId: string) => {
    try {
      const client = getClient();
      const result = await client.getQuote(parseInt(profileId), quoteId);
      print(result, getFormat(quoteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Recipient Commands
// ============================================
const recipientCmd = program
  .command('recipient')
  .description('Manage transfer recipients');

recipientCmd
  .command('list <profileId>')
  .description('List all recipients for a profile')
  .option('--currency <currency>', 'Filter by currency')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .action(async (profileId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listRecipients(parseInt(profileId), {
        currency: opts.currency,
        size: parseInt(opts.limit),
      });
      print(result, getFormat(recipientCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recipientCmd
  .command('get <id>')
  .description('Get a recipient by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getRecipient(parseInt(id));
      print(result, getFormat(recipientCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recipientCmd
  .command('delete <id>')
  .description('Delete a recipient')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteRecipient(parseInt(id));
      success(`Recipient ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recipientCmd
  .command('requirements')
  .description('Get required fields for a recipient type')
  .requiredOption('--source <currency>', 'Source currency')
  .requiredOption('--target <currency>', 'Target currency')
  .option('--amount <amount>', 'Source amount')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.getRecipientRequirements({
        source: opts.source,
        target: opts.target,
        sourceAmount: opts.amount ? parseFloat(opts.amount) : undefined,
      });
      print(result, getFormat(recipientCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Transfer Commands
// ============================================
const transferCmd = program
  .command('transfer')
  .description('Manage money transfers');

transferCmd
  .command('list <profileId>')
  .description('List all transfers for a profile')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--offset <number>', 'Offset for pagination')
  .option('--status <status>', 'Filter by status')
  .action(async (profileId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listTransfers(parseInt(profileId), {
        limit: parseInt(opts.limit),
        offset: opts.offset ? parseInt(opts.offset) : undefined,
        status: opts.status,
      });
      print(result, getFormat(transferCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transferCmd
  .command('get <id>')
  .description('Get a transfer by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getTransfer(parseInt(id));
      print(result, getFormat(transferCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transferCmd
  .command('create')
  .description('Create a new transfer')
  .requiredOption('--recipient <id>', 'Target recipient ID')
  .requiredOption('--quote <uuid>', 'Quote UUID')
  .requiredOption('--transaction-id <id>', 'Customer transaction ID (for idempotency)')
  .option('--reference <text>', 'Payment reference')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createTransfer({
        targetAccount: parseInt(opts.recipient),
        quoteUuid: opts.quote,
        customerTransactionId: opts.transactionId,
        details: opts.reference ? { reference: opts.reference } : undefined,
      });
      success('Transfer created!');
      print(result, getFormat(transferCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transferCmd
  .command('fund <profileId> <transferId>')
  .description('Fund a transfer from balance')
  .action(async (profileId: string, transferId: string) => {
    try {
      const client = getClient();
      const result = await client.fundTransfer(parseInt(profileId), parseInt(transferId));
      success('Transfer funded!');
      print(result, getFormat(transferCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transferCmd
  .command('cancel <id>')
  .description('Cancel a transfer')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.cancelTransfer(parseInt(id));
      success('Transfer cancelled!');
      print(result, getFormat(transferCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Rate Commands
// ============================================
const rateCmd = program
  .command('rate')
  .description('Get exchange rates');

rateCmd
  .command('get <source> <target>')
  .description('Get live exchange rate')
  .action(async (source: string, target: string) => {
    try {
      const client = getClient();
      const result = await client.getExchangeRate(source, target);
      print(result, getFormat(rateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

rateCmd
  .command('history <source> <target>')
  .description('Get historical exchange rates')
  .option('--from <date>', 'Start date (ISO 8601)')
  .option('--to <date>', 'End date (ISO 8601)')
  .option('--group <interval>', 'Grouping interval (day, hour, minute)')
  .action(async (source: string, target: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getHistoricalRates(source, target, {
        from: opts.from,
        to: opts.to,
        group: opts.group,
      });
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
  .description('Get available currencies');

currencyCmd
  .command('list')
  .description('List all available currencies')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listCurrencies();
      print(result, getFormat(currencyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

currencyCmd
  .command('pairs <source>')
  .description('Get currency pairs for a source currency')
  .action(async (source: string) => {
    try {
      const client = getClient();
      const result = await client.getCurrencyPairs(source);
      print(result, getFormat(currencyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
