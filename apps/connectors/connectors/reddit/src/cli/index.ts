#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { createServer } from 'http';
import { Reddit, RedditClient } from '../api';
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
  getUsername,
  setUsername,
  isTokenExpired,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn, formatTimestamp, formatKarma, truncate } from '../utils/output';

const CONNECTOR_NAME = 'connect-reddit';
const VERSION = '0.0.1';
const DEFAULT_REDIRECT_URI = 'http://localhost:8888/callback';
const DEFAULT_SCOPES = [
  'identity',
  'read',
  'submit',
  'edit',
  'vote',
  'subscribe',
  'save',
  'history',
  'mysubreddits',
];

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Reddit connector CLI - Posts, Comments, Subreddits with OAuth2 multi-profile support')
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
function getClient(): Reddit {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();

  if (!clientId || !clientSecret) {
    error(`No Reddit credentials configured. Run "${CONNECTOR_NAME} auth login" to authenticate.`);
    process.exit(1);
  }

  if (!accessToken && !refreshToken) {
    error(`Not authenticated. Run "${CONNECTOR_NAME} auth login" to authenticate.`);
    process.exit(1);
  }

  return new Reddit({
    clientId,
    clientSecret,
    accessToken,
    refreshToken,
  });
}

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Authentication management');

authCmd
  .command('login')
  .description('Authenticate with Reddit OAuth2')
  .option('--client-id <id>', 'Reddit OAuth2 Client ID')
  .option('--client-secret <secret>', 'Reddit OAuth2 Client Secret')
  .option('--redirect-uri <uri>', 'OAuth2 redirect URI', DEFAULT_REDIRECT_URI)
  .option('--scope <scopes>', 'OAuth2 scopes (comma-separated)', DEFAULT_SCOPES.join(','))
  .action(async (opts) => {
    let clientId = opts.clientId || getClientId();
    let clientSecret = opts.clientSecret || getClientSecret();

    if (!clientId) {
      error('Reddit Client ID is required. Provide via --client-id or set up a Reddit app at https://www.reddit.com/prefs/apps');
      process.exit(1);
    }
    if (!clientSecret) {
      error('Reddit Client Secret is required. Provide via --client-secret');
      process.exit(1);
    }

    // Save credentials
    setClientId(clientId);
    setClientSecret(clientSecret);

    const scopes = opts.scope.split(',').map((s: string) => s.trim());
    const state = Math.random().toString(36).substring(7);

    // Generate auth URL
    const authUrl = RedditClient.getAuthorizationUrl(
      clientId,
      opts.redirectUri,
      scopes,
      state,
      'permanent'
    );

    info('Opening browser for authentication...');
    info(`If the browser doesn't open, visit: ${authUrl}`);

    // Try to open browser
    try {
      const open = await import('child_process').then(m => m.exec);
      const cmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
      open(`${cmd} "${authUrl}"`);
    } catch {
      // Ignore browser open errors
    }

    // Start local server to receive callback
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);

      if (url.pathname === '/callback') {
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
          res.end('<html><body><h1>Invalid State</h1><p>State mismatch - possible CSRF attack.</p></body></html>');
          server.close();
          error('State mismatch - possible CSRF attack');
          process.exit(1);
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>No Code</h1><p>No authorization code received.</p></body></html>');
          server.close();
          error('No authorization code received');
          process.exit(1);
        }

        try {
          // Exchange code for tokens
          const tokens = await Reddit.exchangeCode(
            clientId,
            clientSecret,
            code,
            opts.redirectUri
          );

          // Save tokens
          saveTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresIn, tokens.scope);

          // Get username
          const reddit = new Reddit({
            clientId,
            clientSecret,
            accessToken: tokens.accessToken,
          });
          const me = await reddit.users.getMe();
          setUsername(me.name);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authentication Successful!</h1><p>Welcome, ${me.name}! You can close this window.</p></body></html>`);

          server.close();
          success(`Authenticated as: ${me.name}`);
          info(`Profile: ${getCurrentProfile()}`);
          process.exit(0);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Error</h1><p>${String(err)}</p></body></html>`);
          server.close();
          error(`Token exchange failed: ${err}`);
          process.exit(1);
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    const port = parseInt(new URL(opts.redirectUri).port || '8888');
    server.listen(port, () => {
      info(`Waiting for OAuth2 callback on port ${port}...`);
    });
  });

authCmd
  .command('logout')
  .description('Clear authentication')
  .action(async () => {
    try {
      const client = getClient();
      await client.logout();
    } catch {
      // Ignore logout errors
    }
    clearConfig();
    success('Logged out successfully');
  });

authCmd
  .command('status')
  .description('Show authentication status')
  .action(async () => {
    const profile = getCurrentProfile();
    const clientId = getClientId();
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();
    const username = getUsername();
    const expired = isTokenExpired();

    console.log(chalk.bold(`Profile: ${profile}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Client ID: ${clientId ? `${clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Username: ${username || chalk.gray('not set')}`);
    info(`Access Token: ${accessToken ? (expired ? chalk.yellow('expired') : chalk.green('valid')) : chalk.gray('not set')}`);
    info(`Refresh Token: ${refreshToken ? chalk.green('set') : chalk.gray('not set')}`);

    if (accessToken && !expired && clientId) {
      try {
        const client = getClient();
        const me = await client.users.getMe();
        success(`Authenticated as: ${me.name} (${formatKarma(me.totalKarma)} karma)`);
      } catch (err) {
        warn(`Token validation failed: ${err}`);
      }
    }
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
      const config = loadProfile(p);
      const isActive = p === current ? chalk.green(' (active)') : '';
      const username = config.username ? chalk.gray(` - ${config.username}`) : '';
      console.log(`  ${p}${isActive}${username}`);
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
    info(`Username: ${config.username || chalk.gray('not authenticated')}`);
    info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Access Token: ${config.accessToken ? chalk.green('set') : chalk.gray('not set')}`);
    info(`Refresh Token: ${config.refreshToken ? chalk.green('set') : chalk.gray('not set')}`);
    info(`Scope: ${config.scope || chalk.gray('not set')}`);
  });

// ============================================
// Post Commands
// ============================================
const postCmd = program
  .command('post')
  .description('Submit posts to Reddit');

postCmd
  .command('submit <subreddit> <title>')
  .description('Submit a new post')
  .option('-b, --body <text>', 'Post body (self post)')
  .option('-u, --url <url>', 'Link URL (link post)')
  .option('--nsfw', 'Mark as NSFW')
  .option('--spoiler', 'Mark as spoiler')
  .action(async (subreddit: string, title: string, opts) => {
    try {
      const client = getClient();

      if (opts.url && opts.body) {
        error('Cannot specify both --body and --url');
        process.exit(1);
      }

      const kind = opts.url ? 'link' : 'self';
      const result = await client.posts.submit({
        subreddit,
        title,
        kind,
        text: opts.body,
        url: opts.url,
        nsfw: opts.nsfw,
        spoiler: opts.spoiler,
      });

      success(`Post submitted: ${result.url}`);
      print({ id: result.id, name: result.name, url: result.url }, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd
  .command('get <postId>')
  .description('Get a post by ID')
  .action(async (postId: string) => {
    try {
      const client = getClient();
      const { post } = await client.posts.getPost(postId);
      print(post, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd
  .command('delete <postId>')
  .description('Delete a post')
  .action(async (postId: string) => {
    try {
      const client = getClient();
      await client.posts.delete(postId);
      success('Post deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Comment Commands
// ============================================
const commentCmd = program
  .command('comment')
  .description('Manage comments');

commentCmd
  .command('post <parentId> <text>')
  .description('Post a comment (parentId is t3_xxx for post, t1_xxx for reply)')
  .action(async (parentId: string, text: string) => {
    try {
      const client = getClient();
      const comment = await client.comments.submit({
        parentFullname: parentId,
        text,
      });
      success('Comment posted');
      print(comment, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd
  .command('get <postId>')
  .description('Get comments for a post')
  .option('-s, --sort <sort>', 'Sort order (confidence, top, new, controversial, old)', 'confidence')
  .option('-l, --limit <n>', 'Number of comments', '25')
  .action(async (postId: string, opts) => {
    try {
      const client = getClient();
      const comments = await client.comments.getForPost(postId, {
        sort: opts.sort,
        limit: parseInt(opts.limit),
      });
      print(comments, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd
  .command('delete <commentId>')
  .description('Delete a comment')
  .action(async (commentId: string) => {
    try {
      const client = getClient();
      await client.comments.delete(commentId);
      success('Comment deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Feed Command
// ============================================
program
  .command('feed [subreddit]')
  .description('Get posts from feed')
  .option('-s, --sort <sort>', 'Sort order (hot, new, rising, top, controversial)', 'hot')
  .option('-t, --time <time>', 'Time filter for top/controversial (hour, day, week, month, year, all)', 'day')
  .option('-l, --limit <n>', 'Number of posts', '25')
  .option('-a, --after <cursor>', 'Pagination cursor')
  .action(async (subreddit: string | undefined, opts) => {
    try {
      const client = getClient();
      const { posts, after } = await client.posts.getFeed(subreddit, {
        sort: opts.sort,
        time: opts.time,
        limit: parseInt(opts.limit),
        after: opts.after,
      });

      const format = getFormat(program);
      if (format === 'json') {
        print({ posts, after }, format);
      } else {
        posts.forEach((post, i) => {
          const nsfw = post.isNsfw ? chalk.red('[NSFW] ') : '';
          const spoiler = post.isSpoiler ? chalk.yellow('[SPOILER] ') : '';
          const stickied = post.isStickied ? chalk.green('[PINNED] ') : '';
          console.log(chalk.cyan(`[${i + 1}]`) + ` ${stickied}${nsfw}${spoiler}${post.title}`);
          console.log(`    ${chalk.gray(`r/${post.subreddit}`)} | ${chalk.yellow(formatKarma(post.score))} points | ${post.numComments} comments`);
          console.log(`    ${chalk.blue(post.permalink)}`);
          if (post.selftext) {
            console.log(`    ${chalk.gray(truncate(post.selftext, 100))}`);
          }
          console.log();
        });
        if (after) {
          info(`More posts available. Use --after ${after}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Search Command
// ============================================
program
  .command('search <query>')
  .description('Search Reddit')
  .option('-r, --subreddit <name>', 'Search within subreddit')
  .option('-s, --sort <sort>', 'Sort order (relevance, hot, top, new, comments)', 'relevance')
  .option('-t, --time <time>', 'Time filter (hour, day, week, month, year, all)', 'all')
  .option('-l, --limit <n>', 'Number of results', '25')
  .option('--type <type>', 'Result type (link, sr)', 'link')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const results = await client.search.search({
        query,
        subreddit: opts.subreddit,
        sort: opts.sort,
        time: opts.time,
        type: opts.type,
        limit: parseInt(opts.limit),
      });

      const format = getFormat(program);
      if (format === 'json') {
        print(results, format);
      } else {
        if (results.posts.length > 0) {
          console.log(chalk.bold('\nPosts:'));
          results.posts.forEach((post, i) => {
            console.log(chalk.cyan(`[${i + 1}]`) + ` ${post.title}`);
            console.log(`    ${chalk.gray(`r/${post.subreddit}`)} | ${chalk.yellow(formatKarma(post.score))} points`);
            console.log(`    ${chalk.blue(post.permalink)}`);
            console.log();
          });
        }
        if (results.subreddits && results.subreddits.length > 0) {
          console.log(chalk.bold('\nSubreddits:'));
          results.subreddits.forEach((sr, i) => {
            console.log(chalk.cyan(`[${i + 1}]`) + ` r/${sr.displayName}`);
            console.log(`    ${chalk.gray(sr.title)} | ${formatKarma(sr.subscribers)} subscribers`);
            if (sr.publicDescription) {
              console.log(`    ${chalk.gray(truncate(sr.publicDescription, 100))}`);
            }
            console.log();
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// User Command
// ============================================
program
  .command('user [username]')
  .description('Get user info (defaults to authenticated user)')
  .option('--posts', 'Show user posts')
  .option('--comments', 'Show user comments')
  .option('--trophies', 'Show user trophies')
  .option('-l, --limit <n>', 'Number of items', '10')
  .action(async (username: string | undefined, opts) => {
    try {
      const client = getClient();
      const user = username
        ? await client.users.getUser(username)
        : await client.users.getMe();

      const format = getFormat(program);
      if (format === 'json') {
        print(user, format);
      } else {
        console.log(chalk.bold(`\nu/${user.name}`));
        info(`Link Karma: ${formatKarma(user.linkKarma)}`);
        info(`Comment Karma: ${formatKarma(user.commentKarma)}`);
        info(`Total Karma: ${formatKarma(user.totalKarma)}`);
        info(`Account Created: ${formatTimestamp(user.createdUtc)}`);
        if (user.isGold) info(chalk.yellow('Reddit Gold member'));
        if (user.isMod) info(chalk.green('Moderator'));
        console.log();
      }

      if (opts.trophies) {
        const trophies = await client.users.getTrophies(user.name);
        console.log(chalk.bold('Trophies:'));
        trophies.trophies.forEach(t => {
          console.log(`  - ${t.name}${t.description ? `: ${t.description}` : ''}`);
        });
        console.log();
      }

      if (opts.posts) {
        const { posts } = await client.users.getPosts(user.name, { limit: parseInt(opts.limit) });
        console.log(chalk.bold('Recent Posts:'));
        posts.forEach((post, i) => {
          console.log(chalk.cyan(`[${i + 1}]`) + ` ${post.title}`);
          console.log(`    ${chalk.gray(`r/${post.subreddit}`)} | ${chalk.yellow(formatKarma(post.score))} points`);
        });
        console.log();
      }

      if (opts.comments) {
        const { comments } = await client.users.getComments(user.name, { limit: parseInt(opts.limit) });
        console.log(chalk.bold('Recent Comments:'));
        comments.forEach((comment, i) => {
          console.log(chalk.cyan(`[${i + 1}]`) + ` ${truncate(comment.body, 80)}`);
          console.log(`    ${chalk.gray(`r/${comment.subreddit}`)} | ${chalk.yellow(formatKarma(comment.score))} points`);
        });
        console.log();
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Subreddit Command
// ============================================
program
  .command('subreddit <name>')
  .description('Get subreddit info')
  .option('--rules', 'Show subreddit rules')
  .option('--subscribe', 'Subscribe to subreddit')
  .option('--unsubscribe', 'Unsubscribe from subreddit')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();

      if (opts.subscribe) {
        await client.subreddits.subscribe(name);
        success(`Subscribed to r/${name}`);
        return;
      }

      if (opts.unsubscribe) {
        await client.subreddits.unsubscribe(name);
        success(`Unsubscribed from r/${name}`);
        return;
      }

      const sr = await client.subreddits.getSubreddit(name);

      const format = getFormat(program);
      if (format === 'json') {
        print(sr, format);
      } else {
        console.log(chalk.bold(`\nr/${sr.displayName}`));
        info(`Title: ${sr.title}`);
        info(`Subscribers: ${formatKarma(sr.subscribers)}`);
        if (sr.activeUserCount) {
          info(`Active Users: ${formatKarma(sr.activeUserCount)}`);
        }
        info(`Type: ${sr.subredditType}`);
        if (sr.isNsfw) info(chalk.red('NSFW'));
        if (sr.userIsSubscriber) info(chalk.green('You are subscribed'));
        if (sr.publicDescription) {
          console.log(`\n${sr.publicDescription}`);
        }
        console.log();
      }

      if (opts.rules) {
        const rules = await client.subreddits.getRules(name);
        console.log(chalk.bold('Rules:'));
        rules.rules.forEach((rule, i) => {
          console.log(`  ${i + 1}. ${chalk.yellow(rule.shortName)}`);
          if (rule.description) {
            console.log(`     ${chalk.gray(truncate(rule.description, 80))}`);
          }
        });
        console.log();
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Vote Command
// ============================================
program
  .command('vote <direction> <id>')
  .description('Vote on a post or comment (up, down, none)')
  .action(async (direction: string, id: string) => {
    try {
      const client = getClient();

      const isComment = id.startsWith('t1_');
      const api = isComment ? client.comments : client.posts;

      switch (direction.toLowerCase()) {
        case 'up':
        case 'upvote':
        case '1':
          await api.upvote(id);
          success('Upvoted');
          break;
        case 'down':
        case 'downvote':
        case '-1':
          await api.downvote(id);
          success('Downvoted');
          break;
        case 'none':
        case 'unvote':
        case '0':
          await api.unvote(id);
          success('Vote removed');
          break;
        default:
          error('Invalid direction. Use: up, down, or none');
          process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
