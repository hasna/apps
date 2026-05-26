#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { LinkedIn } from '../api';
import {
  getAccessToken,
  setAccessToken,
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-linkedin';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('LinkedIn connector - Manage profiles, posts, organizations, and analytics')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
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
    if (opts.token) {
      process.env.LINKEDIN_ACCESS_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): LinkedIn {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set LINKEDIN_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  return new LinkedIn({ accessToken });
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
  .option('--token <token>', 'Access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Me Commands (Profile)
// ============================================
const meCmd = program
  .command('me')
  .description('Get current user profile');

meCmd
  .command('profile')
  .description('Get your LinkedIn profile')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getProfile();
      print(result, getFormat(meCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

meCmd
  .command('email')
  .description('Get your email address')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getEmail();
      print(result, getFormat(meCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

meCmd
  .command('picture')
  .description('Get your profile picture')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getProfilePicture();
      print(result, getFormat(meCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Organization Commands
// ============================================
const orgCmd = program
  .command('organization')
  .alias('org')
  .description('Manage organizations');

orgCmd
  .command('get <id>')
  .description('Get an organization by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getOrganization(id);
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgCmd
  .command('find <vanityName>')
  .description('Find an organization by vanity name')
  .action(async (vanityName: string) => {
    try {
      const client = getClient();
      const result = await client.getOrganizationByVanityName(vanityName);
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgCmd
  .command('list')
  .description('List organizations you administer')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getAdministeredOrganizations();
      print(result, getFormat(orgCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Post Commands
// ============================================
const postCmd = program
  .command('post')
  .description('Manage posts');

postCmd
  .command('create')
  .description('Create a new post')
  .requiredOption('--author <urn>', 'Author URN (e.g., urn:li:person:xxx or urn:li:organization:xxx)')
  .requiredOption('--text <text>', 'Post text')
  .option('--visibility <visibility>', 'Visibility (PUBLIC, CONNECTIONS)', 'PUBLIC')
  .option('--url <url>', 'Link URL to share')
  .option('--title <title>', 'Link title')
  .option('--description <desc>', 'Link description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createPost({
        author: opts.author,
        commentary: opts.text,
        visibility: opts.visibility,
        shareMediaCategory: opts.url ? 'ARTICLE' : 'NONE',
        media: opts.url ? [{
          status: 'READY',
          originalUrl: opts.url,
          title: opts.title,
          description: opts.description,
        }] : undefined,
      });
      success('Post created!');
      print(result, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd
  .command('get <id>')
  .description('Get a post by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getPost(id);
      print(result, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd
  .command('list <authorUrn>')
  .description('List posts by author')
  .option('--count <number>', 'Number of posts', '10')
  .option('--start <number>', 'Start index', '0')
  .action(async (authorUrn: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listPosts(authorUrn, {
        count: parseInt(opts.count),
        start: parseInt(opts.start),
      });
      print(result, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd
  .command('delete <id>')
  .description('Delete a post')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deletePost(id);
      success('Post deleted!');
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
  .command('create')
  .description('Create a comment on a post')
  .requiredOption('--actor <urn>', 'Actor URN (your person/org URN)')
  .requiredOption('--object <urn>', 'Object URN (post URN)')
  .requiredOption('--message <text>', 'Comment text')
  .option('--parent <urn>', 'Parent comment URN (for replies)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createComment({
        actor: opts.actor,
        object: opts.object,
        message: opts.message,
        parentComment: opts.parent,
      });
      success('Comment created!');
      print(result, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd
  .command('list <objectUrn>')
  .description('List comments on a post')
  .option('--count <number>', 'Number of comments', '10')
  .option('--start <number>', 'Start index', '0')
  .action(async (objectUrn: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listComments(objectUrn, {
        count: parseInt(opts.count),
        start: parseInt(opts.start),
      });
      print(result, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd
  .command('delete <commentUrn>')
  .description('Delete a comment')
  .action(async (commentUrn: string) => {
    try {
      const client = getClient();
      await client.deleteComment(commentUrn);
      success('Comment deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Reaction Commands
// ============================================
const reactionCmd = program
  .command('reaction')
  .description('Manage reactions');

reactionCmd
  .command('create')
  .description('Add a reaction to a post')
  .requiredOption('--actor <urn>', 'Actor URN (your person/org URN)')
  .requiredOption('--object <urn>', 'Object URN (post URN)')
  .option('--type <type>', 'Reaction type (LIKE, CELEBRATION, LOVE, INSIGHTFUL, CURIOUS, SUPPORT, FUNNY)', 'LIKE')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createReaction({
        actor: opts.actor,
        object: opts.object,
        reactionType: opts.type,
      });
      success('Reaction added!');
      print(result, getFormat(reactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reactionCmd
  .command('list <objectUrn>')
  .description('List reactions on a post')
  .option('--count <number>', 'Number of reactions', '10')
  .option('--start <number>', 'Start index', '0')
  .action(async (objectUrn: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listReactions(objectUrn, {
        count: parseInt(opts.count),
        start: parseInt(opts.start),
      });
      print(result, getFormat(reactionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reactionCmd
  .command('delete')
  .description('Remove a reaction from a post')
  .requiredOption('--object <urn>', 'Object URN (post URN)')
  .requiredOption('--actor <urn>', 'Actor URN')
  .action(async (opts) => {
    try {
      const client = getClient();
      await client.deleteReaction(opts.object, opts.actor);
      success('Reaction removed!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Analytics Commands
// ============================================
const analyticsCmd = program
  .command('analytics')
  .description('View analytics');

analyticsCmd
  .command('share <shareUrn>')
  .description('Get analytics for a share/post')
  .action(async (shareUrn: string) => {
    try {
      const client = getClient();
      const result = await client.getShareStatistics(shareUrn);
      print(result, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('followers <orgId>')
  .description('Get follower statistics for an organization')
  .action(async (orgId: string) => {
    try {
      const client = getClient();
      const result = await client.getOrganizationFollowerStatistics(orgId);
      print(result, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('page <orgId>')
  .description('Get page statistics for an organization')
  .action(async (orgId: string) => {
    try {
      const client = getClient();
      const result = await client.getOrganizationPageStatistics(orgId);
      print(result, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
