#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { TrueLayer } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getSandbox,
  setSandbox,
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

const CONNECTOR_NAME = 'connect-truelayer';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TrueLayer open banking API connector CLI - Payments, Events, Search with multi-profile support')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('--sandbox', 'Use sandbox environment')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.sandbox) {
      process.env.TRUELAYER_SANDBOX = 'true';
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TrueLayer {
  const accessToken = getAccessToken();
  const sandbox = getSandbox();
  const baseUrl = getBaseUrl();

  if (!accessToken) {
    error(`No TrueLayer access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set TRUELAYER_ACCESS_TOKEN.`);
    process.exit(1);
  }

  return new TrueLayer({ accessToken, sandbox, baseUrl });
}

function parseExtraHeaders(opts: { idempotencyKey?: string; signature?: string; headers?: string }): Record<string, string> | undefined {
  const headers: Record<string, string> = {};

  if (opts.idempotencyKey) {
    headers['Idempotency-Key'] = opts.idempotencyKey;
  }
  if (opts.signature) {
    headers['Tl-Signature'] = opts.signature;
  }
  if (opts.headers) {
    try {
      Object.assign(headers, JSON.parse(opts.headers));
    } catch {
      error('Invalid JSON for --headers');
      process.exit(1);
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
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

profileCmd.command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'TrueLayer access token')
  .option('--sandbox', 'Use sandbox environment')
  .option('--base-url <url>', 'Custom API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      accessToken: opts.token,
      sandbox: opts.sandbox,
      baseUrl: opts.baseUrl,
    });
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
  info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Environment: ${config.sandbox ? 'Sandbox' : 'Production'}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').description('Set TrueLayer access token').action((token: string) => {
  setAccessToken(token);
  success(`Access token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-sandbox <enabled>').description('Enable/disable sandbox (true/false)').action((enabled: string) => {
  const isSandbox = enabled === 'true' || enabled === '1';
  setSandbox(isSandbox);
  success(`Sandbox mode ${isSandbox ? 'enabled' : 'disabled'}`);
});

configCmd.command('set-base-url <url>').description('Set custom API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved: ${url}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const client = getAccessToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Access Token: ${client ? `${client.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Environment: ${getSandbox() ? 'Sandbox' : 'Production'}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Payments commands
const paymentsCmd = program.command('payments').description('Manage TrueLayer payments');

paymentsCmd.command('list')
  .description('List payments')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--limit <limit>', 'Result limit')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.payments.listPayments({
        cursor: opts.cursor,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      print(result, getFormat(paymentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

paymentsCmd.command('get <paymentId>').description('Get payment by ID').action(async (paymentId: string) => {
  try {
    const client = getClient();
    const payment = await client.payments.getPayment(paymentId);
    print(payment, getFormat(paymentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

paymentsCmd.command('create')
  .description('Create a payment')
  .option('--body <json>', 'Payment request body as JSON')
  .option('--body-file <path>', 'Path to JSON file with payment body')
  .option('--idempotency-key <key>', 'Idempotency-Key header (required for some payment APIs)')
  .option('--signature <sig>', 'Tl-Signature header (required for signed payment APIs)')
  .option('--headers <json>', 'Additional headers as JSON object')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else if (opts.body) {
        body = JSON.parse(opts.body);
      } else {
        error('Provide --body or --body-file with payment payload');
        process.exit(1);
      }

      const client = getClient();
      const payment = await client.payments.createPayment(body, parseExtraHeaders(opts));
      success(`Payment created: ${payment.id}`);
      print(payment, getFormat(paymentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Events commands
const eventsCmd = program.command('events').description('List TrueLayer events');

eventsCmd.command('list')
  .description('List events')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--limit <limit>', 'Result limit')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.events.listEvents({
        cursor: opts.cursor,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Search command
program.command('search')
  .description('Search TrueLayer data')
  .option('--body <json>', 'Search request body as JSON')
  .option('--body-file <path>', 'Path to JSON file with search body')
  .option('--headers <json>', 'Additional headers as JSON object')
  .action(async (opts) => {
    try {
      let body: Record<string, unknown> = {};
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else if (opts.body) {
        body = JSON.parse(opts.body);
      } else {
        error('Provide --body or --body-file with search payload');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.search.search(body, parseExtraHeaders(opts));
      print(result, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request passthrough
program.command('request <path>')
  .description('Make a raw API request')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body as JSON')
  .option('--body-file <path>', 'Path to JSON file with request body')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--headers <json>', 'Additional headers as JSON object')
  .option('--idempotency-key <key>', 'Idempotency-Key header')
  .option('--signature <sig>', 'Tl-Signature header')
  .action(async (path: string, opts) => {
    try {
      let body: unknown;
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else if (opts.body) {
        body = JSON.parse(opts.body);
      }

      let params: Record<string, string | number | boolean | undefined> | undefined;
      if (opts.query) {
        params = JSON.parse(opts.query);
      }

      const client = getClient();
      const result = await client.rawRequest(path, {
        method: opts.method.toUpperCase(),
        body,
        params,
        headers: parseExtraHeaders(opts),
      });
      print(result, (program.opts().format || 'pretty') as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
