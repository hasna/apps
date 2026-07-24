#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Unit } from '../api';
import {
  getApiToken,
  setApiToken,
  getEnvironment,
  setEnvironment,
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

const CONNECTOR_NAME = 'connect-unit';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Unit.sh Banking-as-a-Service API CLI')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('--token <token>', 'API token (overrides profile)')
  .option('--environment <env>', 'sandbox or production')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.token) process.env.UNIT_API_TOKEN = opts.token;
    if (opts.environment) process.env.UNIT_ENVIRONMENT = opts.environment;
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Unit {
  const apiToken = getApiToken();
  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set UNIT_API_TOKEN.`);
    process.exit(1);
  }
  return new Unit({ apiToken, environment: getEnvironment() });
}

async function run(cmd: Command, fn: () => Promise<unknown>): Promise<void> {
  try {
    print(await fn(), getFormat(cmd));
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`));
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>')
  .option('--token <token>', 'API token')
  .option('--environment <env>', 'sandbox or production')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiToken: opts.token, environment: opts.environment });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Token: ${config.apiToken ? `${config.apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Environment: ${config.environment ?? 'sandbox'}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').action((token: string) => {
  setApiToken(token);
  success(`API token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-environment <env>').action((env: string) => {
  if (env !== 'sandbox' && env !== 'production') {
    error('Environment must be sandbox or production');
    process.exit(1);
  }
  setEnvironment(env);
  success(`Environment set to ${env}`);
});

configCmd.command('show').action(() => {
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Token: ${getApiToken() ? `${getApiToken()!.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Environment: ${getEnvironment()}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success('Configuration cleared');
});

// Accounts
const accountsCmd = program.command('accounts').description('Deposit accounts');

accountsCmd.command('list')
  .option('--offset <n>', 'Page offset', parseInt)
  .option('--limit <n>', 'Page limit', parseInt)
  .option('--customer-id <id>', 'Filter by customer')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().accounts.list({
      offset: opts.offset,
      limit: opts.limit,
      customerId: opts.customerId,
    }));
  });

accountsCmd.command('get <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().accounts.get(id));
});

accountsCmd.command('create')
  .requiredOption('--customer-id <id>', 'Customer ID')
  .requiredOption('--product <product>', 'Deposit product')
  .option('--idempotency-key <key>', 'Idempotency key')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().accounts.createDepositAccount({
      customerId: opts.customerId,
      depositProduct: opts.product,
      idempotencyKey: opts.idempotencyKey,
    }));
  });

accountsCmd.command('close <id>')
  .option('--reason <reason>', 'ByCustomer or Fraud')
  .action(async function (this: Command, id: string, opts) {
    await run(this, () => getClient().accounts.close(id, { reason: opts.reason }));
  });

accountsCmd.command('freeze <id>').option('--reason <reason>').action(async function (this: Command, id: string, opts) {
  await run(this, () => getClient().accounts.freeze(id, opts.reason));
});

accountsCmd.command('unfreeze <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().accounts.unfreeze(id));
});

// Applications
const appsCmd = program.command('applications').description('Customer applications');

appsCmd.command('list')
  .option('--offset <n>', 'Page offset', parseInt)
  .option('--limit <n>', 'Page limit', parseInt)
  .option('--email <email>', 'Filter by email')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().applications.list({
      offset: opts.offset,
      limit: opts.limit,
      email: opts.email,
    }));
  });

appsCmd.command('get <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().applications.get(id));
});

// Customers
const customersCmd = program.command('customers').description('Customers');

customersCmd.command('list')
  .option('--offset <n>', 'Page offset', parseInt)
  .option('--limit <n>', 'Page limit', parseInt)
  .option('--email <email>', 'Filter by email')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().customers.list({
      offset: opts.offset,
      limit: opts.limit,
      email: opts.email,
    }));
  });

customersCmd.command('get <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().customers.get(id));
});

customersCmd.command('archive <id>').option('--reason <reason>').action(async function (this: Command, id: string, opts) {
  await run(this, () => getClient().customers.archive(id, opts.reason));
});

// Cards
const cardsCmd = program.command('cards').description('Debit cards');

cardsCmd.command('list')
  .option('--offset <n>', 'Page offset', parseInt)
  .option('--limit <n>', 'Page limit', parseInt)
  .option('--account-id <id>', 'Filter by account')
  .option('--customer-id <id>', 'Filter by customer')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().cards.list({
      offset: opts.offset,
      limit: opts.limit,
      accountId: opts.accountId,
      customerId: opts.customerId,
    }));
  });

cardsCmd.command('get <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().cards.get(id));
});

cardsCmd.command('freeze <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().cards.freeze(id));
});

cardsCmd.command('unfreeze <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().cards.unfreeze(id));
});

cardsCmd.command('close <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().cards.close(id));
});

// Transactions
const txCmd = program.command('transactions').description('Transactions');

txCmd.command('list')
  .option('--offset <n>', 'Page offset', parseInt)
  .option('--limit <n>', 'Page limit', parseInt)
  .option('--account-id <id>', 'Filter by account')
  .option('--customer-id <id>', 'Filter by customer')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().transactions.list({
      offset: opts.offset,
      limit: opts.limit,
      accountId: opts.accountId,
      customerId: opts.customerId,
    }));
  });

txCmd.command('get <accountId> <transactionId>').action(async function (this: Command, accountId: string, transactionId: string) {
  await run(this, () => getClient().transactions.get(accountId, transactionId));
});

// Payments
const paymentsCmd = program.command('payments').description('ACH and book payments');

paymentsCmd.command('list')
  .option('--offset <n>', 'Page offset', parseInt)
  .option('--limit <n>', 'Page limit', parseInt)
  .option('--account-id <id>', 'Filter by account')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().payments.list({
      offset: opts.offset,
      limit: opts.limit,
      accountId: opts.accountId,
    }));
  });

paymentsCmd.command('get <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().payments.get(id));
});

paymentsCmd.command('ach')
  .requiredOption('--direction <dir>', 'Debit or Credit')
  .requiredOption('--amount <cents>', 'Amount in cents', parseInt)
  .requiredOption('--description <text>', 'Payment description')
  .requiredOption('--account-id <id>', 'Source account ID')
  .option('--counterparty-id <id>', 'Counterparty ID')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().payments.createAch({
      direction: opts.direction,
      amount: opts.amount,
      description: opts.description,
      accountId: opts.accountId,
      counterpartyId: opts.counterpartyId,
    }));
  });

paymentsCmd.command('book')
  .requiredOption('--amount <cents>', 'Amount in cents', parseInt)
  .requiredOption('--description <text>', 'Payment description')
  .requiredOption('--account-id <id>', 'Source account ID')
  .requiredOption('--counterparty-account-id <id>', 'Destination account ID')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().payments.createBook({
      amount: opts.amount,
      description: opts.description,
      accountId: opts.accountId,
      counterpartyAccountId: opts.counterpartyAccountId,
    }));
  });

// Counterparties
const cpCmd = program.command('counterparties').description('ACH counterparties');

cpCmd.command('list')
  .option('--offset <n>', 'Page offset', parseInt)
  .option('--limit <n>', 'Page limit', parseInt)
  .option('--customer-id <id>', 'Filter by customer')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().counterparties.list({
      offset: opts.offset,
      limit: opts.limit,
      customerId: opts.customerId,
    }));
  });

cpCmd.command('create')
  .requiredOption('--name <name>', 'Counterparty name')
  .requiredOption('--routing-number <n>', 'Routing number')
  .requiredOption('--account-number <n>', 'Account number')
  .requiredOption('--account-type <type>', 'Checking or Savings')
  .requiredOption('--type <type>', 'Business, Person, or Unknown')
  .requiredOption('--customer-id <id>', 'Customer ID')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().counterparties.create({
      name: opts.name,
      routingNumber: opts.routingNumber,
      accountNumber: opts.accountNumber,
      accountType: opts.accountType,
      type: opts.type,
      customerId: opts.customerId,
    }));
  });

cpCmd.command('delete <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().counterparties.delete(id));
});

// Webhooks
const webhooksCmd = program.command('webhooks').description('Webhooks');

webhooksCmd.command('list')
  .option('--offset <n>', 'Page offset', parseInt)
  .option('--limit <n>', 'Page limit', parseInt)
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().webhooks.list({ offset: opts.offset, limit: opts.limit }));
  });

webhooksCmd.command('create')
  .requiredOption('--label <label>', 'Webhook label')
  .requiredOption('--url <url>', 'Webhook URL')
  .requiredOption('--token <token>', 'Webhook token')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().webhooks.create({
      label: opts.label,
      url: opts.url,
      token: opts.token,
    }));
  });

webhooksCmd.command('delete <id>').action(async function (this: Command, id: string) {
  await run(this, () => getClient().webhooks.delete(id));
});

// Events
const eventsCmd = program.command('events').description('Events');

eventsCmd.command('list')
  .option('--offset <n>', 'Page offset', parseInt)
  .option('--limit <n>', 'Page limit', parseInt)
  .option('--since <iso>', 'Filter since')
  .option('--until <iso>', 'Filter until')
  .action(async function (this: Command, opts) {
    await run(this, () => getClient().events.list({
      offset: opts.offset,
      limit: opts.limit,
      since: opts.since,
      until: opts.until,
    }));
  });

program.parse();
