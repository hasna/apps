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

// Stripe Treasury connector name and version
const CONNECTOR_NAME = 'connect-stripetreasury';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Treasury API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-a, --account <accountId>', 'Connected account ID (Stripe-Account header)')
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
    if (opts.account) {
      process.env.STRIPE_ACCOUNT_ID = opts.account;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get an authenticated client
function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_API_KEY environment variable.`);
    process.exit(1);
  }
  const accountId = getAccountId();
  return new Connector({ apiKey, accountId });
}

// Parse an optional JSON metadata flag
function parseMetadata(value?: string): Record<string, string> | undefined {
  return value ? JSON.parse(value) : undefined;
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
  .option('--account <accountId>', 'Connected account ID')
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
    info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
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
    info(`Account ID: ${accountId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Financial Accounts Commands
// ============================================
const faCmd = program
  .command('financial-accounts')
  .description('Manage treasury financial accounts');

faCmd
  .command('list')
  .description('List all financial accounts')
  .option('-l, --limit <number>', 'Maximum number of accounts', '10')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.financialAccounts.list({
        limit: parseInt(opts.limit),
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

faCmd
  .command('get <id>')
  .description('Get a financial account by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.financialAccounts.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

faCmd
  .command('create')
  .description('Create a financial account')
  .option('--currencies <list>', 'Comma-separated supported currencies', 'usd')
  .option('--nickname <name>', 'Account nickname')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.financialAccounts.create({
        supported_currencies: (opts.currencies as string).split(',').map((c: string) => c.trim()),
        nickname: opts.nickname,
        metadata: parseMetadata(opts.metadata),
      });
      success('Financial account created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

faCmd
  .command('update <id>')
  .description('Update a financial account')
  .option('--nickname <name>', 'Account nickname')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.financialAccounts.update(id, {
        nickname: opts.nickname,
        metadata: parseMetadata(opts.metadata),
      });
      success('Financial account updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

faCmd
  .command('features <id>')
  .description('Show the features of a financial account')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.financialAccounts.getFeatures(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Transactions Commands
// ============================================
const txCmd = program
  .command('transactions')
  .description('View treasury transactions');

txCmd
  .command('list')
  .description('List transactions for a financial account')
  .requiredOption('--financial-account <id>', 'Financial account ID')
  .option('-l, --limit <number>', 'Maximum number of transactions', '10')
  .option('--status <status>', 'Filter by status (open, posted, void)')
  .option('--order-by <field>', 'Order by (created, posted_at)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.transactions.list({
        financial_account: opts.financialAccount,
        limit: parseInt(opts.limit),
        status: opts.status,
        order_by: opts.orderBy,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

txCmd
  .command('get <id>')
  .description('Get a transaction by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.transactions.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Transaction Entries Commands
// ============================================
const entriesCmd = program
  .command('transaction-entries')
  .description('View treasury transaction entries');

entriesCmd
  .command('list')
  .description('List transaction entries for a financial account')
  .requiredOption('--financial-account <id>', 'Financial account ID')
  .option('-l, --limit <number>', 'Maximum number of entries', '10')
  .option('--transaction <id>', 'Filter by transaction ID')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.transactionEntries.list({
        financial_account: opts.financialAccount,
        limit: parseInt(opts.limit),
        transaction: opts.transaction,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

entriesCmd
  .command('get <id>')
  .description('Get a transaction entry by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.transactionEntries.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Outbound Payments Commands
// ============================================
const opCmd = program
  .command('outbound-payments')
  .description('Manage outbound payments');

opCmd
  .command('list')
  .description('List outbound payments for a financial account')
  .requiredOption('--financial-account <id>', 'Financial account ID')
  .option('-l, --limit <number>', 'Maximum number of payments', '10')
  .option('--customer <id>', 'Filter by customer ID')
  .option('--status <status>', 'Filter by status (processing, posted, failed, canceled, returned)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.outboundPayments.list({
        financial_account: opts.financialAccount,
        limit: parseInt(opts.limit),
        customer: opts.customer,
        status: opts.status,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

opCmd
  .command('get <id>')
  .description('Get an outbound payment by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.outboundPayments.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

opCmd
  .command('create')
  .description('Create an outbound payment')
  .requiredOption('--financial-account <id>', 'Source financial account ID')
  .requiredOption('--amount <cents>', 'Amount in the smallest currency unit')
  .requiredOption('--currency <currency>', 'Currency code (e.g. usd)')
  .option('--destination-payment-method <id>', 'Destination payment method ID')
  .option('--customer <id>', 'Customer ID')
  .option('-d, --description <text>', 'Description')
  .option('--statement-descriptor <text>', 'Statement descriptor')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.outboundPayments.create({
        financial_account: opts.financialAccount,
        amount: parseInt(opts.amount),
        currency: opts.currency,
        destination_payment_method: opts.destinationPaymentMethod,
        customer: opts.customer,
        description: opts.description,
        statement_descriptor: opts.statementDescriptor,
        metadata: parseMetadata(opts.metadata),
      });
      success('Outbound payment created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

opCmd
  .command('cancel <id>')
  .description('Cancel an outbound payment')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.outboundPayments.cancel(id);
      success('Outbound payment canceled');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Outbound Transfers Commands
// ============================================
const otCmd = program
  .command('outbound-transfers')
  .description('Manage outbound transfers');

otCmd
  .command('list')
  .description('List outbound transfers for a financial account')
  .requiredOption('--financial-account <id>', 'Financial account ID')
  .option('-l, --limit <number>', 'Maximum number of transfers', '10')
  .option('--status <status>', 'Filter by status (processing, posted, failed, canceled, returned)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.outboundTransfers.list({
        financial_account: opts.financialAccount,
        limit: parseInt(opts.limit),
        status: opts.status,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

otCmd
  .command('get <id>')
  .description('Get an outbound transfer by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.outboundTransfers.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

otCmd
  .command('create')
  .description('Create an outbound transfer')
  .requiredOption('--financial-account <id>', 'Source financial account ID')
  .requiredOption('--amount <cents>', 'Amount in the smallest currency unit')
  .requiredOption('--currency <currency>', 'Currency code (e.g. usd)')
  .requiredOption('--destination-payment-method <id>', 'Destination payment method ID')
  .option('-d, --description <text>', 'Description')
  .option('--statement-descriptor <text>', 'Statement descriptor')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.outboundTransfers.create({
        financial_account: opts.financialAccount,
        amount: parseInt(opts.amount),
        currency: opts.currency,
        destination_payment_method: opts.destinationPaymentMethod,
        description: opts.description,
        statement_descriptor: opts.statementDescriptor,
        metadata: parseMetadata(opts.metadata),
      });
      success('Outbound transfer created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

otCmd
  .command('cancel <id>')
  .description('Cancel an outbound transfer')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.outboundTransfers.cancel(id);
      success('Outbound transfer canceled');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Inbound Transfers Commands
// ============================================
const itCmd = program
  .command('inbound-transfers')
  .description('Manage inbound transfers');

itCmd
  .command('list')
  .description('List inbound transfers for a financial account')
  .requiredOption('--financial-account <id>', 'Financial account ID')
  .option('-l, --limit <number>', 'Maximum number of transfers', '10')
  .option('--status <status>', 'Filter by status (processing, succeeded, failed, canceled)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.inboundTransfers.list({
        financial_account: opts.financialAccount,
        limit: parseInt(opts.limit),
        status: opts.status,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itCmd
  .command('get <id>')
  .description('Get an inbound transfer by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.inboundTransfers.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itCmd
  .command('create')
  .description('Create an inbound transfer')
  .requiredOption('--financial-account <id>', 'Destination financial account ID')
  .requiredOption('--amount <cents>', 'Amount in the smallest currency unit')
  .requiredOption('--currency <currency>', 'Currency code (e.g. usd)')
  .requiredOption('--origin-payment-method <id>', 'Origin payment method ID')
  .option('-d, --description <text>', 'Description')
  .option('--statement-descriptor <text>', 'Statement descriptor')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.inboundTransfers.create({
        financial_account: opts.financialAccount,
        amount: parseInt(opts.amount),
        currency: opts.currency,
        origin_payment_method: opts.originPaymentMethod,
        description: opts.description,
        statement_descriptor: opts.statementDescriptor,
        metadata: parseMetadata(opts.metadata),
      });
      success('Inbound transfer created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itCmd
  .command('cancel <id>')
  .description('Cancel an inbound transfer')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.inboundTransfers.cancel(id);
      success('Inbound transfer canceled');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Received Credits Commands
// ============================================
const rcCmd = program
  .command('received-credits')
  .description('View received credits');

rcCmd
  .command('list')
  .description('List received credits for a financial account')
  .requiredOption('--financial-account <id>', 'Financial account ID')
  .option('-l, --limit <number>', 'Maximum number of credits', '10')
  .option('--status <status>', 'Filter by status (succeeded, failed)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.receivedCredits.list({
        financial_account: opts.financialAccount,
        limit: parseInt(opts.limit),
        status: opts.status,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

rcCmd
  .command('get <id>')
  .description('Get a received credit by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.receivedCredits.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Received Debits Commands
// ============================================
const rdCmd = program
  .command('received-debits')
  .description('View received debits');

rdCmd
  .command('list')
  .description('List received debits for a financial account')
  .requiredOption('--financial-account <id>', 'Financial account ID')
  .option('-l, --limit <number>', 'Maximum number of debits', '10')
  .option('--status <status>', 'Filter by status (succeeded, failed)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.receivedDebits.list({
        financial_account: opts.financialAccount,
        limit: parseInt(opts.limit),
        status: opts.status,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

rdCmd
  .command('get <id>')
  .description('Get a received debit by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.receivedDebits.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Credit Reversals Commands
// ============================================
const crCmd = program
  .command('credit-reversals')
  .description('Manage credit reversals');

crCmd
  .command('list')
  .description('List credit reversals for a financial account')
  .requiredOption('--financial-account <id>', 'Financial account ID')
  .option('-l, --limit <number>', 'Maximum number of reversals', '10')
  .option('--received-credit <id>', 'Filter by received credit ID')
  .option('--status <status>', 'Filter by status (processing, posted, canceled)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.creditReversals.list({
        financial_account: opts.financialAccount,
        limit: parseInt(opts.limit),
        received_credit: opts.receivedCredit,
        status: opts.status,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

crCmd
  .command('get <id>')
  .description('Get a credit reversal by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.creditReversals.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

crCmd
  .command('create')
  .description('Reverse a received credit')
  .requiredOption('--received-credit <id>', 'Received credit ID to reverse')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.creditReversals.create({
        received_credit: opts.receivedCredit,
        metadata: parseMetadata(opts.metadata),
      });
      success('Credit reversal created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Debit Reversals Commands
// ============================================
const drCmd = program
  .command('debit-reversals')
  .description('Manage debit reversals');

drCmd
  .command('list')
  .description('List debit reversals for a financial account')
  .requiredOption('--financial-account <id>', 'Financial account ID')
  .option('-l, --limit <number>', 'Maximum number of reversals', '10')
  .option('--received-debit <id>', 'Filter by received debit ID')
  .option('--status <status>', 'Filter by status (processing, succeeded, failed)')
  .option('--starting-after <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.debitReversals.list({
        financial_account: opts.financialAccount,
        limit: parseInt(opts.limit),
        received_debit: opts.receivedDebit,
        status: opts.status,
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drCmd
  .command('get <id>')
  .description('Get a debit reversal by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.debitReversals.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drCmd
  .command('create')
  .description('Reverse a received debit')
  .requiredOption('--received-debit <id>', 'Received debit ID to reverse')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.debitReversals.create({
        received_debit: opts.receivedDebit,
        metadata: parseMetadata(opts.metadata),
      });
      success('Debit reversal created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
