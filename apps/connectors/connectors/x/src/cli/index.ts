#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { X } from '../api';
import {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getBearerToken,
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
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  getAccessToken,
  getRefreshToken,
  getTokenExpiresAt,
  getUserId,
  getUsername,
  saveOAuth2Tokens,
  saveOAuth1Tokens,
  clearUserTokens,
  hasUserAuth,
  hasOAuth2Auth,
  hasOAuth1Auth,
  getOAuth1AccessToken,
  getOAuth1AccessTokenSecret,
} from '../utils/config';
import {
  generatePKCE,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken as refreshOAuth2Token,
  revokeToken,
  startCallbackServer,
  getAuthenticatedUser,
  DEFAULT_SCOPES,
  OAUTH2_SCOPES,
  type OAuth2Scope,
} from '../api/oauth';
import {
  getRequestToken,
  buildOAuth1AuthorizationUrl,
  getAccessToken as getOAuth1AccessTokenFromX,
} from '../api/oauth1';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-x';
const VERSION = '0.0.14';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('X (Twitter) API v2 connector CLI - Tweets, users, and search')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-s, --api-secret <secret>', 'API secret (overrides config)')
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
    // Set API key/secret from flags if provided
    if (opts.apiKey) {
      process.env.X_API_KEY = opts.apiKey;
    }
    if (opts.apiSecret) {
      process.env.X_API_SECRET = opts.apiSecret;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): X {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();
  const bearerToken = getBearerToken();
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();
  const tokenExpiresAt = getTokenExpiresAt();
  const oauth1AccessToken = getOAuth1AccessToken();
  const oauth1AccessTokenSecret = getOAuth1AccessTokenSecret();

  if (!apiKey || !apiSecret) {
    error(`No API credentials configured. Run "${CONNECTOR_NAME} config set-key <key>" and "${CONNECTOR_NAME} config set-secret <secret>" or set X_API_KEY and X_API_SECRET environment variables.`);
    process.exit(1);
  }

  const client = new X({
    apiKey,
    apiSecret,
    bearerToken,
    clientId,
    clientSecret,
    accessToken,
    refreshToken,
    tokenExpiresAt,
    oauth1AccessToken,
    oauth1AccessTokenSecret,
  });

  // Set up token refresh callback to persist refreshed tokens
  client.setTokenRefreshCallback((tokens) => {
    saveOAuth2Tokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
  });

  return client;
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
  .option('--api-secret <secret>', 'API secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {});
    success(`Profile "${name}" created`);
    info('Note: App credentials are shared across all profiles. Use "config" commands to set them.');

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
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set (shared)')}`);
    info(`API Secret: ${apiSecret ? `${apiSecret.substring(0, 8)}...` : chalk.gray('not set (shared)')}`);
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
  .command('set-secret <apiSecret>')
  .description('Set API secret')
  .action((apiSecret: string) => {
    setApiSecret(apiSecret);
    success(`API secret saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Secret: ${apiSecret ? `${apiSecret.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Tweets Commands
// ============================================
const tweetsCmd = program
  .command('tweets')
  .alias('tweet')
  .description('Tweet operations');

tweetsCmd
  .command('get <id>')
  .description('Get a tweet by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.tweets.get(id);
      print(result, getFormat(tweetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('search <query>')
  .description('Search recent tweets')
  .option('-n, --max <number>', 'Maximum results (10-100)', '10')
  .option('--sort <order>', 'Sort order (recency, relevancy)', 'recency')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tweets.searchRecent({
        query,
        maxResults: Math.min(100, Math.max(10, parseInt(opts.max))),
        sortOrder: opts.sort as 'recency' | 'relevancy',
      });
      print(result, getFormat(tweetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('count <query>')
  .description('Get tweet counts for a query (recent)')
  .option('--start-time <iso8601>', 'Start time (ISO 8601 format)')
  .option('--end-time <iso8601>', 'End time (ISO 8601 format)')
  .option('--granularity <unit>', 'Time bucket granularity (minute, hour, day)', 'hour')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tweets.countRecent(query, {
        startTime: opts.startTime,
        endTime: opts.endTime,
        granularity: opts.granularity as 'minute' | 'hour' | 'day',
      });
      print(result, getFormat(tweetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('timeline <userId>')
  .description('Get a user\'s timeline')
  .option('-n, --max <number>', 'Maximum results', '10')
  .option('--no-replies', 'Exclude replies')
  .option('--no-retweets', 'Exclude retweets')
  .action(async (userId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tweets.getUserTimeline(userId, {
        maxResults: parseInt(opts.max),
        excludeReplies: !opts.replies,
        excludeRetweets: !opts.retweets,
      });
      print(result, getFormat(tweetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('mentions <userId>')
  .description('Get mentions of a user')
  .option('-n, --max <number>', 'Maximum results', '10')
  .action(async (userId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tweets.getUserMentions(userId, {
        maxResults: parseInt(opts.max),
      });
      print(result, getFormat(tweetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('likes <tweetId>')
  .description('Get users who liked a tweet')
  .option('-n, --max <number>', 'Maximum results', '100')
  .action(async (tweetId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tweets.getLikingUsers(tweetId, {
        maxResults: parseInt(opts.max),
      });
      print(result, getFormat(tweetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('retweets <tweetId>')
  .description('Get users who retweeted a tweet')
  .option('-n, --max <number>', 'Maximum results', '100')
  .action(async (tweetId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tweets.getRetweetedBy(tweetId, {
        maxResults: parseInt(opts.max),
      });
      print(result, getFormat(tweetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('quotes <tweetId>')
  .description('Get quote tweets of a tweet')
  .option('-n, --max <number>', 'Maximum results', '10')
  .action(async (tweetId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tweets.getQuoteTweets(tweetId, {
        maxResults: parseInt(opts.max),
      });
      print(result, getFormat(tweetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Users Commands
// ============================================
const usersCmd = program
  .command('users')
  .alias('user')
  .description('User operations');

usersCmd
  .command('get <identifier>')
  .description('Get a user by ID or username')
  .option('--by-id', 'Look up by ID instead of username')
  .action(async (identifier: string, opts) => {
    try {
      const client = getClient();
      const result = opts.byId
        ? await client.users.getById(identifier)
        : await client.users.getByUsername(identifier);
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('followers <userId>')
  .description('Get a user\'s followers')
  .option('-n, --max <number>', 'Maximum results', '100')
  .action(async (userId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.users.getFollowers(userId, {
        maxResults: parseInt(opts.max),
      });
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('following <userId>')
  .description('Get users that a user follows')
  .option('-n, --max <number>', 'Maximum results', '100')
  .action(async (userId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.users.getFollowing(userId, {
        maxResults: parseInt(opts.max),
      });
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('liked <userId>')
  .description('Get tweets liked by a user')
  .option('-n, --max <number>', 'Maximum results', '10')
  .action(async (userId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.users.getLikedTweets(userId, {
        maxResults: parseInt(opts.max),
      });
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('lists <userId>')
  .description('Get lists owned by a user')
  .option('-n, --max <number>', 'Maximum results', '100')
  .action(async (userId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.users.getOwnedLists(userId, {
        maxResults: parseInt(opts.max),
      });
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Authenticate with X (OAuth 2.0 browser login)');

authCmd
  .command('status')
  .description('Show current authentication status')
  .action(() => {
    const profileName = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}\n`));

    // App credentials
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();
    const clientId = getClientId();

    console.log(chalk.bold('App Credentials:'));
    info(`  API Key: ${apiKey ? chalk.green(`${apiKey.substring(0, 8)}...`) : chalk.gray('not set')}`);
    info(`  API Secret: ${apiSecret ? chalk.green('configured') : chalk.gray('not set')}`);
    info(`  Client ID: ${clientId ? chalk.green(`${clientId.substring(0, 8)}...`) : chalk.gray('not set')}`);

    // OAuth 2.0 status
    console.log(chalk.bold('\nOAuth 2.0 (User Context):'));
    if (hasOAuth2Auth()) {
      const username = getUsername();
      const userId = getUserId();
      const expiresAt = getTokenExpiresAt();
      const isExpired = expiresAt ? Date.now() > expiresAt : false;

      info(`  Status: ${isExpired ? chalk.yellow('expired') : chalk.green('authenticated')}`);
      if (username) info(`  User: @${username} (${userId})`);
      if (expiresAt) {
        const expiresIn = Math.round((expiresAt - Date.now()) / 1000 / 60);
        info(`  Expires: ${isExpired ? chalk.red('expired') : chalk.green(`in ${expiresIn} minutes`)}`);
      }
      info(`  Refresh token: ${getRefreshToken() ? chalk.green('available') : chalk.yellow('not available')}`);
    } else {
      info(`  Status: ${chalk.gray('not authenticated')}`);
      info(`  Run: ${chalk.cyan(`${CONNECTOR_NAME} auth login`)} to authenticate`);
    }

    // OAuth 1.0a status
    console.log(chalk.bold('\nOAuth 1.0a (Media Upload):'));
    if (hasOAuth1Auth()) {
      info(`  Status: ${chalk.green('authenticated')}`);
      info(`  Media upload: ${chalk.green('available')}`);
    } else {
      info(`  Status: ${chalk.gray('not authenticated')}`);
      info(`  Run: ${chalk.cyan(`${CONNECTOR_NAME} auth login --oauth1`)} to enable media upload`);
    }
  });

authCmd
  .command('login')
  .description('Authenticate with X (opens browser)')
  .option('--oauth1', 'Use OAuth 1.0a (for media upload)')
  .option('--port <port>', 'Local callback server port', '5930')
  .option('--scopes <scopes>', 'OAuth 2.0 scopes (comma-separated)')
  .action(async (opts) => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();

    if (opts.oauth1) {
      // OAuth 1.0a flow (PIN-based for desktop apps)
      if (!apiKey || !apiSecret) {
        error('API Key and Secret required for OAuth 1.0a. Run:');
        info(`  ${CONNECTOR_NAME} config set-key <api_key>`);
        info(`  ${CONNECTOR_NAME} config set-secret <api_secret>`);
        process.exit(1);
      }

      info('Starting OAuth 1.0a authentication (PIN-based)...');

      try {
        // Step 1: Get request token with 'oob' callback for PIN-based flow
        info('Getting request token...');
        const requestToken = await getRequestToken(
          { consumerKey: apiKey, consumerSecret: apiSecret },
          'oob'
        );

        // Step 2: Open browser for authorization
        const authUrl = buildOAuth1AuthorizationUrl(requestToken.oauthToken);
        info('Opening browser for authorization...');
        console.log(chalk.cyan(`\nAuthorize the app and enter the PIN shown.\n`));
        console.log(chalk.cyan(`URL: ${authUrl}\n`));

        // Open browser
        const open = await import('open').then(m => m.default).catch(() => null);
        if (open) {
          await open(authUrl);
        }

        // Step 3: Get PIN from user
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const pin = await new Promise<string>((resolve) => {
          rl.question(chalk.bold('Enter PIN: '), (answer) => {
            rl.close();
            resolve(answer.trim());
          });
        });

        if (!pin) {
          error('No PIN entered');
          process.exit(1);
        }

        // Step 4: Exchange for access token
        info('Exchanging for access token...');
        const tokens = await getOAuth1AccessTokenFromX(
          { consumerKey: apiKey, consumerSecret: apiSecret },
          requestToken.oauthToken,
          requestToken.oauthTokenSecret,
          pin
        );

        // Create profile with username
        const profileName = tokens.screenName || 'default';
        if (tokens.screenName && !profileExists(profileName)) {
          // App credentials are now shared at base level, profile only stores tokens
          createProfile(profileName, {});
          info(`Created profile: ${profileName}`);
        }

        // Switch to the profile
        if (tokens.screenName) {
          setCurrentProfile(profileName);
          info(`Switched to profile: ${profileName}`);
        }

        // Save tokens
        saveOAuth1Tokens(tokens);

        success(`\nAuthenticated as @${tokens.screenName || 'unknown'} (OAuth 1.0a)`);
        info('You can now post tweets, like, retweet, and upload media.');
      } catch (err) {
        error(`OAuth 1.0a login failed: ${err}`);
        process.exit(1);
      }
    } else {
      // OAuth 2.0 PKCE flow
      if (!clientId) {
        error('Client ID required for OAuth 2.0. Run:');
        info(`  ${CONNECTOR_NAME} auth set-client-id <client_id>`);
        info(`  ${CONNECTOR_NAME} auth set-client-secret <client_secret>  (optional)`);
        process.exit(1);
      }

      info('Starting OAuth 2.0 authentication...');

      try {
        const port = parseInt(opts.port);
        const redirectUri = `http://localhost:${port}/callback`;

        // Parse scopes
        let scopes: OAuth2Scope[] = DEFAULT_SCOPES;
        if (opts.scopes) {
          scopes = opts.scopes.split(',').map((s: string) => s.trim()) as OAuth2Scope[];
        }

        // Generate PKCE
        const pkce = generatePKCE();

        // Build authorization URL
        const authUrl = buildAuthorizationUrl(
          { clientId, clientSecret, redirectUri, scopes },
          pkce
        );

        info('Opening browser for authorization...');
        console.log(chalk.cyan(`\nIf browser doesn't open, visit:\n${authUrl}\n`));

        // Open browser
        const open = await import('open').then(m => m.default).catch(() => null);
        if (open) {
          await open(authUrl);
        }

        // Start callback server
        info('Waiting for authorization...');
        const { code } = await startCallbackServer(port, pkce.state);

        // Exchange code for tokens
        info('Exchanging authorization code for tokens...');
        const tokens = await exchangeCodeForTokens(
          { clientId, clientSecret, redirectUri },
          code,
          pkce.codeVerifier
        );

        // Get user info
        info('Getting user info...');
        const user = await getAuthenticatedUser(tokens.accessToken);

        // Create profile with username if it doesn't exist
        const profileName = user.username;
        if (!profileExists(profileName)) {
          // App credentials are now shared at base level, profile only stores tokens
          createProfile(profileName, {});
          info(`Created profile: ${profileName}`);
        }

        // Switch to the new profile
        setCurrentProfile(profileName);
        info(`Switched to profile: ${profileName}`);

        // Save tokens to the new profile
        saveOAuth2Tokens({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          scopes: tokens.scope.split(' '),
          userId: user.id,
          username: user.username,
        });

        success(`\nAuthenticated as @${user.username} (${user.name})`);
        info(`User ID: ${user.id}`);
        info(`Token expires in ${Math.round(tokens.expiresIn / 60)} minutes`);
        if (tokens.refreshToken) {
          info('Refresh token saved for automatic renewal');
        }
      } catch (err) {
        error(`OAuth 2.0 login failed: ${err}`);
        process.exit(1);
      }
    }
  });

authCmd
  .command('logout')
  .description('Revoke tokens and clear authentication')
  .option('--keep-app-credentials', 'Keep API key/secret, only clear user tokens')
  .action(async (opts) => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();

    // Try to revoke tokens if we have them
    if (accessToken && clientId) {
      try {
        info('Revoking access token...');
        await revokeToken(
          { clientId, clientSecret, redirectUri: '' },
          accessToken,
          'access_token'
        );
      } catch {
        warn('Could not revoke access token (may already be expired)');
      }
    }

    if (refreshToken && clientId) {
      try {
        info('Revoking refresh token...');
        await revokeToken(
          { clientId, clientSecret, redirectUri: '' },
          refreshToken,
          'refresh_token'
        );
      } catch {
        warn('Could not revoke refresh token');
      }
    }

    // Clear stored tokens
    if (opts.keepAppCredentials) {
      clearUserTokens();
      success('User tokens cleared (app credentials preserved)');
    } else {
      clearConfig();
      success('All authentication cleared');
    }
  });

authCmd
  .command('refresh')
  .description('Manually refresh the OAuth 2.0 access token')
  .action(async () => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const refreshToken = getRefreshToken();

    if (!clientId) {
      error('Client ID not configured');
      process.exit(1);
    }

    if (!refreshToken) {
      error('No refresh token available. Run "auth login" first.');
      process.exit(1);
    }

    try {
      info('Refreshing access token...');
      const tokens = await refreshOAuth2Token(
        { clientId, clientSecret, redirectUri: '' },
        refreshToken
      );

      saveOAuth2Tokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      });

      success('Token refreshed successfully');
      info(`New token expires in ${Math.round(tokens.expiresIn / 60)} minutes`);
    } catch (err) {
      error(`Token refresh failed: ${err}`);
      process.exit(1);
    }
  });

authCmd
  .command('set-client-id <clientId>')
  .description('Set OAuth 2.0 Client ID')
  .action((clientId: string) => {
    setClientId(clientId);
    success(`Client ID saved to profile: ${getCurrentProfile()}`);
  });

authCmd
  .command('set-client-secret <clientSecret>')
  .description('Set OAuth 2.0 Client Secret (optional for public clients)')
  .action((clientSecret: string) => {
    setClientSecret(clientSecret);
    success(`Client Secret saved to profile: ${getCurrentProfile()}`);
  });

authCmd
  .command('scopes')
  .description('List available OAuth 2.0 scopes')
  .action(() => {
    console.log(chalk.bold('Available OAuth 2.0 Scopes:\n'));

    const categories = {
      'Read': ['tweet.read', 'users.read', 'follows.read', 'list.read', 'space.read', 'mute.read', 'like.read', 'block.read', 'bookmark.read'],
      'Write': ['tweet.write', 'follows.write', 'list.write', 'mute.write', 'like.write', 'block.write', 'bookmark.write'],
      'Direct Messages': ['dm.read', 'dm.write'],
      'Other': ['offline.access'],
    };

    for (const [category, scopes] of Object.entries(categories)) {
      console.log(chalk.bold.underline(category));
      for (const scope of scopes) {
        const desc = OAUTH2_SCOPES[scope as OAuth2Scope];
        const isDefault = DEFAULT_SCOPES.includes(scope as OAuth2Scope);
        console.log(`  ${chalk.cyan(scope.padEnd(20))} ${desc}${isDefault ? chalk.green(' (default)') : ''}`);
      }
      console.log();
    }
  });

// ============================================
// Tweet Commands (Write Operations)
// ============================================
tweetsCmd
  .command('post <text>')
  .description('Post a new tweet (requires auth)')
  .option('--media <paths>', 'Media file paths (comma-separated)')
  .option('--reply-to <tweetId>', 'Reply to a tweet')
  .option('--quote <tweetId>', 'Quote a tweet')
  .action(async (text: string, opts) => {
    try {
      const client = getClient();

      if (!hasUserAuth()) {
        error('Authentication required. Run "auth login" or "auth login --oauth1" first.');
        process.exit(1);
      }

      let mediaIds: string[] | undefined;

      // Upload media if provided
      if (opts.media && client.hasMediaUpload()) {
        const paths = opts.media.split(',').map((p: string) => p.trim());
        mediaIds = [];

        for (const filePath of paths) {
          info(`Uploading ${filePath}...`);
          const result = await client.media!.uploadFile(filePath);
          mediaIds.push(result.media_id_string);
          success(`Uploaded: ${result.media_id_string}`);
        }
      } else if (opts.media) {
        warn('Media upload requires OAuth 1.0a. Run "auth login --oauth1" to enable.');
      }

      info('Posting tweet...');
      const result = await client.tweets.create({
        text,
        mediaIds,
        replyToTweetId: opts.replyTo,
        quoteTweetId: opts.quote,
      });

      success(`Tweet posted: https://twitter.com/i/status/${result.data.id}`);
      print(result, getFormat(tweetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('delete <tweetId>')
  .description('Delete a tweet (requires auth)')
  .action(async (tweetId: string) => {
    try {
      const client = getClient();

      if (!hasUserAuth()) {
        error('Authentication required. Run "auth login" or "auth login --oauth1" first.');
        process.exit(1);
      }

      const result = await client.tweets.delete(tweetId);
      if (result.data.deleted) {
        success(`Tweet ${tweetId} deleted`);
      } else {
        error('Failed to delete tweet');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('like <tweetId>')
  .description('Like a tweet (requires auth)')
  .action(async (tweetId: string) => {
    try {
      const client = getClient();
      const userId = getUserId();

      if (!hasOAuth2Auth() || !userId) {
        error('Authentication required. Run "auth login" first.');
        process.exit(1);
      }

      const result = await client.tweets.like(userId, tweetId);
      if (result.data.liked) {
        success(`Liked tweet ${tweetId}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('unlike <tweetId>')
  .description('Unlike a tweet (requires auth)')
  .action(async (tweetId: string) => {
    try {
      const client = getClient();
      const userId = getUserId();

      if (!hasOAuth2Auth() || !userId) {
        error('Authentication required. Run "auth login" first.');
        process.exit(1);
      }

      const result = await client.tweets.unlike(userId, tweetId);
      success(`Unliked tweet ${tweetId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('retweet <tweetId>')
  .description('Retweet a tweet (requires auth)')
  .action(async (tweetId: string) => {
    try {
      const client = getClient();
      const userId = getUserId();

      if (!hasOAuth2Auth() || !userId) {
        error('Authentication required. Run "auth login" first.');
        process.exit(1);
      }

      const result = await client.tweets.retweet(userId, tweetId);
      if (result.data.retweeted) {
        success(`Retweeted ${tweetId}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('bookmarks')
  .description('Get your bookmarked tweets (requires auth)')
  .option('-n, --max <number>', 'Maximum results', '10')
  .option('--page-token <token>', 'Pagination token')
  .action(async (opts) => {
    try {
      const client = getClient();
      const userId = getUserId();

      if (!hasOAuth2Auth() || !userId) {
        error('Authentication required. Run "auth login" first.');
        process.exit(1);
      }

      const result = await client.tweets.getBookmarks(userId, {
        maxResults: parseInt(opts.max),
        paginationToken: opts.pageToken,
      });

      print(result, getFormat(tweetsCmd));

      if (result.meta?.next_token) {
        info(`More results available. Use --page-token ${result.meta.next_token}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('bookmark <tweetId>')
  .description('Bookmark a tweet (requires auth)')
  .action(async (tweetId: string) => {
    try {
      const client = getClient();
      const userId = getUserId();

      if (!hasOAuth2Auth() || !userId) {
        error('Authentication required. Run "auth login" first.');
        process.exit(1);
      }

      const result = await client.tweets.bookmark(userId, tweetId);
      if (result.data.bookmarked) {
        success(`Bookmarked tweet ${tweetId}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tweetsCmd
  .command('unbookmark <tweetId>')
  .description('Remove a bookmark (requires auth)')
  .action(async (tweetId: string) => {
    try {
      const client = getClient();
      const userId = getUserId();

      if (!hasOAuth2Auth() || !userId) {
        error('Authentication required. Run "auth login" first.');
        process.exit(1);
      }

      const result = await client.tweets.removeBookmark(userId, tweetId);
      success(`Removed bookmark from tweet ${tweetId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// User Commands (Write Operations)
// ============================================
usersCmd
  .command('me')
  .description('Get the authenticated user info')
  .action(async () => {
    try {
      const client = getClient();

      if (!hasUserAuth()) {
        error('Authentication required. Run "auth login" first.');
        process.exit(1);
      }

      const result = await client.users.me();
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('follow <username>')
  .description('Follow a user (requires auth)')
  .action(async (username: string) => {
    try {
      const client = getClient();
      const userId = getUserId();

      if (!hasOAuth2Auth() || !userId) {
        error('Authentication required. Run "auth login" first.');
        process.exit(1);
      }

      // Get target user ID
      const targetUser = await client.users.getByUsername(username);
      const targetUserId = targetUser.data.id;

      const result = await client.users.follow(userId, targetUserId);
      if (result.data.following) {
        success(`Now following @${username}`);
      } else if (result.data.pending_follow) {
        info(`Follow request sent to @${username} (pending approval)`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('unfollow <username>')
  .description('Unfollow a user (requires auth)')
  .action(async (username: string) => {
    try {
      const client = getClient();
      const userId = getUserId();

      if (!hasOAuth2Auth() || !userId) {
        error('Authentication required. Run "auth login" first.');
        process.exit(1);
      }

      // Get target user ID
      const targetUser = await client.users.getByUsername(username);
      const targetUserId = targetUser.data.id;

      await client.users.unfollow(userId, targetUserId);
      success(`Unfollowed @${username}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Search Command (shortcut)
// ============================================
program
  .command('search <query>')
  .description('Search recent tweets (shortcut for "tweets search")')
  .option('-n, --max <number>', 'Maximum results (10-100)', '10')
  .option('--sort <order>', 'Sort order (recency, relevancy)', 'recency')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tweets.searchRecent({
        query,
        maxResults: Math.min(100, Math.max(10, parseInt(opts.max))),
        sortOrder: opts.sort as 'recency' | 'relevancy',
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
