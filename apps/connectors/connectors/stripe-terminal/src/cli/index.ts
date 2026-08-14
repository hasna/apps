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

const CONNECTOR_NAME = 'connect-stripe-terminal';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Terminal API connector - in-person payments hardware and POS')
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
      process.env.STRIPE_TERMINAL_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_TERMINAL_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({
    apiKey,
    accountId: getAccountId(),
    apiVersion: getApiVersion(),
  });
}

function parseMetadata(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    error('Metadata must be valid JSON');
    process.exit(1);
  }
}

// ============================================
// Profile Commands
// ============================================
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
  if (config.accountId) {
    info(`Account ID: ${config.accountId}`);
  }
});

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-account <accountId>').description('Set account ID (required for org API keys)').action((accountId: string) => {
  if (!accountId.startsWith('acct_')) {
    warn('Account ID should start with "acct_"');
  }
  setAccountId(accountId);
  success(`Account ID saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-version <version>').description('Set Stripe API version').action((version: string) => {
  setApiVersion(version);
  success(`API version saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  const accountId = getAccountId();
  const apiVersion = getApiVersion();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  if (accountId) {
    info(`Account ID: ${accountId}`);
  }
  if (apiVersion) {
    info(`API Version: ${apiVersion}`);
  }
});

configCmd.command('clear').description('Clear active profile configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// ============================================
// Connection Tokens
// ============================================
const connectionTokensCmd = program.command('connection-tokens').description('Terminal connection tokens');

connectionTokensCmd
  .command('create')
  .description('Create a connection token for Terminal SDK')
  .option('--location <id>', 'Terminal location ID')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.connectionTokens.create(
        opts.location ? { location: opts.location } : undefined
      );
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ============================================
// Locations
// ============================================
const locationsCmd = program.command('locations').description('Terminal locations');

locationsCmd
  .command('list')
  .description('List terminal locations')
  .option('--limit <n>', 'Limit results', parseInt)
  .option('--starting-after <id>', 'Pagination cursor')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.locations.list({
        limit: opts.limit,
        starting_after: opts.startingAfter,
      });
      print(result.data, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

locationsCmd
  .command('get <id>')
  .description('Retrieve a terminal location')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.locations.get(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

locationsCmd
  .command('create')
  .description('Create a terminal location')
  .requiredOption('--display-name <name>', 'Display name')
  .requiredOption('--line1 <address>', 'Address line 1')
  .option('--line2 <address>', 'Address line 2')
  .requiredOption('--city <city>', 'City')
  .option('--state <state>', 'State/province')
  .requiredOption('--postal-code <code>', 'Postal code')
  .requiredOption('--country <code>', 'Country code (ISO 2-letter)')
  .option('--metadata <json>', 'Metadata JSON object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.locations.create({
        display_name: opts.displayName,
        address: {
          line1: opts.line1,
          line2: opts.line2,
          city: opts.city,
          state: opts.state,
          postal_code: opts.postalCode,
          country: opts.country,
        },
        metadata: parseMetadata(opts.metadata),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

locationsCmd
  .command('update <id>')
  .description('Update a terminal location')
  .option('--display-name <name>', 'Display name')
  .option('--line1 <address>', 'Address line 1')
  .option('--line2 <address>', 'Address line 2')
  .option('--city <city>', 'City')
  .option('--state <state>', 'State/province')
  .option('--postal-code <code>', 'Postal code')
  .option('--country <code>', 'Country code')
  .option('--metadata <json>', 'Metadata JSON object')
  .action(async (id: string, opts, cmd) => {
    try {
      const client = getClient();
      const address = (opts.line1 || opts.line2 || opts.city || opts.state || opts.postalCode || opts.country)
        ? {
            line1: opts.line1,
            line2: opts.line2,
            city: opts.city,
            state: opts.state,
            postal_code: opts.postalCode,
            country: opts.country,
          }
        : undefined;
      const result = await client.locations.update(id, {
        display_name: opts.displayName,
        address,
        metadata: parseMetadata(opts.metadata),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

locationsCmd
  .command('delete <id>')
  .description('Delete a terminal location')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.locations.del(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ============================================
// Readers
// ============================================
const readersCmd = program.command('readers').description('Terminal readers');

readersCmd
  .command('list')
  .description('List terminal readers')
  .option('--limit <n>', 'Limit results', parseInt)
  .option('--location <id>', 'Filter by location')
  .option('--status <status>', 'Filter by status (online, offline)')
  .option('--device-type <type>', 'Filter by device type')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.readers.list({
        limit: opts.limit,
        location: opts.location,
        status: opts.status,
        device_type: opts.deviceType,
      });
      print(result.data, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

readersCmd
  .command('get <id>')
  .description('Retrieve a terminal reader')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.readers.get(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

readersCmd
  .command('create')
  .description('Register a terminal reader')
  .requiredOption('--registration-code <code>', 'Reader registration code')
  .requiredOption('--label <label>', 'Reader label')
  .option('--location <id>', 'Terminal location ID')
  .option('--metadata <json>', 'Metadata JSON object')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.readers.create({
        registration_code: opts.registrationCode,
        label: opts.label,
        location: opts.location,
        metadata: parseMetadata(opts.metadata),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

readersCmd
  .command('update <id>')
  .description('Update a terminal reader')
  .option('--label <label>', 'Reader label')
  .option('--metadata <json>', 'Metadata JSON object')
  .action(async (id: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.readers.update(id, {
        label: opts.label,
        metadata: parseMetadata(opts.metadata),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

readersCmd
  .command('delete <id>')
  .description('Delete a terminal reader')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.readers.del(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

readersCmd
  .command('process-payment-intent <id>')
  .description('Process a payment intent on a reader')
  .requiredOption('--payment-intent <id>', 'Payment intent ID')
  .option('--skip-tipping', 'Skip tipping on reader')
  .action(async (id: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.readers.processPaymentIntent(id, {
        payment_intent: opts.paymentIntent,
        process_config: opts.skipTipping ? { skip_tipping: true } : undefined,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

readersCmd
  .command('process-setup-intent <id>')
  .description('Process a setup intent on a reader')
  .requiredOption('--setup-intent <id>', 'Setup intent ID')
  .action(async (id: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.readers.processSetupIntent(id, {
        setup_intent: opts.setupIntent,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

readersCmd
  .command('cancel-action <id>')
  .description('Cancel the current reader action')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.readers.cancelAction(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ============================================
// Configurations
// ============================================
const configurationsCmd = program.command('configurations').description('Terminal configurations');

configurationsCmd
  .command('list')
  .description('List terminal configurations')
  .option('--limit <n>', 'Limit results', parseInt)
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.configurations.list({ limit: opts.limit });
      print(result.data, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

configurationsCmd
  .command('get <id>')
  .description('Retrieve a terminal configuration')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.configurations.get(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

configurationsCmd
  .command('create')
  .description('Create a terminal configuration')
  .option('--name <name>', 'Configuration name')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.configurations.create(
        opts.name ? { name: opts.name } : undefined
      );
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

configurationsCmd
  .command('update <id>')
  .description('Update a terminal configuration')
  .option('--name <name>', 'Configuration name')
  .action(async (id: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.configurations.update(id, {
        name: opts.name,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

configurationsCmd
  .command('delete <id>')
  .description('Delete a terminal configuration')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.configurations.del(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
