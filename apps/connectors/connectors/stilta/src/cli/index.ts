#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Stilta } from '../api';
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

const CONNECTOR_NAME = 'connect-stilta';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stilta connector - Patent search, research jobs, and prior-art analysis')
  .version(VERSION)
  .option('-t, --token <token>', 'API key (overrides config)')
  .option('-b, --base-url <url>', 'API base URL (overrides config)')
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
    if (opts.token) {
      process.env.STILTA_API_KEY = opts.token;
    }
    if (opts.baseUrl) {
      process.env.STILTA_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let current: Command | null = cmd;
  while (current) {
    const format = current.opts().format;
    if (format) {
      return format as OutputFormat;
    }
    current = current.parent;
  }
  return 'pretty';
}

function getClient(): Stilta {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STILTA_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Stilta({ apiKey, baseUrl: getBaseUrl() });
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    error(`Invalid JSON for ${label}`);
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
  .option('--token <token>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.token,
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
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl ? config.baseUrl : chalk.gray('default')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <key>')
  .description('Set API key')
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Patent Commands
// ============================================
const patentCmd = program
  .command('patent')
  .description('Search and retrieve patents');

patentCmd
  .command('search')
  .description('Search patents (POST /patents/search)')
  .option('-q, --query <query>', 'Search query')
  .option('-l, --limit <n>', 'Maximum number of results', (v) => parseInt(v, 10))
  .option('-o, --offset <n>', 'Result offset for pagination', (v) => parseInt(v, 10))
  .option('--filters <json>', 'Additional filters as a JSON object')
  .option('--body <json>', 'Full request body as JSON (overrides other options)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params = opts.body
        ? (parseJson(opts.body, '--body') as Record<string, unknown>)
        : {
            ...(opts.query !== undefined ? { query: opts.query } : {}),
            ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
            ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
            ...(opts.filters ? { filters: parseJson(opts.filters, '--filters') as Record<string, unknown> } : {}),
          };
      const result = await client.searchPatents(params);
      print(result, getFormat(patentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

patentCmd
  .command('get <patentId>')
  .description('Get a patent by ID (GET /patents/{patentId})')
  .action(async (patentId: string) => {
    try {
      const client = getClient();
      const result = await client.getPatent(patentId);
      print(result, getFormat(patentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Research Job Commands
// ============================================
const jobCmd = program
  .command('research-job')
  .alias('job')
  .description('Manage prior-art / research jobs');

jobCmd
  .command('list')
  .description('List research jobs (GET /research-jobs)')
  .option('-l, --limit <n>', 'Maximum number of results', (v) => parseInt(v, 10))
  .option('-o, --offset <n>', 'Result offset for pagination', (v) => parseInt(v, 10))
  .option('-s, --status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listResearchJobs({
        limit: opts.limit,
        offset: opts.offset,
        status: opts.status,
      });
      print(result, getFormat(jobCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobCmd
  .command('create')
  .description('Create a research job (POST /research-jobs)')
  .option('--type <type>', 'Research job type (e.g. prior-art)')
  .option('-q, --query <query>', 'Query or subject for the job')
  .option('--body <json>', 'Full request body as JSON (overrides other options)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params = opts.body
        ? (parseJson(opts.body, '--body') as Record<string, unknown>)
        : {
            ...(opts.type !== undefined ? { type: opts.type } : {}),
            ...(opts.query !== undefined ? { query: opts.query } : {}),
          };
      const result = await client.createResearchJob(params);
      print(result, getFormat(jobCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobCmd
  .command('get <jobId>')
  .description('Get a research job by ID (GET /research-jobs/{jobId})')
  .action(async (jobId: string) => {
    try {
      const client = getClient();
      const result = await client.getResearchJob(jobId);
      print(result, getFormat(jobCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Raw Request Command
// ============================================
program
  .command('raw <path>')
  .description('Perform an arbitrary request against the Stilta API')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('-q, --query <json>', 'Query parameters as a JSON object')
  .option('--body <json>', 'Request body as JSON')
  .action(async (path: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path,
        method: String(opts.method).toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        query: opts.query ? (parseJson(opts.query, '--query') as Record<string, string | number | boolean>) : undefined,
        body: opts.body ? (parseJson(opts.body, '--body') as Record<string, unknown>) : undefined,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
