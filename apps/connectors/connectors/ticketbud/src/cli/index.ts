#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Ticketbud } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getClientId,
  getClientSecret,
  setOAuthCredentials,
  clearConfig,
  clearOAuthTokens,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
  saveOAuthTokens,
  isAuthenticated,
} from '../utils/config';
import { getAuthUrl, startCallbackServer, getRedirectUri } from '../utils/auth';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-ticketbud';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Ticketbud event ticketing API connector')
  .version(VERSION)
  .option('-t, --access-token <token>', 'Access token (overrides profile)')
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
    if (opts.accessToken) {
      process.env.TICKETBUD_ACCESS_TOKEN = opts.accessToken;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Ticketbud {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set TICKETBUD_ACCESS_TOKEN.`);
    process.exit(1);
  }
  return new Ticketbud({ accessToken });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  }
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create profile').action((name: string) => {
  if (!createProfile(name)) {
    error(`Profile "${name}" already exists`);
    process.exit(1);
  }
  success(`Profile "${name}" created`);
});

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Access token: ${config.accessToken ? `${config.accessToken.slice(0, 8)}...` : chalk.gray('not set')}`);
  info(`Client ID: ${config.clientId ? `${config.clientId.slice(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-token <token>').description('Save access token').action((token: string) => {
  setAccessToken(token);
  success(`Access token saved to profile: ${getCurrentProfile()}`);
});

configCmd
  .command('set-credentials <clientId> <clientSecret>')
  .description('Save OAuth client credentials')
  .action((clientId: string, clientSecret: string) => {
    setOAuthCredentials(clientId, clientSecret);
    success(`OAuth credentials saved to profile: ${getCurrentProfile()}`);
    info(`Redirect URI for Ticketbud app: ${getRedirectUri()}`);
  });

configCmd.command('show').description('Show configuration').action(() => {
  const profileName = getCurrentProfile();
  const token = getAccessToken();
  console.log(chalk.bold(`Active profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Access token: ${token ? `${token.slice(0, 8)}...` : chalk.gray('not set')}`);
  info(`Client ID: ${getClientId() ? `${getClientId()!.slice(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear active profile config').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const oauthCmd = program.command('oauth').description('OAuth2 authentication');

oauthCmd.command('login').description('Authorize via OAuth2').action(async () => {
  if (!getClientId() || !getClientSecret()) {
    error('OAuth credentials not configured. Run "config set-credentials" first.');
    process.exit(1);
  }

  info('Open this URL in your browser to authorize:');
  console.log(getAuthUrl());
  info('Waiting for callback...');

  const result = await startCallbackServer();
  if (result.success && result.tokens) {
    saveOAuthTokens(result.tokens);
    success('Authenticated successfully');
  } else {
    error(result.error || 'Authentication failed');
    process.exit(1);
  }
});

oauthCmd.command('status').description('Check auth status').action(() => {
  if (isAuthenticated()) {
    success('Authenticated');
  } else {
    info('Not authenticated');
  }
});

oauthCmd.command('logout').description('Clear stored tokens').action(() => {
  clearOAuthTokens();
  success('Tokens cleared');
});

program.command('me').description('Get current Ticketbud user').action(async () => {
  try {
    const client = getClient();
    const result = await client.getMe();
    print(result, getFormat(program));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const eventsCmd = program.command('events').description('Event operations');

eventsCmd.command('list').description('List events').action(async () => {
  try {
    const client = getClient();
    print(await client.listEvents(), getFormat(eventsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

eventsCmd.command('get <eventId>').description('Get event by ID').action(async (eventId: string) => {
  try {
    const client = getClient();
    print(await client.getEvent(eventId), getFormat(eventsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

eventsCmd.command('totals <eventId>').description('Get event sales totals').action(async (eventId: string) => {
  try {
    const client = getClient();
    print(await client.getEventTotals(eventId), getFormat(eventsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const ticketsCmd = program.command('tickets').description('Ticket operations');

ticketsCmd.command('list <eventId>').description('List tickets for an event').action(async (eventId: string) => {
  try {
    const client = getClient();
    print(await client.listTickets(eventId), getFormat(ticketsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

ticketsCmd
  .command('get <eventId> <ticketId>')
  .description('Get ticket by ID or barcode')
  .action(async (eventId: string, ticketId: string) => {
    try {
      const client = getClient();
      print(await client.getTicket(eventId, ticketId), getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('check-in <eventId> <ticketId>')
  .description('Check in a ticket')
  .option('--reverse', 'Reverse check-in')
  .action(async (eventId: string, ticketId: string, opts: { reverse?: boolean }) => {
    try {
      const client = getClient();
      print(await client.checkInTicket(eventId, ticketId, { reverse: opts.reverse }), getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
