#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { createServer } from 'http';
import { GoogleContacts } from '../api';
import { ContactsApi } from '../api/contacts';
import {
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  getRedirectUri,
  setRedirectUri,
  saveTokens,
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
  hasOAuthCredentials,
  hasAccessTokens,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-googlecontacts';
const VERSION = '0.0.11';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Google Contacts (People API) connector CLI')
  .version(VERSION)
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
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): GoogleContacts {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();
  const redirectUri = getRedirectUri();

  if (!clientId || !clientSecret) {
    error(`No OAuth credentials configured. Run "${CONNECTOR_NAME} config set-credentials" first.`);
    process.exit(1);
  }

  if (!accessToken) {
    error(`No access token. Run "${CONNECTOR_NAME} auth login" to authenticate.`);
    process.exit(1);
  }

  return new GoogleContacts({
    clientId,
    clientSecret,
    accessToken,
    refreshToken,
    redirectUri,
  });
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
    // Get shared credentials (stored at base level, not in profile)
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Client ID: ${clientId ? `${clientId.substring(0, 15)}...` : chalk.gray('not set (shared)')}`);
    info(`Client Secret: ${clientSecret ? '***configured***' : chalk.gray('not set (shared)')}`);
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 15)}...` : chalk.gray('not set')}`);
    info(`Refresh Token: ${config.refreshToken ? '***configured***' : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-credentials')
  .description('Set OAuth client credentials')
  .requiredOption('--client-id <id>', 'Google OAuth Client ID')
  .requiredOption('--client-secret <secret>', 'Google OAuth Client Secret')
  .option('--redirect-uri <uri>', 'OAuth redirect URI', 'urn:ietf:wg:oauth:2.0:oob')
  .action((opts) => {
    setClientId(opts.clientId);
    setClientSecret(opts.clientSecret);
    if (opts.redirectUri) {
      setRedirectUri(opts.redirectUri);
    }
    success(`OAuth credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const clientId = getClientId();
    const accessToken = getAccessToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Client ID: ${clientId ? `${clientId.substring(0, 15)}...` : chalk.gray('not set')}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 15)}...` : chalk.gray('not set')}`);
    info(`OAuth Ready: ${hasOAuthCredentials() ? chalk.green('Yes') : chalk.red('No')}`);
    info(`Authenticated: ${hasAccessTokens() ? chalk.green('Yes') : chalk.red('No')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Authentication commands');

const REDIRECT_PORT = 8092;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts';

authCmd
  .command('login')
  .description('Authenticate with Google Contacts (opens browser)')
  .action(async () => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (!clientId || !clientSecret) {
      error(`OAuth credentials not configured. Run "${CONNECTOR_NAME} config set-credentials" first.`);
      process.exit(1);
    }

    // Generate auth URL with localhost redirect
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: CONTACTS_SCOPE,
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

            // Exchange code for tokens
            const client = new GoogleContacts({
              clientId,
              clientSecret,
              redirectUri: REDIRECT_URI,
            });
            const tokens = await client.exchangeCode(code);

            saveTokens({
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
  .description('Print authorization URL to open in browser')
  .option('--scopes <scopes>', 'OAuth scopes', 'https://www.googleapis.com/auth/contacts')
  .action((opts) => {
    if (!hasOAuthCredentials()) {
      error(`No OAuth credentials configured. Run "${CONNECTOR_NAME} config set-credentials" first.`);
      process.exit(1);
    }

    const clientId = getClientId()!;
    const clientSecret = getClientSecret()!;
    const redirectUri = getRedirectUri();

    const client = new GoogleContacts({
      clientId,
      clientSecret,
      redirectUri,
    });

    const url = client.getAuthorizationUrl(opts.scopes);
    console.log('\nOpen this URL in your browser to authorize:\n');
    console.log(chalk.cyan(url));
    console.log('\nAfter authorizing, copy the authorization code and run:');
    console.log(chalk.yellow(`  ${CONNECTOR_NAME} auth exchange --code <CODE>`));
  });

authCmd
  .command('exchange')
  .description('Exchange authorization code for tokens')
  .requiredOption('--code <code>', 'Authorization code from consent screen')
  .action(async (opts) => {
    if (!hasOAuthCredentials()) {
      error(`No OAuth credentials configured. Run "${CONNECTOR_NAME} config set-credentials" first.`);
      process.exit(1);
    }

    const clientId = getClientId()!;
    const clientSecret = getClientSecret()!;
    const redirectUri = getRedirectUri();

    const client = new GoogleContacts({
      clientId,
      clientSecret,
      redirectUri,
    });

    try {
      const tokens = await client.exchangeCode(opts.code);

      // Save tokens to profile
      saveTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      });

      success('Tokens saved successfully!');
      info(`Access Token: ${tokens.accessToken.substring(0, 20)}...`);
      if (tokens.refreshToken) {
        info(`Refresh Token: ${tokens.refreshToken.substring(0, 20)}...`);
      }
      if (tokens.expiresIn) {
        info(`Expires in: ${tokens.expiresIn} seconds`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd
  .command('refresh')
  .description('Refresh the access token')
  .action(async () => {
    if (!hasOAuthCredentials()) {
      error(`No OAuth credentials configured. Run "${CONNECTOR_NAME} config set-credentials" first.`);
      process.exit(1);
    }

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      error('No refresh token available. Run OAuth flow again.');
      process.exit(1);
    }

    const clientId = getClientId()!;
    const clientSecret = getClientSecret()!;
    const accessToken = getAccessToken();

    const client = new GoogleContacts({
      clientId,
      clientSecret,
      accessToken,
      refreshToken,
    });

    try {
      const tokens = await client.refreshAccessToken();

      saveTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      });

      success('Access token refreshed!');
      info(`New Access Token: ${tokens.accessToken.substring(0, 20)}...`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Contacts Commands
// ============================================
const contactsCmd = program
  .command('contacts')
  .description('Manage Google contacts');

contactsCmd
  .command('list')
  .description('List contacts')
  .option('-n, --max <number>', 'Maximum results', '25')
  .option('--page-token <token>', 'Page token for pagination')
  .option('--sort <order>', 'Sort order (LAST_MODIFIED_DESCENDING, FIRST_NAME_ASCENDING, etc.)', 'LAST_MODIFIED_DESCENDING')
  .option('--normalize', 'Output in normalized format')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.list({
        pageSize: parseInt(opts.max),
        pageToken: opts.pageToken,
        sortOrder: opts.sort,
      });

      if (opts.normalize) {
        const normalized = (result.connections || []).map(c => ContactsApi.normalize(c));
        print(normalized, getFormat(contactsCmd));
      } else {
        print(result, getFormat(contactsCmd));
      }

      if (result.nextPageToken) {
        info(`More results available. Use --page-token ${result.nextPageToken}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('get <resourceName>')
  .description('Get a contact by resource name')
  .option('--normalize', 'Output in normalized format')
  .action(async (resourceName: string, opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.get(resourceName);

      if (opts.normalize) {
        print(ContactsApi.normalize(result), getFormat(contactsCmd));
      } else {
        print(result, getFormat(contactsCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('create')
  .description('Create a new contact')
  .option('--given-name <name>', 'First/given name')
  .option('--family-name <name>', 'Last/family name')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .option('--organization <org>', 'Organization name')
  .option('--title <title>', 'Job title')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.create({
        givenName: opts.givenName,
        familyName: opts.familyName,
        emails: opts.email ? [opts.email] : undefined,
        phones: opts.phone ? [opts.phone] : undefined,
        organization: opts.organization || opts.title ? {
          name: opts.organization,
          title: opts.title,
        } : undefined,
      });

      success('Contact created!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('update <resourceName>')
  .description('Update a contact')
  .option('--given-name <name>', 'First/given name')
  .option('--family-name <name>', 'Last/family name')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .option('--organization <org>', 'Organization name')
  .option('--title <title>', 'Job title')
  .action(async (resourceName: string, opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.update(resourceName, {
        givenName: opts.givenName,
        familyName: opts.familyName,
        emails: opts.email ? [opts.email] : undefined,
        phones: opts.phone ? [opts.phone] : undefined,
        organization: opts.organization || opts.title ? {
          name: opts.organization,
          title: opts.title,
        } : undefined,
      });

      success('Contact updated!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('delete <resourceName>')
  .description('Delete a contact')
  .action(async (resourceName: string) => {
    try {
      const client = getClient();
      await client.contacts.delete(resourceName);
      success(`Contact ${resourceName} deleted.`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('search <query>')
  .description('Search contacts')
  .option('-n, --max <number>', 'Maximum results', '30')
  .option('--normalize', 'Output in normalized format')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.search({
        query,
        pageSize: parseInt(opts.max),
      });

      if (opts.normalize) {
        const contacts = (result.results || []).map(r => ContactsApi.normalize(r.person));
        print(contacts, getFormat(contactsCmd));
      } else {
        print(result, getFormat(contactsCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('export')
  .description('Export all contacts to JSONL file')
  .option('-o, --output <file>', 'Output file path', `contacts_${Date.now()}.jsonl`)
  .option('--normalize', 'Export in normalized format')
  .action(async (opts) => {
    try {
      const client = getClient();
      const file = Bun.file(opts.output);
      const writer = file.writer();

      let count = 0;
      for await (const contact of client.contacts.listAll()) {
        const data = opts.normalize ? ContactsApi.normalize(contact) : contact;
        writer.write(JSON.stringify(data) + '\n');
        count++;
        if (count % 100 === 0) {
          info(`Exported ${count} contacts...`);
        }
      }

      writer.end();
      success(`Exported ${count} contacts to ${opts.output}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('groups')
  .description('List contact groups')
  .option('-n, --max <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.listGroups(parseInt(opts.max));
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
