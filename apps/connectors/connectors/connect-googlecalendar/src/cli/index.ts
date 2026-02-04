#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { createServer } from 'http';
import { GoogleCalendar, CALENDAR_SCOPES, GoogleCalendarClient } from '../api';
import {
  getAccessToken,
  setAccessToken,
  setTokens,
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
  saveProfile,
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  getRefreshToken,
  isTokenExpired,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-googlecalendar';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Google Calendar API connector - manage calendars and events with OAuth2 authentication')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
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
    // Set access token from flag if provided
    if (opts.token) {
      process.env.GOOGLE_CALENDAR_ACCESS_TOKEN = opts.token;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
async function getClient(): Promise<GoogleCalendar> {
  let accessToken = getAccessToken();

  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} auth login" to authenticate or set GOOGLE_CALENDAR_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }

  // Check if token is expired and we have refresh token
  if (isTokenExpired()) {
    const refreshToken = getRefreshToken();
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (refreshToken && clientId && clientSecret) {
      info('Access token expired, refreshing...');
      try {
        const client = new GoogleCalendar({
          accessToken,
          refreshToken,
          clientId,
          clientSecret,
        });
        const tokens = await client.refreshAccessToken();
        setTokens({ accessToken: tokens.accessToken, expiresIn: tokens.expiresIn });
        accessToken = tokens.accessToken;
        success('Token refreshed successfully');
      } catch (err) {
        warn(`Failed to refresh token: ${err}. You may need to re-authenticate.`);
      }
    }
  }

  const refreshToken = getRefreshToken();
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  return new GoogleCalendar({ accessToken, refreshToken, clientId, clientSecret });
}

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Manage OAuth2 authentication');

authCmd
  .command('setup')
  .description('Configure OAuth2 client credentials')
  .requiredOption('--client-id <id>', 'Google OAuth2 Client ID')
  .requiredOption('--client-secret <secret>', 'Google OAuth2 Client Secret')
  .action((opts) => {
    setClientId(opts.clientId);
    setClientSecret(opts.clientSecret);
    success(`OAuth2 credentials saved to profile: ${getCurrentProfile()}`);
    info(`\nNext steps:`);
    info(`1. Run "${CONNECTOR_NAME} auth login" to authenticate`);
  });

const REDIRECT_PORT = 8091;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

authCmd
  .command('login')
  .description('Authenticate with Google Calendar (opens browser)')
  .action(async () => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (!clientId || !clientSecret) {
      error(`OAuth2 credentials not configured. Run "${CONNECTOR_NAME} auth setup" first or set credentials in profile.`);
      process.exit(1);
    }

    // Generate auth URL with localhost redirect
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: CALENDAR_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    info('Starting local server for OAuth callback...');

    // Start callback server
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const errorParam = url.searchParams.get('error');

        if (errorParam) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;"><div style="text-align: center;"><h1 style="color: #dc3545;">Authentication Failed</h1><p>Error: ${errorParam}</p><p>You can close this window.</p></div></body></html>`);
          server.close();
          error(`Authentication failed: ${errorParam}`);
          process.exit(1);
          return;
        }

        if (code) {
          try {
            info('Exchanging authorization code for tokens...');
            const tokens = await GoogleCalendar.exchangeCodeForTokens(code, clientId, clientSecret, REDIRECT_URI);

            setTokens({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresIn: tokens.expiresIn,
            });

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;"><div style="text-align: center;"><h1 style="color: #28a745;">Authentication Successful!</h1><p>You can close this window and return to the terminal.</p></div></body></html>`);
            server.close();

            success('Authentication successful!');
            info(`Tokens saved to profile: ${getCurrentProfile()}`);
            process.exit(0);
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;"><div style="text-align: center;"><h1 style="color: #dc3545;">Authentication Failed</h1><p>Error: ${String(err)}</p><p>You can close this window.</p></div></body></html>`);
            server.close();
            error(`Authentication failed: ${err}`);
            process.exit(1);
          }
        }
      }
    });

    server.listen(REDIRECT_PORT, () => {
      info(`\nOpening browser for authentication...`);
      info(`If the browser doesn't open, visit:\n${chalk.cyan(authUrl)}\n`);

      // Open browser
      const { exec } = require('child_process');
      const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${openCmd} "${authUrl}"`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      error('Authentication timed out');
      process.exit(1);
    }, 5 * 60 * 1000);
  });

authCmd
  .command('url')
  .description('Generate OAuth2 authorization URL')
  .option('--redirect-uri <uri>', 'Redirect URI', 'urn:ietf:wg:oauth:2.0:oob')
  .option('--scopes <scopes>', 'Comma-separated list of scopes')
  .action((opts) => {
    const clientId = getClientId();
    if (!clientId) {
      error(`No client ID configured. Run "${CONNECTOR_NAME} auth setup" first.`);
      process.exit(1);
    }

    const scopes = opts.scopes ? opts.scopes.split(',') : CALENDAR_SCOPES;
    const url = GoogleCalendar.getAuthorizationUrl(clientId, opts.redirectUri, scopes);

    console.log(chalk.bold('\nAuthorization URL:\n'));
    console.log(chalk.cyan(url));
    console.log(chalk.bold('\nInstructions:'));
    info('1. Open the URL above in your browser');
    info('2. Sign in with your Google account and authorize access');
    info(`3. Copy the authorization code and run: ${CONNECTOR_NAME} auth callback <code>`);
  });

authCmd
  .command('callback <code>')
  .description('Exchange authorization code for tokens')
  .option('--redirect-uri <uri>', 'Redirect URI (must match the one used in auth url)', 'urn:ietf:wg:oauth:2.0:oob')
  .action(async (code: string, opts) => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (!clientId || !clientSecret) {
      error(`OAuth2 credentials not configured. Run "${CONNECTOR_NAME} auth setup" first.`);
      process.exit(1);
    }

    try {
      info('Exchanging authorization code for tokens...');
      const tokens = await GoogleCalendar.exchangeCodeForTokens(code, clientId, clientSecret, opts.redirectUri);

      setTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      });

      success('Authentication successful!');
      info(`Access token saved to profile: ${getCurrentProfile()}`);
      if (tokens.refreshToken) {
        info('Refresh token saved (tokens will auto-refresh when expired)');
      }
    } catch (err) {
      error(`Authentication failed: ${err}`);
      process.exit(1);
    }
  });

authCmd
  .command('token <accessToken>')
  .description('Set access token directly (for pre-authenticated tokens)')
  .option('--refresh-token <token>', 'Refresh token')
  .action((accessToken: string, opts) => {
    setAccessToken(accessToken);
    if (opts.refreshToken) {
      const config = loadProfile();
      config.refreshToken = opts.refreshToken;
      saveProfile(config);
    }
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

authCmd
  .command('status')
  .description('Show authentication status')
  .action(async () => {
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();
    const clientId = getClientId();
    const profileName = getCurrentProfile();

    console.log(chalk.bold(`\nAuthentication Status (Profile: ${profileName})\n`));

    if (clientId) {
      info(`Client ID: ${clientId.substring(0, 20)}...`);
    } else {
      warn('Client ID: not configured');
    }

    if (accessToken) {
      info(`Access Token: ${accessToken.substring(0, 20)}...`);

      if (isTokenExpired()) {
        warn('Token status: EXPIRED');
      } else {
        success('Token status: Valid');
      }

      // Try to verify token by making a simple API call
      try {
        const client = await getClient();
        const calendars = await client.calendars.list({ maxResults: 1 });
        success(`Authenticated as: ${calendars.items?.[0]?.summary || 'Unknown'}`);
      } catch (err) {
        warn(`Token may be invalid: ${err}`);
      }
    } else {
      warn('Access Token: not configured');
    }

    if (refreshToken) {
      info('Refresh Token: configured');
    } else {
      warn('Refresh Token: not configured (tokens won\'t auto-refresh)');
    }
  });

authCmd
  .command('logout')
  .description('Clear authentication tokens')
  .action(() => {
    const config = loadProfile();
    delete config.accessToken;
    delete config.refreshToken;
    delete config.tokenExpiry;
    saveProfile(config);
    success(`Authentication cleared for profile: ${getCurrentProfile()}`);
  });

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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {});
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

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 20)}...` : chalk.gray('not set')}`);
    info(`Refresh Token: ${config.refreshToken ? 'configured' : chalk.gray('not set')}`);
    info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 20)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 20)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Calendar Commands
// ============================================
const calendarCmd = program
  .command('calendars')
  .description('Manage calendars');

calendarCmd
  .command('list')
  .description('List all calendars')
  .option('-n, --max <number>', 'Maximum results', '100')
  .option('--show-hidden', 'Show hidden calendars')
  .option('--show-deleted', 'Show deleted calendars')
  .action(async (opts) => {
    try {
      const client = await getClient();
      const result = await client.calendars.list({
        maxResults: parseInt(opts.max),
        showHidden: opts.showHidden,
        showDeleted: opts.showDeleted,
      });

      const format = getFormat(calendarCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        // Pretty format: show simplified calendar list
        const calendars = result.items.map(cal => ({
          id: cal.id,
          summary: cal.summary,
          accessRole: cal.accessRole,
          primary: cal.primary || false,
          timeZone: cal.timeZone,
        }));
        print(calendars, format);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarCmd
  .command('get <calendarId>')
  .description('Get a specific calendar')
  .action(async (calendarId: string) => {
    try {
      const client = await getClient();
      const result = await client.calendars.get(calendarId);
      print(result, getFormat(calendarCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Event Commands
// ============================================
const eventCmd = program
  .command('events')
  .description('Manage calendar events');

eventCmd
  .command('list')
  .description('List events')
  .option('-c, --calendar <id>', 'Calendar ID', 'primary')
  .option('-n, --max <number>', 'Maximum results', '10')
  .option('--from <date>', 'Start date (ISO format or "today")')
  .option('--to <date>', 'End date (ISO format)')
  .option('-q, --query <text>', 'Search query')
  .option('--order-by <field>', 'Order by (startTime, updated)', 'startTime')
  .option('--single-events', 'Expand recurring events', true)
  .action(async (opts) => {
    try {
      const client = await getClient();

      let timeMin = opts.from;
      if (opts.from === 'today') {
        timeMin = new Date().toISOString();
      }

      const result = await client.events.list(opts.calendar, {
        maxResults: parseInt(opts.max),
        timeMin,
        timeMax: opts.to,
        q: opts.query,
        orderBy: opts.orderBy,
        singleEvents: opts.singleEvents,
      });

      const format = getFormat(eventCmd);
      if (format === 'json') {
        print(result, format);
      } else {
        // Pretty format: show simplified event list
        const events = result.items.map(event => ({
          id: event.id,
          summary: event.summary || '(No title)',
          start: event.start?.dateTime || event.start?.date,
          end: event.end?.dateTime || event.end?.date,
          location: event.location,
          status: event.status,
        }));
        print(events, format);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('get <eventId>')
  .description('Get a specific event')
  .option('-c, --calendar <id>', 'Calendar ID', 'primary')
  .action(async (eventId: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.events.get(opts.calendar, eventId);
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('create')
  .description('Create a new event')
  .option('-c, --calendar <id>', 'Calendar ID', 'primary')
  .requiredOption('-s, --summary <text>', 'Event title')
  .option('-d, --description <text>', 'Event description')
  .option('-l, --location <text>', 'Event location')
  .requiredOption('--start <datetime>', 'Start date/time (ISO format or YYYY-MM-DD for all-day)')
  .requiredOption('--end <datetime>', 'End date/time (ISO format or YYYY-MM-DD for all-day)')
  .option('--timezone <tz>', 'Timezone (e.g., America/New_York)')
  .option('--attendees <emails>', 'Comma-separated list of attendee emails')
  .option('--notify', 'Send notifications to attendees')
  .action(async (opts) => {
    try {
      const client = await getClient();

      // Determine if all-day event (date only) or timed event
      const isAllDay = !opts.start.includes('T') && !opts.start.includes(':');

      const eventInput: Record<string, unknown> = {
        summary: opts.summary,
        description: opts.description,
        location: opts.location,
        start: isAllDay
          ? { date: opts.start }
          : { dateTime: opts.start, timeZone: opts.timezone },
        end: isAllDay
          ? { date: opts.end }
          : { dateTime: opts.end, timeZone: opts.timezone },
      };

      if (opts.attendees) {
        eventInput.attendees = opts.attendees.split(',').map((email: string) => ({ email: email.trim() }));
      }

      const result = await client.events.create(opts.calendar, eventInput as any, {
        sendUpdates: opts.notify ? 'all' : 'none',
      });

      success('Event created!');
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('quick <text>')
  .description('Quick add an event using natural language')
  .option('-c, --calendar <id>', 'Calendar ID', 'primary')
  .action(async (text: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.events.quickAdd(opts.calendar, text);
      success('Event created!');
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('update <eventId>')
  .description('Update an event')
  .option('-c, --calendar <id>', 'Calendar ID', 'primary')
  .option('-s, --summary <text>', 'Event title')
  .option('-d, --description <text>', 'Event description')
  .option('-l, --location <text>', 'Event location')
  .option('--start <datetime>', 'Start date/time')
  .option('--end <datetime>', 'End date/time')
  .option('--notify', 'Send notifications to attendees')
  .action(async (eventId: string, opts) => {
    try {
      const client = await getClient();

      const updates: Record<string, unknown> = {};
      if (opts.summary) updates.summary = opts.summary;
      if (opts.description) updates.description = opts.description;
      if (opts.location) updates.location = opts.location;
      if (opts.start) {
        const isAllDay = !opts.start.includes('T') && !opts.start.includes(':');
        updates.start = isAllDay ? { date: opts.start } : { dateTime: opts.start };
      }
      if (opts.end) {
        const isAllDay = !opts.end.includes('T') && !opts.end.includes(':');
        updates.end = isAllDay ? { date: opts.end } : { dateTime: opts.end };
      }

      const result = await client.events.update(opts.calendar, eventId, updates as any, {
        sendUpdates: opts.notify ? 'all' : 'none',
      });

      success('Event updated!');
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('delete <eventId>')
  .description('Delete an event')
  .option('-c, --calendar <id>', 'Calendar ID', 'primary')
  .option('--notify', 'Send notifications to attendees')
  .action(async (eventId: string, opts) => {
    try {
      const client = await getClient();
      await client.events.delete(opts.calendar, eventId, {
        sendUpdates: opts.notify ? 'all' : 'none',
      });
      success('Event deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('move <eventId>')
  .description('Move an event to another calendar')
  .option('-c, --calendar <id>', 'Source calendar ID', 'primary')
  .requiredOption('--to <calendarId>', 'Destination calendar ID')
  .option('--notify', 'Send notifications to attendees')
  .action(async (eventId: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.events.move(opts.calendar, eventId, opts.to, {
        sendUpdates: opts.notify ? 'all' : 'none',
      });
      success('Event moved!');
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('accept <eventId>')
  .description('Accept an event invitation')
  .option('-c, --calendar <id>', 'Calendar ID', 'primary')
  .option('--notify', 'Send notification to organizer')
  .option('--comment <text>', 'Optional comment')
  .action(async (eventId: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.events.accept(opts.calendar, eventId, {
        sendUpdates: opts.notify ? 'all' : 'none',
        comment: opts.comment,
      });
      success('Event accepted!');
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('decline <eventId>')
  .description('Decline an event invitation')
  .option('-c, --calendar <id>', 'Calendar ID', 'primary')
  .option('--notify', 'Send notification to organizer')
  .option('--comment <text>', 'Optional comment')
  .action(async (eventId: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.events.decline(opts.calendar, eventId, {
        sendUpdates: opts.notify ? 'all' : 'none',
        comment: opts.comment,
      });
      success('Event declined!');
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('tentative <eventId>')
  .description('Mark an event as tentative/maybe')
  .option('-c, --calendar <id>', 'Calendar ID', 'primary')
  .option('--notify', 'Send notification to organizer')
  .option('--comment <text>', 'Optional comment')
  .action(async (eventId: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.events.tentative(opts.calendar, eventId, {
        sendUpdates: opts.notify ? 'all' : 'none',
        comment: opts.comment,
      });
      success('Event marked as tentative!');
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('respond <eventId>')
  .description('Respond to an event invitation')
  .option('-c, --calendar <id>', 'Calendar ID', 'primary')
  .requiredOption('-r, --response <status>', 'Response: accepted, declined, or tentative')
  .option('--notify', 'Send notification to organizer')
  .option('--comment <text>', 'Optional comment')
  .action(async (eventId: string, opts) => {
    try {
      const response = opts.response as 'accepted' | 'declined' | 'tentative';
      if (!['accepted', 'declined', 'tentative'].includes(response)) {
        error('Response must be one of: accepted, declined, tentative');
        process.exit(1);
      }

      const client = await getClient();
      const result = await client.events.respond(opts.calendar, eventId, response, {
        sendUpdates: opts.notify ? 'all' : 'none',
        comment: opts.comment,
      });
      success(`Event response set to: ${response}!`);
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
