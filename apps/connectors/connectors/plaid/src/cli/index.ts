#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Plaid } from '../api';
import {
  getClientId,
  setClientId,
  getSecret,
  setSecret,
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

const CONNECTOR_NAME = 'connect-plaid';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Plaid connector CLI - Financial data for banking and transactions')
  .version(VERSION)
  .option('--client-id <id>', 'Client ID (overrides config)')
  .option('--secret <secret>', 'Secret (overrides config)')
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
    if (opts.clientId) {
      process.env.PLAID_CLIENT_ID = opts.clientId;
    }
    if (opts.secret) {
      process.env.PLAID_SECRET = opts.secret;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Plaid {
  const clientId = getClientId();
  const secret = getSecret();
  const baseUrl = getBaseUrl();

  if (!clientId) {
    error(`No client ID configured. Run "${CONNECTOR_NAME} config set-client-id <id>" or set PLAID_CLIENT_ID.`);
    process.exit(1);
  }
  if (!secret) {
    error(`No secret configured. Run "${CONNECTOR_NAME} config set-secret <secret>" or set PLAID_SECRET.`);
    process.exit(1);
  }
  return new Plaid({ clientId, secret, baseUrl });
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
  .option('--client-id <id>', 'Client ID')
  .option('--secret <secret>', 'Secret')
  .option('--sandbox', 'Use sandbox environment (default)')
  .option('--development', 'Use development environment')
  .option('--production', 'Use production environment')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    let baseUrl: string | undefined;
    if (opts.production) baseUrl = 'https://production.plaid.com';
    else if (opts.development) baseUrl = 'https://development.plaid.com';

    createProfile(name, {
      clientId: opts.clientId,
      secret: opts.secret,
      baseUrl,
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
    info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Secret: ${config.secret ? '********' : chalk.gray('not set')}`);
    const env = config.baseUrl?.includes('production') ? 'Production'
      : config.baseUrl?.includes('development') ? 'Development' : 'Sandbox';
    info(`Environment: ${env}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-client-id <clientId>')
  .description('Set client ID')
  .action((clientId: string) => {
    setClientId(clientId);
    success(`Client ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-secret <secret>')
  .description('Set secret')
  .action((secret: string) => {
    setSecret(secret);
    success(`Secret saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-environment <env>')
  .description('Set environment (sandbox, development, or production)')
  .action((env: string) => {
    if (!['sandbox', 'development', 'production'].includes(env)) {
      error('Environment must be "sandbox", "development", or "production"');
      process.exit(1);
    }
    const baseUrl = env === 'production' ? 'https://production.plaid.com'
      : env === 'development' ? 'https://development.plaid.com'
      : 'https://sandbox.plaid.com';
    setBaseUrl(baseUrl);
    success(`Environment set to ${env} for profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const clientId = getClientId();
    const baseUrl = getBaseUrl();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Client ID: ${clientId ? `${clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Secret: ${getSecret() ? '********' : chalk.gray('not set')}`);
    const env = baseUrl?.includes('production') ? 'Production'
      : baseUrl?.includes('development') ? 'Development' : 'Sandbox';
    info(`Environment: ${env}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Item Commands
// ============================================
const itemCmd = program
  .command('item')
  .description('Item management commands');

itemCmd
  .command('get <accessToken>')
  .description('Get item details')
  .action(async (accessToken: string) => {
    try {
      const client = getClient();
      const result = await client.getItem(accessToken);
      const format = getFormat(itemCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        const item = result.item;
        console.log(chalk.bold(`Item: ${item.item_id}`));
        if (item.institution_id) info(`Institution: ${item.institution_id}`);
        info(`Available Products: ${item.available_products.join(', ')}`);
        info(`Billed Products: ${item.billed_products.join(', ')}`);
        info(`Update Type: ${item.update_type}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemCmd
  .command('remove <accessToken>')
  .description('Remove an item')
  .action(async (accessToken: string) => {
    try {
      const client = getClient();
      await client.removeItem(accessToken);
      success('Item removed successfully');
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
  .description('Account commands');

accountCmd
  .command('list <accessToken>')
  .description('List accounts')
  .action(async (accessToken: string) => {
    try {
      const client = getClient();
      const result = await client.getAccounts(accessToken);
      const format = getFormat(accountCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Accounts (${result.accounts.length}):`);
        result.accounts.forEach(acc => {
          console.log(`  ${acc.name} [${acc.type}${acc.subtype ? `: ${acc.subtype}` : ''}]`);
          console.log(`    ID: ${acc.account_id}`);
          if (acc.mask) console.log(`    Mask: ****${acc.mask}`);
          if (acc.balances.current !== undefined) {
            console.log(`    Balance: ${acc.balances.current} ${acc.balances.iso_currency_code || ''}`);
          }
        });
      }
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
  .description('Balance commands');

balanceCmd
  .command('get <accessToken>')
  .description('Get real-time balance')
  .action(async (accessToken: string) => {
    try {
      const client = getClient();
      const result = await client.getBalance(accessToken);
      const format = getFormat(balanceCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Balances (${result.accounts.length} accounts):`);
        result.accounts.forEach(acc => {
          console.log(`  ${acc.name}`);
          info(`    Current: ${acc.balances.current ?? 'N/A'} ${acc.balances.iso_currency_code || ''}`);
          info(`    Available: ${acc.balances.available ?? 'N/A'} ${acc.balances.iso_currency_code || ''}`);
          if (acc.balances.limit !== undefined) {
            info(`    Limit: ${acc.balances.limit} ${acc.balances.iso_currency_code || ''}`);
          }
        });
      }
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
  .description('Transaction commands');

transactionCmd
  .command('list <accessToken>')
  .description('List transactions')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .option('-n, --count <count>', 'Number of transactions', '100')
  .option('--offset <offset>', 'Offset for pagination', '0')
  .action(async (accessToken: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getTransactions(accessToken, opts.start, opts.end, {
        count: parseInt(opts.count),
        offset: parseInt(opts.offset),
      });
      const format = getFormat(transactionCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Transactions (${result.transactions.length} of ${result.total_transactions}):`);
        result.transactions.slice(0, 20).forEach(tx => {
          const amount = tx.amount > 0 ? chalk.red(`-${tx.amount}`) : chalk.green(`+${Math.abs(tx.amount)}`);
          console.log(`  ${tx.date} ${amount} ${tx.iso_currency_code || ''}`);
          console.log(`    ${tx.name}${tx.merchant_name ? ` (${tx.merchant_name})` : ''}`);
          if (tx.category) console.log(`    ${chalk.gray(tx.category.join(' > '))}`);
        });
        if (result.transactions.length > 20) {
          info(`  ... and ${result.transactions.length - 20} more`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transactionCmd
  .command('sync <accessToken>')
  .description('Sync transactions incrementally')
  .option('--cursor <cursor>', 'Cursor for pagination')
  .option('-n, --count <count>', 'Number of transactions', '100')
  .action(async (accessToken: string, opts) => {
    try {
      const client = getClient();
      const result = await client.syncTransactions(accessToken, {
        cursor: opts.cursor,
        count: parseInt(opts.count),
      });
      const format = getFormat(transactionCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Transaction Sync:`);
        info(`Added: ${result.added.length}`);
        info(`Modified: ${result.modified.length}`);
        info(`Removed: ${result.removed.length}`);
        info(`Has More: ${result.has_more ? 'Yes' : 'No'}`);
        info(`Next Cursor: ${result.next_cursor.substring(0, 20)}...`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Auth commands (bank routing numbers)');

authCmd
  .command('get <accessToken>')
  .description('Get bank account and routing numbers')
  .action(async (accessToken: string) => {
    try {
      const client = getClient();
      const result = await client.getAuth(accessToken);
      const format = getFormat(authCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Auth Numbers:`);
        if (result.numbers.ach && result.numbers.ach.length > 0) {
          console.log(chalk.bold('\nACH Numbers:'));
          result.numbers.ach.forEach(num => {
            console.log(`  Account: ${num.account}`);
            console.log(`  Routing: ${num.routing}`);
            if (num.wire_routing) console.log(`  Wire Routing: ${num.wire_routing}`);
          });
        }
        if (result.numbers.eft && result.numbers.eft.length > 0) {
          console.log(chalk.bold('\nEFT Numbers:'));
          result.numbers.eft.forEach(num => {
            console.log(`  Account: ${num.account}`);
            console.log(`  Institution: ${num.institution}`);
            console.log(`  Branch: ${num.branch}`);
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Institution Commands
// ============================================
const institutionCmd = program
  .command('institution')
  .description('Institution commands');

institutionCmd
  .command('search <query>')
  .description('Search institutions by name')
  .option('--country <codes>', 'Country codes (comma-separated)', 'US')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const countryCodes = opts.country.split(',');
      const result = await client.searchInstitutions(query, countryCodes);
      const format = getFormat(institutionCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        success(`Institutions (${result.institutions.length}):`);
        result.institutions.forEach(inst => {
          console.log(`  ${inst.name}`);
          console.log(`    ID: ${inst.institution_id}`);
          console.log(`    Products: ${inst.products.join(', ')}`);
          console.log(`    OAuth: ${inst.oauth ? 'Yes' : 'No'}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

institutionCmd
  .command('get <institutionId>')
  .description('Get institution by ID')
  .option('--country <codes>', 'Country codes (comma-separated)', 'US')
  .action(async (institutionId: string, opts) => {
    try {
      const client = getClient();
      const countryCodes = opts.country.split(',');
      const result = await client.getInstitutionById(institutionId, countryCodes, {
        include_optional_metadata: true,
      });
      const format = getFormat(institutionCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        const inst = result.institution;
        console.log(chalk.bold(`Institution: ${inst.name}`));
        info(`ID: ${inst.institution_id}`);
        info(`Products: ${inst.products.join(', ')}`);
        info(`Countries: ${inst.country_codes.join(', ')}`);
        info(`OAuth: ${inst.oauth ? 'Yes' : 'No'}`);
        if (inst.url) info(`URL: ${inst.url}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Sandbox Commands
// ============================================
const sandboxCmd = program
  .command('sandbox')
  .description('Sandbox testing commands');

sandboxCmd
  .command('create-token')
  .description('Create a test public token')
  .requiredOption('-i, --institution <id>', 'Institution ID')
  .option('--products <products>', 'Products (comma-separated)', 'transactions')
  .action(async (opts) => {
    try {
      const client = getClient();
      const products = opts.products.split(',');
      const result = await client.sandboxPublicTokenCreate(opts.institution, products);
      success(`Public token created: ${result.public_token}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sandboxCmd
  .command('exchange-token <publicToken>')
  .description('Exchange public token for access token')
  .action(async (publicToken: string) => {
    try {
      const client = getClient();
      const result = await client.exchangePublicToken(publicToken);
      success(`Access token: ${result.access_token}`);
      info(`Item ID: ${result.item_id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
