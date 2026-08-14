#!/usr/bin/env bun
import { Command } from 'commander';
import { Talkdesk } from '../api';
import { TalkdeskApiError } from '../types';
import {
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  setClientId,
  setClientSecret,
  setAccessToken,
  setBaseUrl,
  setAuthUrl,
  clearConfig,
  isAuthenticated,
  resolveConfig,
  loadConfig,
} from '../utils/config';
import { setVerbose } from '../utils/logger';
import { print, success, error, info, type OutputFormat } from '../utils/output';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('connect-talkdesk')
  .description('CLI for the Talkdesk cloud contact center API')
  .version(VERSION)
  .option('-p, --profile <name>', 'Use a specific configuration profile')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-v, --verbose', 'Enable debug output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
    if (opts.verbose) {
      setVerbose(true);
    }
  });

function getFormat(): OutputFormat {
  const fmt = program.opts().format as string;
  return (['json', 'table', 'pretty'].includes(fmt) ? fmt : 'pretty') as OutputFormat;
}

function getClient(): Talkdesk {
  if (!isAuthenticated()) {
    error('Not authenticated. Set credentials with:');
    info('  connect-talkdesk config set-client-id <id>');
    info('  connect-talkdesk config set-client-secret <secret>');
    info('  connect-talkdesk config set-auth-url https://<account>.talkdeskid.com/oauth/token');
    info('Or export TALKDESK_CLIENT_ID / TALKDESK_CLIENT_SECRET / TALKDESK_AUTH_URL.');
    process.exit(1);
  }
  return new Talkdesk(resolveConfig());
}

function handleError(err: unknown): never {
  if (err instanceof TalkdeskApiError) {
    error(`${err.getUserMessage()} (HTTP ${err.statusCode})`);
  } else {
    error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
}

// ============================================
// config commands
// ============================================

const config = program.command('config').description('Manage credentials and settings');

config
  .command('set-client-id <id>')
  .description('Store the OAuth client ID')
  .action((id: string) => {
    setClientId(id);
    success('Client ID saved');
  });

config
  .command('set-client-secret <secret>')
  .description('Store the OAuth client secret')
  .action((secret: string) => {
    setClientSecret(secret);
    success('Client secret saved');
  });

config
  .command('set-access-token <token>')
  .description('Store a pre-obtained bearer access token')
  .action((token: string) => {
    setAccessToken(token);
    success('Access token saved');
  });

config
  .command('set-base-url <url>')
  .description('Override the API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success('Base URL saved');
  });

config
  .command('set-auth-url <url>')
  .description('Override the OAuth token endpoint')
  .action((url: string) => {
    setAuthUrl(url);
    success('Auth URL saved');
  });

config
  .command('show')
  .description('Show the current profile configuration (secrets masked)')
  .action(() => {
    const cfg = loadConfig();
    const mask = (v?: string) => (v ? `${v.substring(0, 4)}...` : undefined);
    print(
      {
        profile: getCurrentProfile(),
        authenticated: isAuthenticated(),
        clientId: mask(cfg.clientId),
        clientSecret: cfg.clientSecret ? '***' : undefined,
        accessToken: cfg.accessToken ? '***' : undefined,
        baseUrl: cfg.baseUrl,
        authUrl: cfg.authUrl,
      },
      getFormat()
    );
  });

config
  .command('clear')
  .description('Clear the current profile configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// profile commands
// ============================================

const profile = program.command('profile').description('Manage configuration profiles');

profile
  .command('list')
  .description('List profiles')
  .action(() => {
    const profiles = listProfiles();
    print({ current: getCurrentProfile(), profiles }, getFormat());
  });

profile
  .command('create <name>')
  .description('Create a profile')
  .action((name: string) => {
    createProfile(name);
    success(`Profile "${name}" created`);
  });

profile
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    setCurrentProfile(name);
    success(`Switched to profile "${name}"`);
  });

profile
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    deleteProfile(name);
    success(`Profile "${name}" deleted`);
  });

// ============================================
// users commands
// ============================================

const users = program.command('users').description('Users API');

users
  .command('list')
  .description('List users')
  .option('--page <n>', 'Page number', (v) => parseInt(v, 10))
  .option('--per-page <n>', 'Results per page', (v) => parseInt(v, 10))
  .action(async (opts) => {
    try {
      const result = await getClient().users.list({ page: opts.page, perPage: opts.perPage });
      print(result, getFormat());
    } catch (err) {
      handleError(err);
    }
  });

users
  .command('get <id>')
  .description('Get a user by ID')
  .action(async (id: string) => {
    try {
      print(await getClient().users.get(id), getFormat());
    } catch (err) {
      handleError(err);
    }
  });

users
  .command('me')
  .description('Get the user for the current access token')
  .action(async () => {
    try {
      print(await getClient().users.me(), getFormat());
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// contacts commands
// ============================================

const contacts = program.command('contacts').description('Contacts API');

contacts
  .command('list')
  .description('List contacts')
  .option('--page <n>', 'Page number', (v) => parseInt(v, 10))
  .option('--per-page <n>', 'Results per page', (v) => parseInt(v, 10))
  .action(async (opts) => {
    try {
      const result = await getClient().contacts.list({ page: opts.page, perPage: opts.perPage });
      print(result, getFormat());
    } catch (err) {
      handleError(err);
    }
  });

contacts
  .command('get <id>')
  .description('Get a contact by ID')
  .action(async (id: string) => {
    try {
      print(await getClient().contacts.get(id), getFormat());
    } catch (err) {
      handleError(err);
    }
  });

contacts
  .command('create <name>')
  .description('Create a contact')
  .option('--email <email>', 'Primary email address')
  .option('--phone <number>', 'Primary phone number')
  .option('--company <company>', 'Company name')
  .action(async (name: string, opts) => {
    try {
      const result = await getClient().contacts.create({
        name,
        emails: opts.email ? [{ email: opts.email }] : undefined,
        phones: opts.phone ? [{ number: opts.phone }] : undefined,
        company: opts.company,
      });
      print(result, getFormat());
    } catch (err) {
      handleError(err);
    }
  });

contacts
  .command('delete <id>')
  .description('Delete a contact')
  .action(async (id: string) => {
    try {
      await getClient().contacts.delete(id);
      success(`Contact ${id} deleted`);
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// reports commands (Explore API)
// ============================================

const reports = program.command('reports').description('Explore reporting API');

reports
  .command('calls-create')
  .description('Create a calls report job')
  .option('--start <iso>', 'ISO 8601 start timestamp')
  .option('--end <iso>', 'ISO 8601 end timestamp')
  .option('--report-format <fmt>', 'Report file format (csv, json, json_bulk)')
  .action(async (opts) => {
    try {
      const result = await getClient().reports.createCallsJob({
        timespan_start: opts.start,
        timespan_end: opts.end,
        format: opts.reportFormat,
      });
      print(result, getFormat());
    } catch (err) {
      handleError(err);
    }
  });

reports
  .command('calls-status <jobId>')
  .description('Get the status of a calls report job')
  .action(async (jobId: string) => {
    try {
      print(await getClient().reports.getCallsJob(jobId), getFormat());
    } catch (err) {
      handleError(err);
    }
  });

program.parseAsync(process.argv).catch(handleError);
