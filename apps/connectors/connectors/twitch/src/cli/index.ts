#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { createServer } from 'http';
import { Twitch } from '../api';
import {
  getClientId,
  getClientSecret,
  setClientId,
  setClientSecret,
  getAccessToken,
  getRefreshToken,
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
  saveTokens,
  getLogin,
  setLogin,
  isTokenExpired,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn, formatViewers, truncate } from '../utils/output';

const CONNECTOR_NAME = 'connect-twitch';
const VERSION = '0.1.0';
const DEFAULT_REDIRECT_URI = 'http://localhost:8889/callback';
const DEFAULT_SCOPES = [
  'user:read:email',
  'moderator:read:chatters',
  'user:write:chat',
  'moderator:read:followers',
];

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Twitch Helix API connector - users, channels, streams, chat, followers')
  .version(VERSION)
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
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Twitch {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();

  if (!clientId || !clientSecret) {
    error(`No Twitch credentials configured. Run "${CONNECTOR_NAME} auth login" to authenticate.`);
    process.exit(1);
  }
  if (!accessToken && !refreshToken) {
    error(`Not authenticated. Run "${CONNECTOR_NAME} auth login" to authenticate.`);
    process.exit(1);
  }

  return new Twitch({ clientId, clientSecret, accessToken, refreshToken });
}

const authCmd = program.command('auth').description('Authentication management');

authCmd
  .command('login')
  .description('Authenticate with Twitch OAuth2')
  .option('--client-id <id>', 'Twitch Client ID')
  .option('--client-secret <secret>', 'Twitch Client Secret')
  .option('--redirect-uri <uri>', 'OAuth2 redirect URI', DEFAULT_REDIRECT_URI)
  .option('--scope <scopes>', 'OAuth2 scopes (comma-separated)', DEFAULT_SCOPES.join(','))
  .action(async (opts) => {
    const clientId = opts.clientId || getClientId();
    const clientSecret = opts.clientSecret || getClientSecret();

    if (!clientId) {
      error('Twitch Client ID is required. Register at https://dev.twitch.tv/console/apps');
      process.exit(1);
    }
    if (!clientSecret) {
      error('Twitch Client Secret is required.');
      process.exit(1);
    }

    setClientId(clientId);
    setClientSecret(clientSecret);

    const scopes = opts.scope.split(',').map((s: string) => s.trim());
    const state = Math.random().toString(36).substring(7);
    const authUrl = Twitch.getAuthorizationUrl(clientId, opts.redirectUri, scopes, state);

    info('Opening browser for authentication...');
    info(`If the browser does not open, visit: ${authUrl}`);

    try {
      const { exec } = await import('child_process');
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} "${authUrl}"`);
    } catch {
      // ignore
    }

    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const errorParam = url.searchParams.get('error');

      if (errorParam) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authentication Failed</h1><p>${errorParam}</p></body></html>`);
        server.close();
        error(`Authentication failed: ${errorParam}`);
        process.exit(1);
      }

      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Invalid State</h1></body></html>');
        server.close();
        error('State mismatch - possible CSRF attack');
        process.exit(1);
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>No Code</h1></body></html>');
        server.close();
        error('No authorization code received');
        process.exit(1);
      }

      try {
        const tokens = await Twitch.exchangeCode(clientId, clientSecret, code, opts.redirectUri);
        saveTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresIn, tokens.scope);

        const twitch = new Twitch({ clientId, clientSecret, accessToken: tokens.accessToken });
        const user = await twitch.users.getUser();
        if (user) setLogin(user.login);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authentication Successful!</h1><p>Welcome, ${user?.displayName ?? 'user'}!</p></body></html>`);
        server.close();
        success(`Authenticated as: ${user?.login ?? 'unknown'}`);
        info(`Profile: ${getCurrentProfile()}`);
        process.exit(0);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Error</h1><p>${String(err)}</p></body></html>`);
        server.close();
        error(`Token exchange failed: ${err}`);
        process.exit(1);
      }
    });

    const port = parseInt(new URL(opts.redirectUri).port || '8889', 10);
    server.listen(port, () => info(`Waiting for OAuth2 callback on port ${port}...`));
  });

authCmd.command('logout').description('Clear authentication').action(() => {
  clearConfig();
  success('Logged out successfully');
});

authCmd.command('status').description('Show authentication status').action(async () => {
  const profile = getCurrentProfile();
  const clientId = getClientId();
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();
  const login = getLogin();
  const expired = isTokenExpired();

  console.log(chalk.bold(`Profile: ${profile}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Client ID: ${clientId ? `${clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Login: ${login || chalk.gray('not set')}`);
  info(`Access Token: ${accessToken ? (expired ? chalk.yellow('expired') : chalk.green('valid')) : chalk.gray('not set')}`);
  info(`Refresh Token: ${refreshToken ? chalk.green('set') : chalk.gray('not set')}`);

  const clientSecret = getClientSecret();
  if (accessToken && clientId && clientSecret) {
    try {
      const twitch = getClient();
      const user = await twitch.users.getUser();
      if (user) success(`Authenticated as: ${user.displayName} (@${user.login})`);
    } catch (err) {
      warn(`Token validation failed: ${err}`);
    }
  }
});

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    const config = loadProfile(p);
    const active = p === current ? chalk.green(' (active)') : '';
    const login = config.login ? chalk.gray(` - ${config.login}`) : '';
    console.log(`  ${p}${active}${login}`);
  }
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create a new profile').option('--use', 'Switch after creation').action((name: string, opts) => {
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

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

program
  .command('user [login]')
  .description('Get Twitch user info (defaults to authenticated user)')
  .action(async (login: string | undefined) => {
    try {
      const twitch = getClient();
      const user = await twitch.users.getUser(login);
      if (!user) {
        error('User not found');
        process.exit(1);
      }
      print(user, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search <query>')
  .description('Search Twitch channels')
  .option('-l, --limit <n>', 'Number of results', '10')
  .action(async (query: string, opts) => {
    try {
      const twitch = getClient();
      const channels = await twitch.search.searchChannels(query, parseInt(opts.limit, 10));
      const format = getFormat(program);
      if (format === 'json') {
        print(channels, format);
        return;
      }
      channels.forEach((c, i) => {
        const live = c.isLive ? chalk.red(' LIVE') : '';
        console.log(chalk.cyan(`[${i + 1}]`) + ` ${c.displayName}${live}`);
        console.log(`    ${chalk.gray(`@${c.broadcasterLogin}`)} | ${c.gameName || 'no game'}`);
        console.log(`    ${chalk.gray(truncate(c.title, 80))}`);
        console.log();
      });
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('channel <broadcasterId>')
  .description('Get channel information')
  .action(async (broadcasterId: string) => {
    try {
      const twitch = getClient();
      const channel = await twitch.channels.getChannelInfo(broadcasterId);
      if (!channel) {
        error('Channel not found');
        process.exit(1);
      }
      print(channel, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('streams')
  .description('List live streams')
  .option('--game-id <id>', 'Filter by game ID')
  .option('--user <login>', 'Filter by user login')
  .option('-l, --limit <n>', 'Number of streams', '20')
  .action(async (opts) => {
    try {
      const twitch = getClient();
      const streams = await twitch.streams.getStreams({
        gameId: opts.gameId,
        userLogin: opts.user,
        first: parseInt(opts.limit, 10),
      });
      const format = getFormat(program);
      if (format === 'json') {
        print(streams, format);
        return;
      }
      streams.forEach((s, i) => {
        console.log(chalk.cyan(`[${i + 1}]`) + ` ${s.userName} — ${s.title}`);
        console.log(`    ${chalk.gray(s.gameName)} | ${chalk.yellow(formatViewers(s.viewerCount))} viewers`);
        console.log();
      });
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('chatters <broadcasterId> <moderatorId>')
  .description('List chatters in a channel')
  .option('-l, --limit <n>', 'Number of chatters', '50')
  .action(async (broadcasterId: string, moderatorId: string, opts) => {
    try {
      const twitch = getClient();
      const result = await twitch.chat.listChatters(broadcasterId, moderatorId, parseInt(opts.limit, 10));
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('send <broadcasterId> <senderId> <message>')
  .description('Send a chat message')
  .action(async (broadcasterId: string, senderId: string, message: string) => {
    try {
      const twitch = getClient();
      const result = await twitch.chat.sendChatMessage(broadcasterId, senderId, message);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('followers <broadcasterId>')
  .description('List channel followers')
  .option('-l, --limit <n>', 'Number of followers', '20')
  .action(async (broadcasterId: string, opts) => {
    try {
      const twitch = getClient();
      const result = await twitch.followers.listFollowers(broadcasterId, parseInt(opts.limit, 10));
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
