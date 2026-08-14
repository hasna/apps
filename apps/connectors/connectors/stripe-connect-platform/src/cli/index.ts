#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getAccountId,
  setAccountId,
  getConnectedAccountId,
  setConnectedAccountId,
  getApiVersion,
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
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-stripe-connect-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Connect Platform API connector - connected accounts, onboarding, transfers, and platform fees')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('--stripe-account <accountId>', 'Connected account ID (Stripe-Account header)')
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
      process.env.STRIPE_CONNECT_PLATFORM_API_KEY = opts.apiKey;
    }
    if (opts.stripeAccount) {
      process.env.STRIPE_CONNECT_PLATFORM_CONNECTED_ACCOUNT_ID = opts.stripeAccount;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_CONNECT_PLATFORM_API_KEY.`);
    process.exit(1);
  }

  return new Connector({
    apiKey,
    accountId: getAccountId(),
    connectedAccountId: getConnectedAccountId(),
    apiVersion: getApiVersion(),
    baseUrl: getBaseUrl(),
  });
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
  info(`Connected Account: ${config.connectedAccountId || chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set platform API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-account <accountId>').description('Set org account ID (sk_org_* keys)').action((accountId: string) => {
  if (!accountId.startsWith('acct_')) {
    warn('Account ID should start with "acct_"');
  }
  setAccountId(accountId);
  success(`Account ID saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-connected-account <accountId>').description('Set default connected account (Stripe-Account)').action((accountId: string) => {
  if (!accountId.startsWith('acct_')) {
    warn('Connected account ID should start with "acct_"');
  }
  setConnectedAccountId(accountId);
  success(`Connected account saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Account ID: ${getAccountId() || chalk.gray('not set')}`);
  info(`Connected Account: ${getConnectedAccountId() || chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Accounts
const accountsCmd = program.command('accounts').description('Connected account management');

accountsCmd
  .command('list')
  .description('List connected accounts')
  .option('--limit <n>', 'Limit results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd.command('get <id>').description('Get a connected account').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.accounts.get(id), getFormat(accountsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

accountsCmd
  .command('create')
  .description('Create a connected account')
  .requiredOption('--type <type>', 'Account type: standard, express, or custom')
  .option('--country <code>', 'Country code (e.g. US)')
  .option('--email <email>', 'Account email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.create({
        type: opts.type,
        country: opts.country,
        email: opts.email,
      });
      success('Account created');
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('update <id>')
  .description('Update a connected account')
  .option('--email <email>', 'Account email')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.update(id, {
        email: opts.email,
      });
      success('Account updated');
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd.command('delete <id>').description('Delete a connected account').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.accounts.del(id), getFormat(accountsCmd));
    success('Account deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Account links
const accountLinksCmd = program.command('account-links').description('Account onboarding links');

accountLinksCmd
  .command('create')
  .description('Create an account link for onboarding or updates')
  .requiredOption('--account <id>', 'Connected account ID')
  .requiredOption('--refresh-url <url>', 'URL if link expires or is visited again')
  .requiredOption('--return-url <url>', 'URL after onboarding completes')
  .requiredOption('--type <type>', 'account_onboarding or account_update')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.accountLinks.create({
        account: opts.account,
        refresh_url: opts.refreshUrl,
        return_url: opts.returnUrl,
        type: opts.type,
      });
      success('Account link created');
      print(result, getFormat(accountLinksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Login links
const loginLinksCmd = program.command('login-links').description('Express Dashboard login links');

loginLinksCmd.command('create <accountId>').description('Create a login link for a connected account').action(async (accountId: string) => {
  try {
    const client = getClient();
    const result = await client.loginLinks.create(accountId);
    success('Login link created');
    print(result, getFormat(loginLinksCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Transfers
const transfersCmd = program.command('transfers').description('Transfer funds to connected accounts');

transfersCmd
  .command('list')
  .description('List transfers')
  .option('--limit <n>', 'Limit results')
  .option('--destination <id>', 'Filter by destination account')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.transfers.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        destination: opts.destination,
      });
      print(result, getFormat(transfersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transfersCmd.command('get <id>').description('Get a transfer').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.transfers.get(id), getFormat(transfersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

transfersCmd
  .command('create')
  .description('Create a transfer to a connected account')
  .requiredOption('--amount <cents>', 'Amount in cents')
  .requiredOption('--currency <code>', 'Currency code (e.g. usd)')
  .requiredOption('--destination <id>', 'Destination connected account ID')
  .option('--description <text>', 'Transfer description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.transfers.create({
        amount: parseInt(opts.amount, 10),
        currency: opts.currency,
        destination: opts.destination,
        description: opts.description,
      });
      success('Transfer created');
      print(result, getFormat(transfersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transfersCmd
  .command('reverse <transferId>')
  .description('Reverse a transfer (fully or partially)')
  .option('--amount <cents>', 'Amount to reverse in cents')
  .action(async (transferId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.transfers.createReversal(transferId, {
        amount: opts.amount ? parseInt(opts.amount, 10) : undefined,
      });
      success('Transfer reversed');
      print(result, getFormat(transfersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Application fees
const feesCmd = program.command('application-fees').description('Platform application fees');

feesCmd
  .command('list')
  .description('List application fees')
  .option('--limit <n>', 'Limit results')
  .option('--charge <id>', 'Filter by charge ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.applicationFees.list({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        charge: opts.charge,
      });
      print(result, getFormat(feesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

feesCmd.command('get <id>').description('Get an application fee').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.applicationFees.get(id), getFormat(feesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

feesCmd
  .command('refund <feeId>')
  .description('Refund an application fee')
  .option('--amount <cents>', 'Amount to refund in cents')
  .action(async (feeId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.applicationFees.createRefund(feeId, {
        amount: opts.amount ? parseInt(opts.amount, 10) : undefined,
      });
      success('Application fee refunded');
      print(result, getFormat(feesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request
const rawCmd = program.command('request').description('Raw Stripe API request');

rawCmd
  .command('call <path>')
  .description('Make a raw API request (path relative to /v1, e.g. /accounts)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--param <key=value>', 'Query parameter (repeatable)', (val: string, prev: string[]) => [...prev, val], [] as string[])
  .action(async (path: string, opts: { method: string; param: string[] }) => {
    try {
      const client = getClient();
      const params: Record<string, string> = {};
      for (const p of opts.param) {
        const [key, ...rest] = p.split('=');
        if (key) params[key] = rest.join('=');
      }
      const result = await client.raw.request(path, {
        method: opts.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        params,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
