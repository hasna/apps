#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getAccountId,
  setAccountId,
  getApiVersion,
  setApiVersion,
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
import type { CardholderBilling, CardholderIndividual, Metadata } from '../types';

const CONNECTOR_NAME = 'connect-stripe-issuing';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Issuing API connector CLI')
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
      process.env.STRIPE_ISSUING_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_ISSUING_API_KEY.`);
    process.exit(1);
  }
  return new Connector({
    apiKey,
    accountId: getAccountId(),
    apiVersion: getApiVersion(),
    baseUrl: process.env.STRIPE_ISSUING_BASE_URL,
  });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

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
    error(`Profile "${name}" does not exist`);
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
  if (config.accountId) info(`Account ID: ${config.accountId}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-account <accountId>').description('Set account ID (org keys)').action((accountId: string) => {
  if (!accountId.startsWith('acct_')) warn('Account ID should start with "acct_"');
  setAccountId(accountId);
  success(`Account ID saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-version <version>').description('Set Stripe API version header').action((version: string) => {
  setApiVersion(version);
  success(`API version saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Account ID: ${getAccountId() || chalk.gray('not set')}`);
  info(`API Version: ${getApiVersion() || chalk.gray('default')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const cardholdersCmd = program.command('cardholders').description('Manage issuing cardholders');

cardholdersCmd
  .command('list')
  .description('List cardholders')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('--status <status>', 'Filter by status (active, blocked, inactive)')
  .option('--email <email>', 'Filter by email')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().cardholders.list({
        limit: parseInt(opts.limit, 10),
        status: opts.status,
        email: opts.email,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardholdersCmd.command('get <id>').description('Get a cardholder').action(async function (this: Command, id: string) {
  try {
    print(await getClient().cardholders.get(id), getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

cardholdersCmd
  .command('create')
  .description('Create a cardholder')
  .requiredOption('--type <type>', 'individual or company')
  .requiredOption('--name <name>', 'Cardholder name')
  .requiredOption('--billing <json>', 'Billing address JSON')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .option('--individual <json>', 'Individual details JSON')
  .option('--metadata <json>', 'Metadata JSON')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().cardholders.create({
        type: opts.type,
        name: opts.name,
        billing: parseJsonOption(opts.billing, '--billing') as unknown as CardholderBilling,
        email: opts.email,
        phone_number: opts.phone,
        individual: opts.individual
          ? parseJsonOption(opts.individual, '--individual') as unknown as CardholderIndividual
          : undefined,
        metadata: opts.metadata ? parseJsonOption(opts.metadata, '--metadata') as Metadata : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardholdersCmd
  .command('update <id>')
  .description('Update a cardholder')
  .option('--email <email>', 'Email address')
  .option('--status <status>', 'Status (active, blocked, inactive)')
  .option('--metadata <json>', 'Metadata JSON')
  .action(async function (this: Command, id: string, opts) {
    try {
      const result = await getClient().cardholders.update(id, {
        email: opts.email,
        status: opts.status,
        metadata: opts.metadata ? parseJsonOption(opts.metadata, '--metadata') as Metadata : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const cardsCmd = program.command('cards').description('Manage issuing cards');

cardsCmd
  .command('list')
  .description('List cards')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('--cardholder <id>', 'Filter by cardholder')
  .option('--status <status>', 'Filter by status')
  .option('--type <type>', 'Filter by type (physical, virtual)')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().cards.list({
        limit: parseInt(opts.limit, 10),
        cardholder: opts.cardholder,
        status: opts.status,
        type: opts.type,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardsCmd.command('get <id>').description('Get a card').action(async function (this: Command, id: string) {
  try {
    print(await getClient().cards.get(id), getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

cardsCmd
  .command('create')
  .description('Create a card')
  .requiredOption('--cardholder <id>', 'Cardholder ID')
  .requiredOption('--currency <currency>', 'Three-letter ISO currency code')
  .requiredOption('--type <type>', 'physical or virtual')
  .option('--metadata <json>', 'Metadata JSON')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().cards.create({
        cardholder: opts.cardholder,
        currency: opts.currency,
        type: opts.type,
        metadata: opts.metadata ? parseJsonOption(opts.metadata, '--metadata') as Metadata : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardsCmd
  .command('update <id>')
  .description('Update a card')
  .option('--status <status>', 'Status (active, inactive, canceled)')
  .option('--metadata <json>', 'Metadata JSON')
  .action(async function (this: Command, id: string, opts) {
    try {
      const result = await getClient().cards.update(id, {
        status: opts.status,
        metadata: opts.metadata ? parseJsonOption(opts.metadata, '--metadata') as Metadata : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardsCmd
  .command('search <query>')
  .description('Search cards')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .action(async function (this: Command, query: string, opts) {
    try {
      const result = await getClient().cards.search(query, { limit: parseInt(opts.limit, 10) });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const authCmd = program.command('authorizations').description('Manage issuing authorizations');

authCmd
  .command('list')
  .description('List authorizations')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('--card <id>', 'Filter by card')
  .option('--cardholder <id>', 'Filter by cardholder')
  .option('--status <status>', 'Filter by status')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().authorizations.list({
        limit: parseInt(opts.limit, 10),
        card: opts.card,
        cardholder: opts.cardholder,
        status: opts.status,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd.command('get <id>').description('Get an authorization').action(async function (this: Command, id: string) {
  try {
    print(await getClient().authorizations.get(id), getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

authCmd.command('approve <id>').description('Approve an authorization').action(async function (this: Command, id: string) {
  try {
    print(await getClient().authorizations.approve(id), getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

authCmd.command('decline <id>').description('Decline an authorization').action(async function (this: Command, id: string) {
  try {
    print(await getClient().authorizations.decline(id), getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const txCmd = program.command('transactions').description('Manage issuing transactions');

txCmd
  .command('list')
  .description('List transactions')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('--card <id>', 'Filter by card')
  .option('--cardholder <id>', 'Filter by cardholder')
  .option('--type <type>', 'Filter by type (capture, refund)')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().transactions.list({
        limit: parseInt(opts.limit, 10),
        card: opts.card,
        cardholder: opts.cardholder,
        type: opts.type,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

txCmd.command('get <id>').description('Get a transaction').action(async function (this: Command, id: string) {
  try {
    print(await getClient().transactions.get(id), getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const eventsCmd = program.command('events').description('List Stripe events (including issuing)');

eventsCmd
  .command('list')
  .description('List events')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('--type <type>', 'Filter by event type (e.g. issuing_authorization.created)')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().events.list({
        limit: parseInt(opts.limit, 10),
        type: opts.type,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd.command('get <id>').description('Get an event').action(async function (this: Command, id: string) {
  try {
    print(await getClient().events.get(id), getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program
  .command('raw <path>')
  .description('Raw API request escape hatch')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body JSON (POST/PATCH)')
  .action(async function (this: Command, path: string, opts) {
    try {
      const method = opts.method.toUpperCase();
      const body = opts.body ? parseJsonOption(opts.body, '--body') : undefined;
      const result = await getClient().raw.request(path, { method, body });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
