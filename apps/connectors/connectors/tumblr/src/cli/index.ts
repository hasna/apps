#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { randomBytes } from 'crypto';
import { createServer } from 'http';
import { Tumblr } from '../api';
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
import { DEFAULT_REDIRECT_URI, DEFAULT_SCOPES } from '../utils/auth';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';
import type { AvatarSize } from '../types';

const CONNECTOR_NAME = 'connect-tumblr';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tumblr connector CLI - Blogs, posts, and user APIs with OAuth2 multi-profile support')
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

function getClient(): Tumblr {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`Not authenticated. Run "${CONNECTOR_NAME} auth login" or set TUMBLR_ACCESS_TOKEN.`);
    process.exit(1);
  }

  return new Tumblr({
    accessToken,
    clientId: getClientId(),
    clientSecret: getClientSecret(),
    refreshToken: getRefreshToken(),
  });
}

function parseJsonFlag(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

// Auth
const authCmd = program.command('auth').description('Authentication management');

authCmd
  .command('login')
  .description('Authenticate with Tumblr OAuth2')
  .option('--client-id <id>', 'Tumblr OAuth2 Client ID')
  .option('--client-secret <secret>', 'Tumblr OAuth2 Client Secret')
  .option('--redirect-uri <uri>', 'OAuth2 redirect URI', DEFAULT_REDIRECT_URI)
  .option('--scope <scopes>', 'OAuth2 scopes (space-separated)', DEFAULT_SCOPES.join(' '))
  .action(async (opts) => {
    const clientId = opts.clientId || getClientId();
    const clientSecret = opts.clientSecret || getClientSecret();

    if (!clientId) {
      error('Tumblr Client ID is required. Register at https://www.tumblr.com/oauth/apps');
      process.exit(1);
    }
    if (!clientSecret) {
      error('Tumblr Client Secret is required.');
      process.exit(1);
    }

    setClientId(clientId);
    setClientSecret(clientSecret);

    const scopes = opts.scope.split(/\s+/).filter(Boolean);
    const state = randomBytes(32).toString('hex');
    const authUrl = Tumblr.getAuthorizationUrl(clientId, opts.redirectUri, scopes, state);

    info('Opening browser for authentication...');
    info(`If the browser doesn't open, visit: ${authUrl}`);

    try {
      const { exec } = await import('child_process');
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${cmd} "${authUrl}"`);
    } catch {
      // ignore
    }

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
          const tokens = await Tumblr.exchangeCode(clientId, clientSecret, code, opts.redirectUri);
          saveTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresIn, tokens.scope);

          const tumblr = new Tumblr({ accessToken: tokens.accessToken, clientId, clientSecret, refreshToken: tokens.refreshToken });
          const userInfo = await tumblr.users.getInfo();
          const user = (userInfo.response as { user?: { name?: string } })?.user;
          if (user?.name) setUsername(user.name);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authentication Successful!</h1><p>Welcome${user?.name ? `, ${user.name}` : ''}!</p></body></html>`);
          server.close();
          success(`Authenticated${user?.name ? ` as ${user.name}` : ''}`);
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

    const port = parseInt(new URL(opts.redirectUri).port || '8889');
    server.listen(port, () => {
      info(`Waiting for OAuth2 callback on port ${port}...`);
    });
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
  const username = getUsername();
  const expired = isTokenExpired();

  console.log(chalk.bold(`Profile: ${profile}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Client ID: ${clientId ? `${clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Username: ${username || chalk.gray('not set')}`);
  info(`Access Token: ${accessToken ? (expired ? chalk.yellow('expired') : chalk.green('valid')) : chalk.gray('not set')}`);
  info(`Refresh Token: ${refreshToken ? chalk.green('set') : chalk.gray('not set')}`);

  if (accessToken) {
    try {
      const tumblr = getClient();
      const userInfo = await tumblr.users.getInfo();
      const user = (userInfo.response as { user?: { name?: string } })?.user;
      if (user?.name) success(`Authenticated as: ${user.name}`);
    } catch (err) {
      warn(`Token validation failed: ${err}`);
    }
  }
});

// Profile
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
    const config = loadProfile(p);
    const isActive = p === current ? chalk.green(' (active)') : '';
    const username = config.username ? chalk.gray(` - ${config.username}`) : '';
    console.log(`  ${p}${isActive}${username}`);
  });
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').option('--use', 'Switch to this profile').action((name: string, opts) => {
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

profileCmd.command('delete <name>').action((name: string) => {
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

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Username: ${config.username || chalk.gray('not authenticated')}`);
  info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Access Token: ${config.accessToken ? chalk.green('set') : chalk.gray('not set')}`);
});

// User commands
const userCmd = program.command('user').description('User API');

userCmd.command('info').action(async () => {
  try {
    const result = await getClient().users.getInfo();
    print(result, getFormat(userCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

userCmd
  .command('dashboard')
  .option('-l, --limit <n>', 'Limit', '20')
  .option('-o, --offset <n>', 'Offset', '0')
  .option('-t, --type <type>', 'Post type filter')
  .action(async (opts) => {
    try {
      const result = await getClient().users.getDashboard({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
        type: opts.type,
      });
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('likes')
  .option('-l, --limit <n>', 'Limit', '20')
  .option('-o, --offset <n>', 'Offset', '0')
  .action(async (opts) => {
    try {
      const result = await getClient().users.getLikes({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('following')
  .option('-l, --limit <n>', 'Limit', '20')
  .option('-o, --offset <n>', 'Offset', '0')
  .action(async (opts) => {
    try {
      const result = await getClient().users.getFollowing({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd.command('follow <url>').action(async (url: string) => {
  try {
    const result = await getClient().users.followBlog(url);
    print(result, getFormat(userCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

userCmd.command('unfollow <url>').action(async (url: string) => {
  try {
    const result = await getClient().users.unfollowBlog(url);
    print(result, getFormat(userCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

userCmd.command('like <id> <reblogKey>').action(async (id: string, reblogKey: string) => {
  try {
    const result = await getClient().users.likePost(id, reblogKey);
    print(result, getFormat(userCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

userCmd.command('unlike <id> <reblogKey>').action(async (id: string, reblogKey: string) => {
  try {
    const result = await getClient().users.unlikePost(id, reblogKey);
    print(result, getFormat(userCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Blog commands
const blogCmd = program.command('blog').description('Blog API');

blogCmd.command('info <blog>').action(async (blog: string) => {
  try {
    const result = await getClient().blogs.getInfo(blog);
    print(result, getFormat(blogCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

blogCmd.command('avatar <blog>').option('-s, --size <size>', 'Avatar size').action(async (blog: string, opts) => {
  try {
    const size = opts.size ? (parseInt(opts.size) as AvatarSize) : undefined;
    const result = await getClient().blogs.getAvatar(blog, size);
    print(result, getFormat(blogCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

blogCmd
  .command('likes <blog>')
  .option('-l, --limit <n>', 'Limit', '20')
  .option('-o, --offset <n>', 'Offset', '0')
  .action(async (blog: string, opts) => {
    try {
      const result = await getClient().blogs.getLikes(blog, {
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });
      print(result, getFormat(blogCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blogCmd
  .command('followers <blog>')
  .option('-l, --limit <n>', 'Limit', '20')
  .action(async (blog: string, opts) => {
    try {
      const result = await getClient().blogs.getFollowers(blog, { limit: parseInt(opts.limit) });
      print(result, getFormat(blogCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blogCmd
  .command('following <blog>')
  .option('-l, --limit <n>', 'Limit', '20')
  .action(async (blog: string, opts) => {
    try {
      const result = await getClient().blogs.getFollowing(blog, { limit: parseInt(opts.limit) });
      print(result, getFormat(blogCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Post commands
const postCmd = program.command('post').description('Post API');

postCmd
  .command('list <blog>')
  .option('-t, --type <type>', 'Post type')
  .option('-l, --limit <n>', 'Limit', '20')
  .option('-o, --offset <n>', 'Offset', '0')
  .option('--tag <tag>', 'Filter by tag')
  .action(async (blog: string, opts) => {
    try {
      const result = await getClient().posts.list(blog, {
        type: opts.type,
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
        tag: opts.tag,
      });
      print(result, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd.command('drafts <blog>').action(async (blog: string) => {
  try {
    const result = await getClient().posts.listDrafts(blog);
    print(result, getFormat(postCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

postCmd
  .command('queue <blog>')
  .option('-l, --limit <n>', 'Limit', '20')
  .action(async (blog: string, opts) => {
    try {
      const result = await getClient().posts.listQueued(blog, { limit: parseInt(opts.limit) });
      print(result, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd.command('submissions <blog>').action(async (blog: string) => {
  try {
    const result = await getClient().posts.listSubmissions(blog);
    print(result, getFormat(postCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

postCmd
  .command('create <blog>')
  .requiredOption('--content <json>', 'NPF content JSON array')
  .option('--state <state>', 'Post state (published, queue, draft, private)')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (blog: string, opts) => {
    try {
      const content = parseJsonFlag(opts.content, 'content') as Array<Record<string, unknown>>;
      const result = await getClient().posts.create(blog, {
        content,
        state: opts.state,
        tags: opts.tags?.split(',').map((t: string) => t.trim()),
      });
      print(result, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd
  .command('update <blog> <postId>')
  .option('--content <json>', 'NPF content JSON array')
  .option('--state <state>', 'Post state')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (blog: string, postId: string, opts) => {
    try {
      const result = await getClient().posts.update(blog, postId, {
        content: opts.content ? (parseJsonFlag(opts.content, 'content') as Array<Record<string, unknown>>) : undefined,
        state: opts.state,
        tags: opts.tags?.split(',').map((t: string) => t.trim()),
      });
      print(result, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd.command('delete <blog> <id>').action(async (blog: string, id: string) => {
  try {
    const result = await getClient().posts.delete(blog, id);
    print(result, getFormat(postCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

postCmd
  .command('reblog <blog> <id> <reblogKey>')
  .option('--comment <text>', 'Reblog comment')
  .option('--state <state>', 'Post state')
  .action(async (blog: string, id: string, reblogKey: string, opts) => {
    try {
      const result = await getClient().posts.reblog(blog, {
        id,
        reblogKey,
        comment: opts.comment,
        state: opts.state,
      });
      print(result, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd
  .command('notes <blog> <id>')
  .option('--mode <mode>', 'Notes mode (all, likes, conversation, rollup, reblogs_with_tags)')
  .action(async (blog: string, id: string, opts) => {
    try {
      const result = await getClient().posts.getNotes(blog, { id, mode: opts.mode });
      print(result, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd.command('get-by-ids <blog> <ids...>').action(async (blog: string, ids: string[]) => {
  try {
    const result = await getClient().posts.getByIds(blog, ids);
    print(result, getFormat(postCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Tag commands
program
  .command('tag <tag>')
  .description('Search posts by tag')
  .option('-l, --limit <n>', 'Limit', '20')
  .action(async (tag: string, opts) => {
    try {
      const result = await getClient().tags.searchByTag(tag, { limit: parseInt(opts.limit) });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
