#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Mercury } from '../api';
import {
  getApiKey,
  setApiKey,
  clearConfig,
  getConfigDir,
  getBaseConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
  getAccountId,
  getDefaultAccountId,
  setDefaultAccountId,
  setNamedAccount,
  removeNamedAccount,
  listNamedAccounts,
  getExportsDir,
  getImportsDir,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-mercury';
const VERSION = '0.1.5';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Mercury Banking API CLI - Accounts, transactions, transfers, and treasury management')
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
      process.env.MERCURY_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Mercury {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set MERCURY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Mercury({ apiKey });
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function resolveAccountId(nameOrId?: string): string {
  const resolved = getAccountId(nameOrId);
  if (!resolved) {
    error(`No account specified. Use --account or set default with "${CONNECTOR_NAME} config set-account <id>"`);
    process.exit(1);
  }
  return resolved;
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
    const defaultAccount = getDefaultAccountId();
    const namedAccounts = listNamedAccounts();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    console.log();
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);
    info(`Exports directory: ${getExportsDir()}`);
    info(`Imports directory: ${getImportsDir()}`);
    console.log();
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Default Account: ${defaultAccount || chalk.gray('not set')}`);

    const accountNames = Object.keys(namedAccounts);
    if (accountNames.length > 0) {
      console.log();
      info(`Named Accounts:`);
      accountNames.forEach(name => {
        console.log(`  ${chalk.cyan(name)}: ${namedAccounts[name]}`);
      });
    }
  });

configCmd
  .command('set-account <accountId>')
  .description('Set default account ID')
  .action((accountId: string) => {
    setDefaultAccountId(accountId);
    success(`Default account set: ${accountId}`);
  });

configCmd
  .command('set-named-account <name> <accountId>')
  .description('Set a named account (e.g., revenue, expenses)')
  .action((name: string, accountId: string) => {
    setNamedAccount(name, accountId);
    success(`Account "${name}" set to: ${accountId}`);
  });

configCmd
  .command('remove-named-account <name>')
  .description('Remove a named account')
  .action((name: string) => {
    if (removeNamedAccount(name)) {
      success(`Named account "${name}" removed`);
    } else {
      error(`Named account "${name}" not found`);
      process.exit(1);
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
// Accounts Commands
// ============================================
const accountsCmd = program
  .command('accounts')
  .description('Manage bank accounts');

accountsCmd
  .command('list')
  .description('List all accounts')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      if (getFormat(accountsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Accounts (${result.total} total):`);
        result.accounts.forEach(account => {
          console.log(`  ${chalk.bold(account.name)} (${account.type})`);
          console.log(`    ID: ${account.id}`);
          console.log(`    Status: ${account.status}`);
          console.log(`    Account: ****${account.accountNumber.slice(-4)}`);
          console.log(`    Balance: ${formatMoney(account.currentBalance)} (Available: ${formatMoney(account.availableBalance)})`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('get [account]')
  .description('Get account details (account: ID, name, or default)')
  .action(async (account?: string) => {
    try {
      const client = getClient();
      const accountId = resolveAccountId(account);
      const result = await client.accounts.get(accountId);
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('balance [account]')
  .description('Get account balance (account: ID, name, or default)')
  .action(async (account?: string) => {
    try {
      const client = getClient();
      const accountId = resolveAccountId(account);
      const result = await client.accounts.getBalance(accountId);

      if (getFormat(accountsCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold('Account Balance:'));
        console.log(`  Current:   ${formatMoney(result.currentBalance)}`);
        console.log(`  Available: ${formatMoney(result.availableBalance)}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('statements [account]')
  .description('List account statements (account: ID, name, or default)')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAccountId(account);
      const result = await client.accounts.listStatements(accountId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('cards [account]')
  .description('List cards for an account (account: ID, name, or default)')
  .action(async (account?: string) => {
    try {
      const client = getClient();
      const accountId = resolveAccountId(account);
      const result = await client.accounts.listCards(accountId);
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Transactions Commands
// ============================================
const transactionsCmd = program
  .command('transactions')
  .description('View transactions');

transactionsCmd
  .command('list [account]')
  .description('List transactions (account: ID, name, or default)')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .option('--status <status>', 'Filter by status (pending, sent, cancelled, failed)')
  .option('--search <query>', 'Search transactions')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAccountId(account);
      const result = await client.transactions.list(accountId, {
        limit: parseInt(opts.limit),
        start: opts.start,
        end: opts.end,
        status: opts.status,
        search: opts.search,
      });

      if (getFormat(transactionsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Transactions (${result.total} total):`);
        result.transactions.forEach(tx => {
          const amountColor = tx.amount >= 0 ? chalk.green : chalk.red;
          console.log(`  ${chalk.gray(tx.createdAt.split('T')[0])} ${amountColor(formatMoney(tx.amount))} - ${tx.counterpartyName || tx.kind}`);
          console.log(`    ID: ${tx.id} | Status: ${tx.status}`);
          if (tx.note) console.log(`    Note: ${tx.note}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transactionsCmd
  .command('get <transactionId> [account]')
  .description('Get transaction details (account: ID, name, or default)')
  .action(async (transactionId: string, account?: string) => {
    try {
      const client = getClient();
      const accountId = resolveAccountId(account);
      const result = await client.transactions.get(accountId, transactionId);
      print(result, getFormat(transactionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transactionsCmd
  .command('list-all')
  .description('List transactions across all accounts')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .option('--status <status>', 'Filter by status')
  .option('--search <query>', 'Search transactions')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.transactions.listAll({
        limit: parseInt(opts.limit),
        start: opts.start,
        end: opts.end,
        status: opts.status,
        search: opts.search,
      });

      if (getFormat(transactionsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`All Transactions (${result.total} total):`);
        result.transactions.forEach(tx => {
          const amountColor = tx.amount >= 0 ? chalk.green : chalk.red;
          console.log(`  ${chalk.gray(tx.createdAt.split('T')[0])} ${amountColor(formatMoney(tx.amount))} - ${tx.counterpartyName || tx.kind}`);
          console.log(`    ID: ${tx.id} | Account: ${tx.accountId} | Status: ${tx.status}`);
          if (tx.note) console.log(`    Note: ${tx.note}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transactionsCmd
  .command('get-by-id <transactionId>')
  .description('Get transaction by ID (global, no account needed)')
  .action(async (transactionId: string) => {
    try {
      const client = getClient();
      const result = await client.transactions.getById(transactionId);
      print(result, getFormat(transactionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Recipients Commands
// ============================================
const recipientsCmd = program
  .command('recipients')
  .description('Manage payment recipients');

recipientsCmd
  .command('list')
  .description('List all recipients')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--status <status>', 'Filter by status (active, deleted)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.recipients.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        status: opts.status,
      });

      if (getFormat(recipientsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Recipients (${result.total} total):`);
        result.recipients.forEach(r => {
          console.log(`  ${chalk.bold(r.name)}${r.nickname ? ` (${r.nickname})` : ''}`);
          console.log(`    ID: ${r.id}`);
          console.log(`    Type: ${r.isBusiness ? 'business' : 'individual'} | Payment: ${r.defaultPaymentMethod || 'N/A'}`);
          console.log(`    Status: ${r.status}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recipientsCmd
  .command('get <recipientId>')
  .description('Get recipient details')
  .action(async (recipientId: string) => {
    try {
      const client = getClient();
      const result = await client.recipients.get(recipientId);
      print(result, getFormat(recipientsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recipientsCmd
  .command('create')
  .description('Create a new recipient')
  .requiredOption('-n, --name <name>', 'Recipient name')
  .requiredOption('-m, --method <method>', 'Payment method (ach, domesticWire, internationalWire, check)')
  .option('-b, --business', 'Recipient is a business (default: individual)')
  .option('--nickname <nickname>', 'Nickname')
  .option('--email <email>', 'Email address')
  .option('--routing <routing>', 'Routing number')
  .option('--account <account>', 'Account number')
  .option('--address1 <address1>', 'Address line 1')
  .option('--city <city>', 'City')
  .option('--region <region>', 'State/Region')
  .option('--postal <postal>', 'Postal code')
  .option('--country <country>', 'Country code (default: US)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const method = opts.method as 'ach' | 'domesticWire' | 'internationalWire' | 'check';

      // Build address if provided
      const address = opts.address1 ? {
        address1: opts.address1,
        city: opts.city || '',
        region: opts.region || '',
        postalCode: opts.postal || '',
        country: opts.country || 'US',
      } : undefined;

      // Build routing info based on payment method
      const routingInfo = (opts.routing && opts.account) ? {
        routingNumber: opts.routing,
        accountNumber: opts.account,
        address,
      } : undefined;

      const params: import('../types').RecipientCreateParams = {
        name: opts.name,
        isBusiness: opts.business || false,
        defaultPaymentMethod: method,
        nickname: opts.nickname,
        emails: opts.email ? [opts.email] : undefined,
        defaultAddress: address,
      };

      // Set the appropriate routing info based on method
      if (routingInfo) {
        if (method === 'ach') {
          params.electronicRoutingInfo = routingInfo;
        } else if (method === 'domesticWire') {
          params.domesticWireRoutingInfo = routingInfo;
        }
      }

      const result = await client.recipients.create(params);
      success('Recipient created!');
      print(result, getFormat(recipientsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recipientsCmd
  .command('delete <recipientId>')
  .description('Delete a recipient')
  .action(async (recipientId: string) => {
    try {
      const client = getClient();
      await client.recipients.delete(recipientId);
      success('Recipient deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Transfers Commands
// ============================================
const transfersCmd = program
  .command('transfers')
  .description('Manage transfers');

transfersCmd
  .command('list [account]')
  .description('List transfers for an account (account: ID, name, or default)')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--status <status>', 'Filter by status')
  .action(async (account: string | undefined, opts) => {
    try {
      const client = getClient();
      const accountId = resolveAccountId(account);
      const result = await client.transfers.list(accountId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        status: opts.status,
      });
      print(result, getFormat(transfersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transfersCmd
  .command('send')
  .description('Send a transfer (requires IP whitelist)')
  .option('-a, --account <account>', 'Source account (ID, name, or default)')
  .requiredOption('-r, --recipient <recipientId>', 'Recipient ID')
  .requiredOption('--amount <cents>', 'Amount in cents')
  .option('-m, --method <method>', 'Payment method')
  .option('--memo <memo>', 'External memo')
  .option('--note <note>', 'Internal note')
  .option('--idempotency-key <key>', 'Idempotency key')
  .action(async (opts) => {
    try {
      const client = getClient();
      const accountId = resolveAccountId(opts.account);
      const result = await client.transfers.create({
        accountId,
        recipientId: opts.recipient,
        amount: parseInt(opts.amount),
        paymentMethod: opts.method,
        externalMemo: opts.memo,
        note: opts.note,
        idempotencyKey: opts.idempotencyKey,
      });
      success('Transfer created!');
      print(result, getFormat(transfersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transfersCmd
  .command('request')
  .description('Request a transfer (queued for admin approval - no IP whitelist needed)')
  .option('-a, --account <account>', 'Source account (ID, name, or default)')
  .requiredOption('-r, --recipient <recipientId>', 'Recipient ID')
  .requiredOption('--amount <cents>', 'Amount in cents')
  .option('-m, --method <method>', 'Payment method')
  .option('--memo <memo>', 'External memo')
  .option('--note <note>', 'Internal note')
  .option('--idempotency-key <key>', 'Idempotency key')
  .action(async (opts) => {
    try {
      const client = getClient();
      const accountId = resolveAccountId(opts.account);
      const result = await client.transfers.requestSendMoney({
        accountId,
        recipientId: opts.recipient,
        amount: parseInt(opts.amount),
        paymentMethod: opts.method,
        externalMemo: opts.memo,
        note: opts.note,
        idempotencyKey: opts.idempotencyKey,
      });
      success('Transfer request submitted for admin approval!');
      print(result, getFormat(transfersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transfersCmd
  .command('internal')
  .description('Create an internal transfer between accounts')
  .requiredOption('-f, --from <account>', 'Source account (ID, name, or default)')
  .requiredOption('-t, --to <account>', 'Destination account (ID or name)')
  .requiredOption('--amount <cents>', 'Amount in cents')
  .option('--note <note>', 'Note')
  .action(async (opts) => {
    try {
      const client = getClient();
      const fromAccountId = resolveAccountId(opts.from);
      const toAccountId = getAccountId(opts.to) || opts.to;
      const result = await client.transfers.createInternal({
        fromAccountId,
        toAccountId,
        amount: parseInt(opts.amount),
        note: opts.note,
      });
      success('Internal transfer created!');
      print(result, getFormat(transfersCmd));
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
  .description('List invoices')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--status <status>', 'Filter by status')
  .option('--customer <customerId>', 'Filter by customer')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.invoices.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        status: opts.status,
        customerId: opts.customer,
      });

      if (getFormat(invoicesCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Invoices (${result.total} total):`);
        result.invoices.forEach(inv => {
          console.log(`  ${chalk.bold(inv.invoiceNumber)} - ${inv.status}`);
          console.log(`    Total: ${formatMoney(inv.total)} | Due: ${formatMoney(inv.amountDue)}`);
          console.log(`    Due Date: ${inv.dueDate}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('get <invoiceId>')
  .description('Get invoice details')
  .action(async (invoiceId: string) => {
    try {
      const client = getClient();
      const result = await client.invoices.get(invoiceId);
      print(result, getFormat(invoicesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('send <invoiceId>')
  .description('Send an invoice to the customer')
  .action(async (invoiceId: string) => {
    try {
      const client = getClient();
      const result = await client.invoices.send(invoiceId);
      success('Invoice sent!');
      print(result, getFormat(invoicesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invoicesCmd
  .command('cancel <invoiceId>')
  .description('Cancel an invoice')
  .action(async (invoiceId: string) => {
    try {
      const client = getClient();
      const result = await client.invoices.cancel(invoiceId);
      success('Invoice cancelled');
      print(result, getFormat(invoicesCmd));
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
  .description('Manage invoice customers');

customersCmd
  .command('list')
  .description('List customers')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-s, --search <query>', 'Search customers')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.customers.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        search: opts.search,
      });
      print(result, getFormat(customersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('get <customerId>')
  .description('Get customer details')
  .action(async (customerId: string) => {
    try {
      const client = getClient();
      const result = await client.customers.get(customerId);
      print(result, getFormat(customersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('create')
  .description('Create a new customer')
  .requiredOption('-n, --name <name>', 'Customer name')
  .requiredOption('-e, --email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.customers.create({
        name: opts.name,
        email: opts.email,
        phone: opts.phone,
      });
      success('Customer created!');
      print(result, getFormat(customersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('delete <customerId>')
  .description('Delete a customer')
  .action(async (customerId: string) => {
    try {
      const client = getClient();
      await client.customers.delete(customerId);
      success('Customer deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Treasury Commands
// ============================================
const treasuryCmd = program
  .command('treasury')
  .description('Manage treasury accounts');

treasuryCmd
  .command('list')
  .description('List treasury accounts')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.treasury.list();

      if (getFormat(treasuryCmd) === 'json') {
        print(result, 'json');
      } else {
        const accounts = result.accounts || [];
        success(`Treasury Accounts (${accounts.length} total):`);
        if (accounts.length === 0) {
          info('No treasury accounts found');
        } else {
          accounts.forEach(acc => {
            console.log(`  ${chalk.bold(acc.name || 'Treasury Account')}`);
            console.log(`    ID: ${acc.id}`);
            console.log(`    Balance: ${formatMoney(acc.currentBalance)}`);
            if (acc.apy) console.log(`    APY: ${(acc.apy * 100).toFixed(2)}%`);
            console.log(`    Status: ${acc.status}`);
            console.log();
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

treasuryCmd
  .command('get <treasuryAccountId>')
  .description('Get treasury account details')
  .action(async (treasuryAccountId: string) => {
    try {
      const client = getClient();
      const result = await client.treasury.get(treasuryAccountId);
      print(result, getFormat(treasuryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

treasuryCmd
  .command('deposit')
  .description('Deposit funds into treasury')
  .requiredOption('-t, --treasury <treasuryId>', 'Treasury account ID')
  .requiredOption('-f, --from <accountId>', 'Source account ID')
  .requiredOption('--amount <cents>', 'Amount in cents')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.treasury.deposit(opts.treasury, {
        fromAccountId: opts.from,
        amount: parseInt(opts.amount),
      });
      success('Deposit initiated!');
      print(result, getFormat(treasuryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

treasuryCmd
  .command('withdraw')
  .description('Withdraw funds from treasury')
  .requiredOption('-t, --treasury <treasuryId>', 'Treasury account ID')
  .requiredOption('--to <accountId>', 'Destination account ID')
  .requiredOption('--amount <cents>', 'Amount in cents')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.treasury.withdraw(opts.treasury, {
        toAccountId: opts.to,
        amount: parseInt(opts.amount),
      });
      success('Withdrawal initiated!');
      print(result, getFormat(treasuryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Organization Commands
// ============================================
const orgCmd = program
  .command('org')
  .description('Organization and user management');

orgCmd
  .command('info')
  .description('Get organization info')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.organization.get();
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgCmd
  .command('users')
  .description('List users')
  .option('--role <role>', 'Filter by role')
  .option('--status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.organization.listUsers({
        role: opts.role,
        status: opts.status,
      });

      if (getFormat(orgCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Users (${result.total} total):`);
        result.users.forEach(user => {
          console.log(`  ${chalk.bold(user.firstName)} ${chalk.bold(user.lastName)} (${user.role})`);
          console.log(`    ID: ${user.id}`);
          console.log(`    Email: ${user.email}`);
          console.log(`    Status: ${user.status}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgCmd
  .command('me')
  .description('Get current user info')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.organization.getCurrentUser();
      print(result, getFormat(orgCmd));
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
  .description('Manage webhooks');

webhooksCmd
  .command('list')
  .description('List webhooks')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.webhooks.list();
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('get <webhookId>')
  .description('Get webhook details')
  .action(async (webhookId: string) => {
    try {
      const client = getClient();
      const result = await client.webhooks.get(webhookId);
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a webhook')
  .requiredOption('-u, --url <url>', 'Webhook URL')
  .option('-e, --events <events>', 'Comma-separated event types (transaction.created, transaction.updated, checkingAccount.balance.updated, etc.)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.webhooks.create({
        url: opts.url,
        eventTypes: opts.events ? opts.events.split(',') : undefined,
      });
      success('Webhook created!');
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <webhookId>')
  .description('Delete a webhook')
  .action(async (webhookId: string) => {
    try {
      const client = getClient();
      await client.webhooks.delete(webhookId);
      success('Webhook deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('test <webhookId>')
  .description('Test a webhook')
  .action(async (webhookId: string) => {
    try {
      const client = getClient();
      const result = await client.webhooks.test(webhookId);
      if (result.success) {
        success(`Webhook test successful! Status: ${result.statusCode}`);
      } else {
        error(`Webhook test failed. Status: ${result.statusCode}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('verify <webhookId>')
  .description('Verify a webhook endpoint')
  .action(async (webhookId: string) => {
    try {
      const client = getClient();
      const result = await client.webhooks.verify(webhookId);
      if (result.verified) {
        success('Webhook verified successfully!');
      } else {
        error('Webhook verification failed');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Categories Commands
// ============================================
const categoriesCmd = program
  .command('categories')
  .description('View transaction categories');

categoriesCmd
  .command('list')
  .description('List all categories')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.categories.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(categoriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Credit Commands
// ============================================
const creditCmd = program
  .command('credit')
  .description('View credit accounts');

creditCmd
  .command('list')
  .description('List all credit accounts')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.credit.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(creditCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

creditCmd
  .command('get <creditAccountId>')
  .description('Get credit account details')
  .action(async (creditAccountId: string) => {
    try {
      const client = getClient();
      const result = await client.credit.get(creditAccountId);
      print(result, getFormat(creditCmd));
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
  .description('View API events');

eventsCmd
  .command('list')
  .description('List all events')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-r, --resource-type <type>', 'Filter by resource type (transaction, checkingAccount, savingsAccount, treasuryAccount, investmentAccount, creditAccount)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.events.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        resourceType: opts.resourceType,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('get <eventId>')
  .description('Get event details')
  .action(async (eventId: string) => {
    try {
      const client = getClient();
      const result = await client.events.get(eventId);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Attachments Commands
// ============================================
const attachmentsCmd = program
  .command('attachments')
  .description('View attachment details');

attachmentsCmd
  .command('get <attachmentId>')
  .description('Get attachment details and download URL')
  .action(async (attachmentId: string) => {
    try {
      const client = getClient();
      const result = await client.attachments.get(attachmentId);
      print(result, getFormat(attachmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
