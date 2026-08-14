#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Substack } from '../api';
import {
  getSubdomain,
  getToken,
  setSubdomain,
  setToken,
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

const CONNECTOR_NAME = 'connect-substack';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Substack connector CLI - Posts, subscribers, stats with multi-profile support')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, yaml, pretty)', 'yaml')
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
  return (parent?.opts().format || 'yaml') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Substack {
  const subdomain = getSubdomain();
  const token = getToken();

  if (!subdomain) {
    error(`No Substack subdomain configured. Run "${CONNECTOR_NAME} config set --subdomain <name> --token <token>" or set SUBSTACK_SUBDOMAIN environment variable.`);
    process.exit(1);
  }
  if (!token) {
    error(`No Substack token configured. Run "${CONNECTOR_NAME} config set --subdomain <name> --token <token>" or set SUBSTACK_TOKEN environment variable.`);
    process.exit(1);
  }

  return new Substack({ subdomain, token });
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
  .option('--subdomain <subdomain>', 'Substack publication subdomain')
  .option('--token <token>', 'Session token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      subdomain: opts.subdomain,
      token: opts.token,
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

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Subdomain: ${config.subdomain || chalk.gray('not set')}`);
    info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set')
  .description('Set Substack configuration')
  .requiredOption('--subdomain <subdomain>', 'Substack publication subdomain')
  .requiredOption('--token <token>', 'Session token (from browser cookies)')
  .action((opts) => {
    setSubdomain(opts.subdomain);
    setToken(opts.token);
    success(`Configuration saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const subdomain = getSubdomain();
    const token = getToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Subdomain: ${subdomain || chalk.gray('not set')}`);
    info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Posts Commands
// ============================================
const postsCmd = program
  .command('posts')
  .description('Manage posts');

postsCmd
  .command('list')
  .description('List posts')
  .option('-n, --limit <number>', 'Maximum results', '25')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('-t, --type <type>', 'Post type (newsletter, podcast, thread)')
  .option('--drafts', 'List drafts instead of published posts')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.posts.list({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
        type: opts.type,
        drafts: opts.drafts,
      });

      const posts = result.posts.map(p => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        type: p.type,
        audience: p.audience,
        draft: p.draft,
        published: p.is_published,
        date: p.post_date || p.publish_date,
        reactions: p.reaction_count,
        comments: p.comment_count,
      }));

      print(posts, getFormat(postsCmd));
      if (result.more) {
        warn(`More posts available. Use --offset ${parseInt(opts.offset) + parseInt(opts.limit)} to see more.`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postsCmd
  .command('get <postId>')
  .description('Get a post by ID or slug')
  .action(async (postId: string) => {
    try {
      const client = getClient();
      const id = /^\d+$/.test(postId) ? parseInt(postId) : postId;
      const post = await client.posts.get(id);
      print(post, getFormat(postsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postsCmd
  .command('create')
  .description('Create a new draft post')
  .requiredOption('--title <title>', 'Post title')
  .option('--subtitle <subtitle>', 'Post subtitle')
  .option('--body <markdown>', 'Post body in markdown')
  .option('--audience <audience>', 'Audience (everyone, only_paid, only_free, founding)', 'everyone')
  .option('--type <type>', 'Post type (newsletter, podcast, thread)', 'newsletter')
  .option('--publish', 'Publish immediately instead of saving as draft')
  .option('--send', 'Send email to subscribers (only with --publish)')
  .action(async (opts) => {
    try {
      const client = getClient();

      // Create the draft
      const draft = await client.posts.create({
        title: opts.title,
        subtitle: opts.subtitle,
        body_markdown: opts.body,
        audience: opts.audience,
        type: opts.type,
        draft: !opts.publish,
      });

      if (opts.publish) {
        const published = await client.posts.publish(draft.id, { send: opts.send });
        success(`Post published: ${published.canonical_url}`);
        print(published, getFormat(postsCmd));
      } else {
        success(`Draft created with ID: ${draft.id}`);
        print(draft, getFormat(postsCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postsCmd
  .command('publish <draftId>')
  .description('Publish a draft')
  .option('--send', 'Send email to subscribers')
  .action(async (draftId: string, opts) => {
    try {
      const client = getClient();
      const post = await client.posts.publish(parseInt(draftId), { send: opts.send });
      success(`Post published: ${post.canonical_url}`);
      print(post, getFormat(postsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postsCmd
  .command('delete <draftId>')
  .description('Delete a draft')
  .action(async (draftId: string) => {
    try {
      const client = getClient();
      await client.posts.deleteDraft(parseInt(draftId));
      success(`Draft ${draftId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Subscribers Commands
// ============================================
const subscribersCmd = program
  .command('subscribers')
  .description('Manage subscribers');

subscribersCmd
  .command('list')
  .description('List subscribers')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('-t, --type <type>', 'Subscription type (free, paid, comp, gift)')
  .option('-s, --search <query>', 'Search by email or name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.subscribers.list({
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
        type: opts.type,
        search: opts.search,
      });

      const subscribers = result.subscribers.map(s => ({
        id: s.id,
        email: s.email,
        name: s.name,
        type: s.subscription_type,
        created_at: s.created_at,
        expiry_date: s.expiry_date,
      }));

      print(subscribers, getFormat(subscribersCmd));
      if (result.more) {
        warn(`More subscribers available. Use --offset ${parseInt(opts.offset) + parseInt(opts.limit)} to see more.`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscribersCmd
  .command('stats')
  .description('Get subscriber statistics')
  .action(async () => {
    try {
      const client = getClient();
      const stats = await client.subscribers.stats();
      print(stats, getFormat(subscribersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscribersCmd
  .command('export')
  .description('Export subscribers')
  .option('-t, --type <type>', 'Subscription type (free, paid, all)', 'all')
  .option('--format <format>', 'Export format (csv, json)', 'csv')
  .action(async (opts) => {
    try {
      const client = getClient();
      const url = await client.subscribers.export({
        type: opts.type,
        format: opts.format,
      });
      success(`Export URL: ${url}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Comments Commands
// ============================================
const commentsCmd = program
  .command('comments')
  .description('Manage comments');

commentsCmd
  .command('list <postId>')
  .description('List comments on a post')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('--sort <sort>', 'Sort order (best, newest, oldest)', 'best')
  .action(async (postId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.comments.list(parseInt(postId), {
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
        sort: opts.sort,
      });

      const comments = result.comments.map(c => ({
        id: c.id,
        name: c.name,
        date: c.date,
        body: c.body.substring(0, 200) + (c.body.length > 200 ? '...' : ''),
        reactions: c.reaction_count,
        deleted: c.deleted,
      }));

      print(comments, getFormat(commentsCmd));
      if (result.more) {
        warn('More comments available.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Stats Command
// ============================================
program
  .command('stats')
  .description('Get publication statistics')
  .action(async () => {
    try {
      const client = getClient();
      const stats = await client.stats.publication();
      print(stats, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Profile/Publication Command
// ============================================
program
  .command('publication')
  .description('Get publication information')
  .alias('pub')
  .action(async () => {
    try {
      const client = getClient();
      const pub = await client.publication.get();

      const output = {
        id: pub.id,
        name: pub.name,
        subdomain: pub.subdomain,
        custom_domain: pub.custom_domain,
        created_at: pub.created_at,
        language: pub.language,
        subscriber_count: pub.subscriber_count,
        post_count: pub.post_count,
        paid_subscriber_count: pub.paid_subscriber_count,
        free_subscriber_count: pub.free_subscriber_count,
        author: pub.author ? {
          name: pub.author.name,
          handle: pub.author.handle,
        } : undefined,
      };

      print(output, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Me Command (logged in user info)
// ============================================
program
  .command('me')
  .description('Get current user information')
  .action(async () => {
    try {
      const client = getClient();
      const user = await client.publication.me();

      const output = {
        id: user.id,
        name: user.name,
        email: user.email,
        handle: user.handle,
        publications: user.publications.map(p => ({
          name: p.name,
          subdomain: p.subdomain,
        })),
      };

      print(output, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
