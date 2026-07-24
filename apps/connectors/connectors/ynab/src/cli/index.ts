#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Ynab } from '../api';
import {
  getAccessToken,
  setAccessToken,
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

const CONNECTOR_NAME = 'connect-ynab';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('YNAB connector - You Need A Budget personal finance and budgeting API')
  .version(VERSION)
  .option('-t, --token <token>', 'Personal access token (overrides config)')
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
    if (opts.token) {
      process.env.YNAB_ACCESS_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Ynab {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set YNAB_ACCESS_TOKEN.`);
    process.exit(1);
  }
  return new Ynab({ accessToken, baseUrl: getBaseUrl() });
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program.command('profile').description('Manage configuration profiles');

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

    success('Profiles:');
    profiles.forEach((p) => {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a CLI profile')
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
  .description('Create a new CLI profile')
  .option('--token <token>', 'Personal access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { accessToken: opts.token });
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
    info(`Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.ynab.com/v1)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set personal access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-url <baseUrl>')
  .description('Set API base URL')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || 'https://api.ynab.com/v1 (default)'}`);
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
const userCmd = program.command('user').description('Authenticated user');

userCmd
  .command('get')
  .description('Get authenticated user info')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getUser();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Plan Commands
// ============================================
const planCmd = program.command('plan').description('YNAB plans (budgets)');

planCmd
  .command('list')
  .description('List all plans')
  .option('--include-accounts', 'Include account summaries')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listPlans(opts.includeAccounts);
      print(result, getFormat(planCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

planCmd
  .command('get <plan_id>')
  .description('Get plan details (plan_id may be last-used or default)')
  .action(async (planId: string) => {
    try {
      const client = getClient();
      const result = await client.getPlan(planId);
      print(result, getFormat(planCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

planCmd
  .command('settings <plan_id>')
  .description('Get plan settings')
  .action(async (planId: string) => {
    try {
      const client = getClient();
      const result = await client.getPlanSettings(planId);
      print(result, getFormat(planCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Account Commands
// ============================================
const accountCmd = program.command('account').description('Plan accounts');

accountCmd
  .command('list <plan_id>')
  .description('List accounts for a plan')
  .action(async (planId: string) => {
    try {
      const client = getClient();
      const result = await client.listAccounts(planId);
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('get <plan_id> <account_id>')
  .description('Get a single account')
  .action(async (planId: string, accountId: string) => {
    try {
      const client = getClient();
      const result = await client.getAccount(planId, accountId);
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Category Commands
// ============================================
const categoryCmd = program.command('category').description('Plan categories');

categoryCmd
  .command('list <plan_id>')
  .description('List categories for a plan')
  .action(async (planId: string) => {
    try {
      const client = getClient();
      const result = await client.listCategories(planId);
      print(result, getFormat(categoryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

categoryCmd
  .command('get <plan_id> <category_id>')
  .description('Get a single category')
  .action(async (planId: string, categoryId: string) => {
    try {
      const client = getClient();
      const result = await client.getCategory(planId, categoryId);
      print(result, getFormat(categoryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Transaction Commands
// ============================================
const transactionCmd = program.command('transaction').description('Plan transactions');

transactionCmd
  .command('list <plan_id>')
  .description('List transactions for a plan')
  .option('--since <date>', 'Only transactions on or after this date (YYYY-MM-DD)')
  .option('--until <date>', 'Only transactions on or before this date (YYYY-MM-DD)')
  .option('--type <type>', 'Filter: uncategorized or unapproved')
  .action(async (planId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listTransactions(planId, {
        since_date: opts.since,
        until_date: opts.until,
        type: opts.type,
      });
      print(result, getFormat(transactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transactionCmd
  .command('get <plan_id> <transaction_id>')
  .description('Get a single transaction')
  .action(async (planId: string, transactionId: string) => {
    try {
      const client = getClient();
      const result = await client.getTransaction(planId, transactionId);
      print(result, getFormat(transactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transactionCmd
  .command('create <plan_id>')
  .description('Create a transaction (amounts in milliunits)')
  .requiredOption('--account <id>', 'Account ID')
  .requiredOption('--date <date>', 'Transaction date (YYYY-MM-DD)')
  .requiredOption('--amount <amount>', 'Amount in milliunits (negative for outflow)')
  .option('--payee <name>', 'Payee name')
  .option('--category <id>', 'Category ID')
  .option('--memo <text>', 'Memo')
  .action(async (planId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createTransaction(planId, {
        account_id: opts.account,
        date: opts.date,
        amount: parseInt(opts.amount, 10),
        payee_name: opts.payee,
        category_id: opts.category,
        memo: opts.memo,
      });
      success('Transaction created!');
      print(result, getFormat(transactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Month Commands
// ============================================
const monthCmd = program.command('month').description('Plan budget months');

monthCmd
  .command('list <plan_id>')
  .description('List budget months')
  .action(async (planId: string) => {
    try {
      const client = getClient();
      const result = await client.listMonths(planId);
      print(result, getFormat(monthCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

monthCmd
  .command('get <plan_id> <month>')
  .description('Get a budget month (YYYY-MM-DD)')
  .action(async (planId: string, month: string) => {
    try {
      const client = getClient();
      const result = await client.getMonth(planId, month);
      print(result, getFormat(monthCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Payee Commands
// ============================================
const payeeCmd = program.command('payee').description('Plan payees');

payeeCmd
  .command('list <plan_id>')
  .description('List payees')
  .action(async (planId: string) => {
    try {
      const client = getClient();
      const result = await client.listPayees(planId);
      print(result, getFormat(payeeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

payeeCmd
  .command('get <plan_id> <payee_id>')
  .description('Get a single payee')
  .action(async (planId: string, payeeId: string) => {
    try {
      const client = getClient();
      const result = await client.getPayee(planId, payeeId);
      print(result, getFormat(payeeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Scheduled Transaction Commands
// ============================================
const scheduledCmd = program.command('scheduled').description('Scheduled transactions');

scheduledCmd
  .command('list <plan_id>')
  .description('List scheduled transactions')
  .action(async (planId: string) => {
    try {
      const client = getClient();
      const result = await client.listScheduledTransactions(planId);
      print(result, getFormat(scheduledCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

scheduledCmd
  .command('get <plan_id> <scheduled_id>')
  .description('Get a scheduled transaction')
  .action(async (planId: string, scheduledId: string) => {
    try {
      const client = getClient();
      const result = await client.getScheduledTransaction(planId, scheduledId);
      print(result, getFormat(scheduledCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
