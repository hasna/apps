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
import type {
  VerificationSessionCreateParams,
  VerificationSessionUpdateParams,
  VerificationSessionOptions,
  DocumentType,
  Metadata,
} from '../types';

// Stripe Identity connector name and version
const CONNECTOR_NAME = 'connect-stripeidentity';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stripe Identity API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set API key from flag if provided
    if (opts.apiKey) {
      process.env.STRIPE_IDENTITY_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STRIPE_IDENTITY_API_KEY environment variable.`);
    process.exit(1);
  }
  const accountId = getAccountId();
  return new Connector({ apiKey, accountId });
}

// Parse metadata JSON option
function parseMetadata(value?: string): Metadata | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as Metadata;
}

// Build VerificationSession options from CLI flags (or raw JSON override)
function buildOptions(opts: {
  options?: string;
  allowedTypes?: string;
  requireIdNumber?: boolean;
  requireLiveCapture?: boolean;
  requireMatchingSelfie?: boolean;
}): VerificationSessionOptions | undefined {
  if (opts.options) {
    return JSON.parse(opts.options) as VerificationSessionOptions;
  }

  const document: Record<string, unknown> = {};
  if (opts.allowedTypes) {
    document.allowed_types = opts.allowedTypes.split(',').map(t => t.trim()) as DocumentType[];
  }
  if (opts.requireIdNumber) document.require_id_number = true;
  if (opts.requireLiveCapture) document.require_live_capture = true;
  if (opts.requireMatchingSelfie) document.require_matching_selfie = true;

  if (Object.keys(document).length === 0) {
    return undefined;
  }
  return { document } as VerificationSessionOptions;
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
    const isOrgKey = config.apiKey?.startsWith('sk_org_');

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    if (isOrgKey || config.accountId) {
      info(`Account ID: ${config.accountId || chalk.yellow('not set')}`);
    }
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
  .description('Set account ID (required for org API keys)')
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
    const isOrgKey = apiKey?.startsWith('sk_org_');

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    if (isOrgKey) {
      info(`Account ID: ${accountId || chalk.yellow('not set (required for org keys)')}`);
    } else if (accountId) {
      info(`Account ID: ${accountId}`);
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
// Verification Sessions Commands
// ============================================
const sessionsCmd = program
  .command('sessions')
  .description('Manage Identity verification sessions');

sessionsCmd
  .command('list')
  .description('List all verification sessions')
  .option('-l, --limit <number>', 'Maximum number of sessions', '10')
  .option('--status <status>', 'Filter by status (requires_input, processing, verified, canceled)')
  .option('--related-customer <id>', 'Filter by related customer ID')
  .option('--client-reference-id <id>', 'Filter by client reference ID')
  .option('--starting-after <id>', 'Cursor for pagination')
  .option('--ending-before <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.verificationSessions.list({
        limit: parseInt(opts.limit),
        status: opts.status,
        related_customer: opts.relatedCustomer,
        client_reference_id: opts.clientReferenceId,
        starting_after: opts.startingAfter,
        ending_before: opts.endingBefore,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('get <id>')
  .description('Retrieve a verification session by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.verificationSessions.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('create')
  .description('Create a verification session')
  .option('--type <type>', 'Verification type (document, id_number)', 'document')
  .option('--verification-flow <id>', 'Verification flow ID (overrides --type)')
  .option('--allowed-types <types>', 'Comma-separated document types (driving_license,id_card,passport)')
  .option('--require-id-number', 'Require the document to include an ID number')
  .option('--require-live-capture', 'Require a live capture (disallow uploads)')
  .option('--require-matching-selfie', 'Require a selfie matching the document')
  .option('--options <json>', 'Raw options object as JSON (overrides other option flags)')
  .option('--provided-email <email>', 'Email address of the person being verified')
  .option('--provided-phone <phone>', 'Phone number of the person being verified')
  .option('--related-customer <id>', 'Related Stripe customer ID')
  .option('--client-reference-id <id>', 'Your reference ID for this session')
  .option('--return-url <url>', 'URL to redirect to after verification')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const providedDetails: { email?: string; phone?: string } = {};
      if (opts.providedEmail) providedDetails.email = opts.providedEmail;
      if (opts.providedPhone) providedDetails.phone = opts.providedPhone;

      const params: VerificationSessionCreateParams = {
        options: buildOptions(opts),
        metadata: parseMetadata(opts.metadata),
        related_customer: opts.relatedCustomer,
        client_reference_id: opts.clientReferenceId,
        return_url: opts.returnUrl,
        provided_details: Object.keys(providedDetails).length ? providedDetails : undefined,
      };
      if (opts.verificationFlow) {
        params.verification_flow = opts.verificationFlow;
      } else {
        params.type = opts.type;
      }

      const result = await client.verificationSessions.create(params);
      success('Verification session created');
      if (result.url) info(`Verification URL: ${result.url}`);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('update <id>')
  .description('Update a verification session (only while requires_input)')
  .option('--type <type>', 'Verification type (document, id_number)')
  .option('--allowed-types <types>', 'Comma-separated document types (driving_license,id_card,passport)')
  .option('--require-id-number', 'Require the document to include an ID number')
  .option('--require-live-capture', 'Require a live capture (disallow uploads)')
  .option('--require-matching-selfie', 'Require a selfie matching the document')
  .option('--options <json>', 'Raw options object as JSON (overrides other option flags)')
  .option('--metadata <json>', 'Metadata as JSON')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const params: VerificationSessionUpdateParams = {
        type: opts.type,
        options: buildOptions(opts),
        metadata: parseMetadata(opts.metadata),
      };
      const result = await client.verificationSessions.update(id, params);
      success('Verification session updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('cancel <id>')
  .description('Cancel a verification session')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.verificationSessions.cancel(id);
      success('Verification session canceled');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('redact <id>')
  .description('Redact a verification session (permanently removes collected data)')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.verificationSessions.redact(id);
      success('Verification session redacted');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Verification Reports Commands
// ============================================
const reportsCmd = program
  .command('reports')
  .description('Access Identity verification reports');

reportsCmd
  .command('list')
  .description('List all verification reports')
  .option('-l, --limit <number>', 'Maximum number of reports', '10')
  .option('--type <type>', 'Filter by type (document, id_number)')
  .option('--verification-session <id>', 'Filter by verification session ID')
  .option('--client-reference-id <id>', 'Filter by client reference ID')
  .option('--starting-after <id>', 'Cursor for pagination')
  .option('--ending-before <id>', 'Cursor for pagination')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.verificationReports.list({
        limit: parseInt(opts.limit),
        type: opts.type,
        verification_session: opts.verificationSession,
        client_reference_id: opts.clientReferenceId,
        starting_after: opts.startingAfter,
        ending_before: opts.endingBefore,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('get <id>')
  .description('Retrieve a verification report by ID')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.verificationReports.get(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
