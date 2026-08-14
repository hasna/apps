#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Connector, verifyWebhookSignature } from '../api';
import {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getAccountId,
  setAccountId,
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-stripe-webhooks-advanced';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe webhook endpoints, events, and signature verification')
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
      process.env.STRIPE_WEBHOOKS_ADVANCED_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_WEBHOOKS_ADVANCED_API_KEY.`);
    process.exit(1);
  }
  return new Connector({ apiKey, apiSecret: getApiSecret(), accountId: getAccountId(), baseUrl: getBaseUrl() });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

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
    success('Profiles:');
    profiles.forEach((p) => {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
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
  .option('--api-secret <secret>', 'Webhook signing secret')
  .option('--base-url <url>', 'Custom Stripe API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, apiSecret: opts.apiSecret, baseUrl: opts.baseUrl });
    if (opts.use) setCurrentProfile(name);
    success(`Created profile: ${name}`);
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (!deleteProfile(name)) {
      error(`Could not delete profile "${name}"`);
      process.exit(1);
    }
    success(`Deleted profile: ${name}`);
  });

const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('set-key <key>')
  .description('Set the Stripe API key')
  .action((key: string) => {
    setApiKey(key);
    success('API key saved');
  });

configCmd
  .command('set-secret <secret>')
  .description('Set the webhook signing secret (whsec_...)')
  .action((secret: string) => {
    setApiSecret(secret);
    success('Webhook signing secret saved');
  });

configCmd
  .command('set-account <accountId>')
  .description('Set Stripe account ID (required for org API keys)')
  .action((accountId: string) => {
    setAccountId(accountId);
    success('Account ID saved');
  });

configCmd
  .command('set-base-url <url>')
  .description('Set a custom Stripe API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success('Base URL saved');
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();
    print({
      profile: getCurrentProfile(),
      configDir: getConfigDir(),
      apiKey: apiKey ? `${apiKey.substring(0, 6)}...` : undefined,
      apiSecret: apiSecret ? `${apiSecret.substring(0, 8)}...` : undefined,
      accountId: getAccountId(),
      baseUrl: getBaseUrl(),
    });
  });

configCmd
  .command('clear')
  .description('Clear current profile configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

const webhooksCmd = program.command('webhooks').description('Manage webhook endpoints');

webhooksCmd
  .command('list')
  .description('List webhook endpoints')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('--starting-after <id>', 'Pagination cursor')
  .action(async function (this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.webhooks.list({
        limit: Number.parseInt(opts.limit, 10),
        starting_after: opts.startingAfter,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('get <id>')
  .description('Get a webhook endpoint')
  .action(async function (this: Command, id: string) {
    try {
      const result = await getClient().webhooks.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a webhook endpoint')
  .requiredOption('--url <url>', 'Endpoint URL')
  .requiredOption('--events <events>', 'Comma-separated enabled events')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata JSON object')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().webhooks.create({
        url: opts.url,
        enabled_events: opts.events.split(',').map((e: string) => e.trim()),
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('update <id>')
  .description('Update a webhook endpoint')
  .option('--url <url>', 'Endpoint URL')
  .option('--events <events>', 'Comma-separated enabled events')
  .option('--disabled <boolean>', 'Disable endpoint')
  .option('-d, --description <text>', 'Description')
  .option('--metadata <json>', 'Metadata JSON object')
  .action(async function (this: Command, id: string, opts) {
    try {
      const result = await getClient().webhooks.update(id, {
        url: opts.url,
        enabled_events: opts.events ? opts.events.split(',').map((e: string) => e.trim()) : undefined,
        disabled: opts.disabled === 'true' ? true : opts.disabled === 'false' ? false : undefined,
        description: opts.description,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <id>')
  .description('Delete a webhook endpoint')
  .action(async function (this: Command, id: string) {
    try {
      const result = await getClient().webhooks.del(id);
      success('Webhook endpoint deleted');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('View Stripe events');

eventsCmd
  .command('list')
  .description('List events')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('--type <type>', 'Filter by event type')
  .option('--starting-after <id>', 'Pagination cursor')
  .option('--delivery-success <boolean>', 'Filter by delivery success')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().events.list({
        limit: Number.parseInt(opts.limit, 10),
        type: opts.type,
        starting_after: opts.startingAfter,
        delivery_success: opts.deliverySuccess === 'true' ? true : opts.deliverySuccess === 'false' ? false : undefined,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('get <id>')
  .description('Get an event by ID')
  .action(async function (this: Command, id: string) {
    try {
      const result = await getClient().events.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('search')
  .description('Search events by type and filters')
  .option('--query <type>', 'Event type filter (alias for --type)')
  .option('--type <type>', 'Event type filter')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('--starting-after <id>', 'Pagination cursor')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().events.search({
        query: opts.query,
        type: opts.type,
        limit: Number.parseInt(opts.limit, 10),
        starting_after: opts.startingAfter,
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const verifyCmd = program.command('verify').description('Verify webhook signatures locally');

verifyCmd
  .command('signature')
  .description('Verify a Stripe-Signature against a raw payload')
  .requiredOption('--payload <text>', 'Raw JSON payload string')
  .requiredOption('--signature <header>', 'Stripe-Signature header value')
  .option('--secret <secret>', 'Webhook signing secret (overrides profile/env)')
  .option('--tolerance <seconds>', 'Timestamp tolerance in seconds', '300')
  .action((opts) => {
    const secret = opts.secret || getApiSecret();
    if (!secret) {
      error('Webhook signing secret required. Use --secret or config set-secret.');
      process.exit(1);
    }

    const result = verifyWebhookSignature({
      payload: opts.payload,
      signature: opts.signature,
      secret,
      tolerance: Number.parseInt(opts.tolerance, 10),
    });

    if (!result.valid) {
      error(result.error || 'Invalid signature');
      process.exit(1);
    }

    success('Signature valid');
    print(result.event);
  });

verifyCmd
  .command('file')
  .description('Verify signature using a payload file')
  .requiredOption('--file <path>', 'Path to raw payload file')
  .requiredOption('--signature <header>', 'Stripe-Signature header value')
  .option('--secret <secret>', 'Webhook signing secret')
  .option('--tolerance <seconds>', 'Timestamp tolerance', '300')
  .action((opts) => {
    const secret = opts.secret || getApiSecret();
    if (!secret) {
      error('Webhook signing secret required');
      process.exit(1);
    }

    const payload = readFileSync(opts.file, 'utf-8');
    const result = verifyWebhookSignature({
      payload,
      signature: opts.signature,
      secret,
      tolerance: Number.parseInt(opts.tolerance, 10),
    });

    if (!result.valid) {
      error(result.error || 'Invalid signature');
      process.exit(1);
    }

    success('Signature valid');
    print(result.event);
  });

program
  .command('raw-request')
  .description('Authenticated passthrough to any Stripe /v1 path')
  .requiredOption('--path <path>', 'API path (e.g. /webhook_endpoints)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--params <json>', 'Query parameters as JSON')
  .option('--body <json>', 'Request body as JSON (POST/PUT/PATCH)')
  .action(async function (this: Command, opts) {
    try {
      const result = await getClient().rawRequest({
        method: opts.method,
        path: opts.path,
        params: opts.params ? JSON.parse(opts.params) : undefined,
        body: opts.body ? JSON.parse(opts.body) : undefined,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
