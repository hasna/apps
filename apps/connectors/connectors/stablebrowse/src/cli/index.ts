#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { StableBrowse } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  clearConfig,
  getConfigDir,
  getDefaultBaseUrl,
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
import type { Extractor } from '../types';

const CONNECTOR_NAME = 'connect-stablebrowse';
const VERSION = '0.0.1';
const EXTRACTORS: Extractor[] = ['images', 'fonts', 'colors', 'icons', 'tokens', 'logo'];

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('StableBrowse API connector CLI - AI browser automation and design extraction')
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

// Helper to get authenticated client
function getClient(): StableBrowse {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STABLEBROWSE_API_KEY environment variable.`);
    process.exit(1);
  }

  return new StableBrowse({ apiKey, baseUrl });
}

function parseSchema(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    error('Invalid --schema JSON');
    process.exit(1);
  }
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
  .option('--api-key <key>', 'StableBrowse API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray(`default (${getDefaultBaseUrl()})`)}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set StableBrowse API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-url <baseUrl>')
  .description('Set custom base URL')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL set to: ${baseUrl}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Tasks Commands
// ============================================
const tasksCmd = program
  .command('tasks')
  .alias('task')
  .description('Task operations');

tasksCmd
  .command('submit <task>')
  .description('Submit a new task')
  .requiredOption('-u, --end-user <id>', 'End-user identifier')
  .option('--session <id>', 'Continue an existing session')
  .option('--start-url <url>', 'URL the agent should open first')
  .option('--schema <json>', 'JSON schema for structured output')
  .option('--max-steps <number>', 'Maximum agent steps')
  .option('--html-dump', 'Include raw HTML of the final page')
  .action(async (task: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.submit({
        endUserId: opts.endUser,
        task,
        sessionId: opts.session,
        startUrl: opts.startUrl,
        schema: parseSchema(opts.schema),
        maxSteps: opts.maxSteps ? parseInt(opts.maxSteps) : undefined,
        include_html_dump: opts.htmlDump,
      });
      success(`Task submitted: ${result.taskId}`);
      info(`Session: ${result.sessionId}`);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('get <taskId>')
  .description('Get a task by ID')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.tasks.get(taskId);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('list')
  .description('List tasks grouped by session')
  .option('-n, --limit <number>', 'Maximum results (max 100)', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.list({
        limit: parseInt(opts.limit),
      });
      print(result.sessions, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('run <task>')
  .description('Submit a task and wait for completion')
  .requiredOption('-u, --end-user <id>', 'End-user identifier')
  .option('--session <id>', 'Continue an existing session')
  .option('--start-url <url>', 'URL the agent should open first')
  .option('--schema <json>', 'JSON schema for structured output')
  .option('--max-steps <number>', 'Maximum agent steps')
  .option('--timeout <ms>', 'Timeout in milliseconds', '300000')
  .action(async (task: string, opts) => {
    try {
      const client = getClient();
      info('Submitting task...');
      const submitted = await client.tasks.submit({
        endUserId: opts.endUser,
        task,
        sessionId: opts.session,
        startUrl: opts.startUrl,
        schema: parseSchema(opts.schema),
        maxSteps: opts.maxSteps ? parseInt(opts.maxSteps) : undefined,
      });
      info(`Task: ${submitted.taskId}`);
      info('Waiting for completion...');

      const result = await client.tasks.waitForCompletion(
        submitted.taskId,
        2000,
        parseInt(opts.timeout)
      );

      if (result.status === 'completed') {
        success('Task completed');
      } else if (result.status === 'failed') {
        error(`Task failed: ${result.error || 'Unknown error'}`);
      } else {
        warn(`Task ended with status: ${result.status}`);
      }

      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Sessions Commands
// ============================================
const sessionsCmd = program
  .command('sessions')
  .alias('session')
  .description('Session operations');

sessionsCmd
  .command('get <sessionId>')
  .description('Get a session and its tasks')
  .action(async (sessionId: string) => {
    try {
      const client = getClient();
      const result = await client.sessions.get(sessionId);
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// End-User Credential Commands
// ============================================
const credentialsCmd = program
  .command('credentials')
  .alias('creds')
  .description('End-user credential operations');

credentialsCmd
  .command('set <endUserId>')
  .description('Store credentials for an end-user (idempotent upsert)')
  .option('--twitter-auth-token <value>')
  .option('--twitter-ct0 <value>')
  .option('--reddit-session <value>')
  .option('--tiktok-session-id <value>')
  .option('--tiktok-csrf-token <value>')
  .option('--instagram-session-id <value>')
  .option('--instagram-csrf-token <value>')
  .option('--instagram-ds-user-id <value>')
  .action(async (endUserId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.endUsers.setCredentials(endUserId, {
        twitterAuthToken: opts.twitterAuthToken,
        twitterCt0: opts.twitterCt0,
        redditSession: opts.redditSession,
        tiktokSessionId: opts.tiktokSessionId,
        tiktokCsrfToken: opts.tiktokCsrfToken,
        instagramSessionId: opts.instagramSessionId,
        instagramCsrfToken: opts.instagramCsrfToken,
        instagramDsUserId: opts.instagramDsUserId,
      });
      success(`Credentials stored for end-user: ${endUserId}`);
      print(result, getFormat(credentialsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

credentialsCmd
  .command('status <endUserId>')
  .description('Show which platforms have credentials configured')
  .action(async (endUserId: string) => {
    try {
      const client = getClient();
      const result = await client.endUsers.getCredentials(endUserId);
      print(result, getFormat(credentialsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

credentialsCmd
  .command('delete <endUserId>')
  .description('Revoke all stored credentials for an end-user')
  .action(async (endUserId: string) => {
    try {
      const client = getClient();
      await client.endUsers.deleteCredentials(endUserId);
      success(`Credentials revoked for end-user: ${endUserId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Design Extraction Commands
// ============================================
const designCmd = program
  .command('design')
  .description('Design asset extraction');

designCmd
  .command('extract <url>')
  .description('Submit a design extraction for a URL')
  .requiredOption('-u, --end-user <id>', 'End-user identifier')
  .option('-e, --extractors <list>', `Comma-separated subset (${EXTRACTORS.join(', ')})`)
  .option('--ip-rotation', 'Route through the residential proxy pool')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const extractors = opts.extractors
        ? (opts.extractors.split(',').map((e: string) => e.trim()) as Extractor[])
        : undefined;
      const result = await client.design.extract({
        url,
        endUserId: opts.endUser,
        extractors,
        enableIpRotation: opts.ipRotation,
      });
      success(`Design extraction submitted: ${result.taskId}`);
      info(`Poll with "${CONNECTOR_NAME} tasks get ${result.taskId}"`);
      print(result, getFormat(designCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

designCmd
  .command('extract-one <extractor> <url>')
  .description(`Run a single extractor (${EXTRACTORS.join(', ')})`)
  .requiredOption('-u, --end-user <id>', 'End-user identifier')
  .option('--ip-rotation', 'Route through the residential proxy pool')
  .action(async (extractor: string, url: string, opts) => {
    try {
      if (!EXTRACTORS.includes(extractor as Extractor)) {
        error(`Invalid extractor "${extractor}". Choose one of: ${EXTRACTORS.join(', ')}`);
        process.exit(1);
      }
      const client = getClient();
      const result = await client.design.extractByExtractor(extractor as Extractor, {
        url,
        endUserId: opts.endUser,
        enableIpRotation: opts.ipRotation,
      });
      success(`Extraction submitted: ${result.taskId}`);
      info(`Poll with "${CONNECTOR_NAME} tasks get ${result.taskId}"`);
      print(result, getFormat(designCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Raw Request (escape hatch)
// ============================================
program
  .command('raw <method> <path>')
  .description('Make an arbitrary authenticated request (e.g. raw GET /tasks)')
  .option('-d, --data <json>', 'JSON request body')
  .action(async (method: string, path: string, opts) => {
    try {
      const client = getClient();
      const body = opts.data ? JSON.parse(opts.data) : undefined;
      const result = await client.raw(path, {
        method: method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        body,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
