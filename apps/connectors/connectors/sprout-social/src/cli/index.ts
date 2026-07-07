#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SproutSocial } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getCustomerId,
  setCustomerId,
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

const CONNECTOR_NAME = 'connect-sprout-social';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Sprout Social connector - Social media management, publishing, and analytics')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
  .option('-c, --customer <id>', 'Customer id (overrides config)')
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
      process.env.SPROUTSOCIAL_ACCESS_TOKEN = opts.token;
    }
    if (opts.customer) {
      process.env.SPROUTSOCIAL_CUSTOMER_ID = String(opts.customer);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let parent = cmd.parent;
  while (parent && parent.parent) {
    parent = parent.parent;
  }
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): SproutSocial {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set SPROUTSOCIAL_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  return new SproutSocial({ accessToken, customerId: getCustomerId() });
}

function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map(v => v.trim()).filter(Boolean);
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
  .option('--customer <id>', 'Customer id')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
      customerId: opts.customer,
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
    info(`Customer Id: ${config.customerId ? config.customerId : chalk.gray('not set')}`);
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
  .command('set-customer <id>')
  .description('Set customer id')
  .action((id: string) => {
    setCustomerId(id);
    success(`Customer id saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const customerId = getCustomerId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Customer Id: ${customerId ? customerId : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Metadata Commands
// ============================================
const metadataCmd = program
  .command('metadata')
  .alias('meta')
  .description('Fetch account metadata');

function metaAction(fn: (client: SproutSocial) => Promise<unknown>) {
  return async () => {
    try {
      const client = getClient();
      const result = await fn(client);
      print(result, getFormat(metadataCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  };
}

metadataCmd
  .command('client')
  .description('List customer ids the token can access (no customer id required)')
  .action(metaAction(c => c.getClientMetadata()));

metadataCmd
  .command('profiles')
  .description('List connected social profiles')
  .action(metaAction(c => c.getCustomerProfiles()));

metadataCmd
  .command('tags')
  .description('List message tags')
  .action(metaAction(c => c.getTags()));

metadataCmd
  .command('groups')
  .description('List customer groups')
  .action(metaAction(c => c.getGroups()));

metadataCmd
  .command('users')
  .description('List active users')
  .action(metaAction(c => c.getUsers()));

metadataCmd
  .command('topics')
  .description('List listening topics')
  .action(metaAction(c => c.getTopics()));

metadataCmd
  .command('teams')
  .description('List active teams')
  .action(metaAction(c => c.getTeams()));

metadataCmd
  .command('queues')
  .description('List case queues')
  .action(metaAction(c => c.getQueues()));

// ============================================
// Analytics Commands
// ============================================
const analyticsCmd = program
  .command('analytics')
  .description('Query analytics');

analyticsCmd
  .command('profiles')
  .description('Query profile-level analytics')
  .option('--filter <expr...>', 'Filter expression (repeatable), e.g. customer_profile_id.eq(123)')
  .option('--metric <name...>', 'Metric name (repeatable)')
  .option('--field <name...>', 'Field/dimension name (repeatable)')
  .option('--sort <expr...>', 'Sort expression (repeatable)')
  .option('--page <number>', 'Page number', '1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.getProfileAnalytics({
        filters: opts.filter,
        metrics: opts.metric,
        fields: opts.field,
        sort: opts.sort,
        page: opts.page ? parseInt(opts.page, 10) : undefined,
      });
      print(result, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('posts')
  .description('Query post-level analytics')
  .option('--filter <expr...>', 'Filter expression (repeatable)')
  .option('--metric <name...>', 'Metric name (repeatable)')
  .option('--field <name...>', 'Field/dimension name (repeatable)')
  .option('--sort <expr...>', 'Sort expression (repeatable)')
  .option('--page <number>', 'Page number', '1')
  .option('--limit <number>', 'Page size')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.getPostAnalytics({
        filters: opts.filter,
        metrics: opts.metric,
        fields: opts.field,
        sort: opts.sort,
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      print(result, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Message Commands
// ============================================
const messageCmd = program
  .command('message')
  .alias('inbox')
  .description('Query inbox messages');

messageCmd
  .command('list')
  .description('List messages (requires a group filter)')
  .option('--filter <expr...>', 'Filter expression (repeatable), e.g. customer_group_id.eq(1)')
  .option('--field <name...>', 'Field name (repeatable)')
  .option('--sort <expr...>', 'Sort expression (repeatable)')
  .option('--limit <number>', 'Page size (max 100)')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.getMessages({
        filters: opts.filter,
        fields: opts.field,
        sort: opts.sort,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(result, getFormat(messageCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Publishing Commands
// ============================================
const postCmd = program
  .command('post')
  .description('Manage draft publishing posts');

postCmd
  .command('create')
  .description('Create a draft post')
  .requiredOption('--group <id>', 'Group id')
  .requiredOption('--profiles <ids>', 'Comma-separated customer profile ids')
  .requiredOption('--text <text>', 'Post text')
  .option('--tags <ids>', 'Comma-separated tag ids')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createPost({
        group_id: parseInt(opts.group, 10),
        customer_profile_ids: (parseList(opts.profiles) ?? []).map(id => parseInt(id, 10)),
        text: opts.text,
        is_draft: true,
        tag_ids: parseList(opts.tags)?.map(id => parseInt(id, 10)),
      });
      success('Draft post created!');
      print(result, getFormat(postCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

postCmd
  .command('get <id>')
  .description('Get a publishing post by id')
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

// ============================================
// Cases Commands
// ============================================
const caseCmd = program
  .command('case')
  .description('Query cases');

caseCmd
  .command('list')
  .description('Filter cases')
  .option('--filter <expr...>', 'Filter expression (repeatable)')
  .option('--field <name...>', 'Field name (repeatable)')
  .option('--sort <expr...>', 'Sort expression (repeatable)')
  .option('--limit <number>', 'Page size (max 100)')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.filterCases({
        filters: opts.filter,
        fields: opts.field,
        sort: opts.sort,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(result, getFormat(caseCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Media Commands
// ============================================
const mediaCmd = program
  .command('media')
  .description('Manage media');

mediaCmd
  .command('upload')
  .description('Register media by remote URL')
  .requiredOption('--url <url>', 'Remote media URL for Sprout to download')
  .option('--alt <text>', 'Alt text')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.uploadMediaByUrl({ url: opts.url, alt_text: opts.alt });
      success('Media registered!');
      print(result, getFormat(mediaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
