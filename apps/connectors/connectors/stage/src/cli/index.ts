#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Stage } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
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

const CONNECTOR_NAME = 'connect-stage';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stage connector CLI - structured code reviews, chapters, comments, and pull requests')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get an authenticated client
function getClient(): Stage {
  const apiKey = getApiKey();

  if (!apiKey) {
    error(`No Stage API key configured. Run "${CONNECTOR_NAME} config set-key <apiKey>" or set STAGE_API_KEY environment variable.`);
    process.exit(1);
  }

  return new Stage({ apiKey, baseUrl: getBaseUrl() });
}

function maskKey(key?: string): string {
  if (!key) {
    return chalk.gray('not set');
  }
  if (key.length <= 8) {
    return '***';
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
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

    success('Profiles:');
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
  .option('--api-key <key>', 'Stage API key')
  .option('--base-url <url>', 'API base URL override')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; baseUrl?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
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
  .command('current')
  .description('Show current active profile')
  .action(() => {
    console.log(getCurrentProfile());
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${maskKey(config.apiKey)}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set Stage API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL override')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${maskKey(getApiKey())}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('path')
  .description('Show configuration directory path')
  .action(() => {
    console.log(getConfigDir());
  });

// ============================================
// Reviews Commands
// ============================================
const reviewsCmd = program
  .command('reviews')
  .description('Work with code reviews');

reviewsCmd
  .command('list')
  .description('List reviews')
  .option('--status <status>', 'Filter by status')
  .option('--repository <repo>', 'Filter by repository')
  .option('--author <author>', 'Filter by author')
  .option('-l, --limit <number>', 'Maximum number of reviews')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts: { status?: string; repository?: string; author?: string; limit?: string; cursor?: string }) => {
    try {
      const client = getClient();
      const result = await client.reviews.list({
        status: opts.status,
        repository: opts.repository,
        author: opts.author,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(result.data ?? result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reviewsCmd
  .command('get <reviewId>')
  .description('Get a review by id')
  .action(async (reviewId: string) => {
    try {
      const client = getClient();
      const review = await client.reviews.get(reviewId);
      print(review, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Chapters Commands
// ============================================
const chaptersCmd = program
  .command('chapters')
  .description('Work with review chapters');

chaptersCmd
  .command('list <reviewId>')
  .description('List chapters for a review')
  .action(async (reviewId: string) => {
    try {
      const client = getClient();
      const result = await client.reviews.listChapters(reviewId);
      print(result.data ?? result, getFormat(program));
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
  .description('Work with review comments');

commentsCmd
  .command('create <reviewId> <body>')
  .description('Create a comment on a review')
  .option('--path <path>', 'File path the comment refers to')
  .option('--line <number>', 'Line number the comment refers to')
  .action(async (reviewId: string, body: string, opts: { path?: string; line?: string }) => {
    try {
      const client = getClient();
      const comment = await client.reviews.createComment({
        reviewId,
        body,
        path: opts.path,
        line: opts.line ? parseInt(opts.line, 10) : undefined,
      });
      success(`Comment created${comment.id ? ` (ID: ${comment.id})` : ''}`);
      print(comment, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Pull Requests Commands
// ============================================
const pullRequestsCmd = program
  .command('pull-requests')
  .description('Work with pull requests');

pullRequestsCmd
  .command('list')
  .description('List pull requests')
  .option('--status <status>', 'Filter by status')
  .option('--repository <repo>', 'Filter by repository')
  .option('--author <author>', 'Filter by author')
  .option('-l, --limit <number>', 'Maximum number of pull requests')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts: { status?: string; repository?: string; author?: string; limit?: string; cursor?: string }) => {
    try {
      const client = getClient();
      const result = await client.pullRequests.list({
        status: opts.status,
        repository: opts.repository,
        author: opts.author,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      });
      print(result.data ?? result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Raw Command
// ============================================
program
  .command('raw <path>')
  .description('Make a raw request to an arbitrary Stage API path (e.g. /reviews)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('-d, --data <json>', 'JSON request body')
  .action(async (path: string, opts: { method: string; data?: string }) => {
    try {
      const client = getClient();
      const method = opts.method.toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      let body: Record<string, unknown> | undefined;
      if (opts.data) {
        try {
          body = JSON.parse(opts.data);
        } catch {
          error('Invalid JSON provided to --data');
          process.exit(1);
        }
      }
      const result = await client.raw(path, { method, body });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
