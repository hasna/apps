#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
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
import { success, error, info, print, warn } from '../utils/output';
import type { HttpMethod } from '../types';

// Connector name and version
const CONNECTOR_NAME = 'connect-syntropy';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Syntropy API connector CLI — spec-driven agentic coding builds, pull requests, and tasks')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-b, --base-url <url>', 'API base URL (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
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
    if (opts.apiKey) {
      process.env.SYNTROPY_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.SYNTROPY_BASE_URL = opts.baseUrl;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Connector {
  const apiKey = getApiKey();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SYNTROPY_API_KEY environment variable.`);
    process.exit(1);
  }

  return new Connector({ apiKey, baseUrl: getBaseUrl() });
}

// Warn helper for stub (offline) results
function warnIfStub(stub: boolean): void {
  if (stub) {
    warn('API unreachable — showing placeholder data');
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
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
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
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set the API base URL')
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
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl ? baseUrl : chalk.gray('default (https://api.syntropy.io/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Spec Commands
// ============================================
program
  .command('list-specs')
  .description('List all specs')
  .action(async function(this: Command) {
    try {
      const result = await getClient().specs.list();
      warnIfStub(result.stub);
      print(result.specs, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-spec <specId>')
  .description('Get a single spec by ID')
  .action(async function(this: Command, specId: string) {
    try {
      const result = await getClient().specs.get(specId);
      warnIfStub(result.stub);
      print(result.spec, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('create-spec <title>')
  .description('Create a new spec (starts the discovery loop)')
  .option('--prompt <prompt>', 'Initial idea/prompt for the spec')
  .option('--repository <repo>', 'Target repository (e.g. owner/repo)')
  .action(async function(this: Command, title: string, opts) {
    try {
      const result = await getClient().specs.create({
        title,
        prompt: opts.prompt,
        repository: opts.repository,
      });
      warnIfStub(result.stub);
      print(result.spec, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Build Commands
// ============================================
program
  .command('list-builds')
  .description('List all builds')
  .action(async function(this: Command) {
    try {
      const result = await getClient().builds.list();
      warnIfStub(result.stub);
      print(result.builds, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-build <buildId>')
  .description('Get a single build by ID')
  .action(async function(this: Command, buildId: string) {
    try {
      const result = await getClient().builds.get(buildId);
      warnIfStub(result.stub);
      print(result.build, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('start-build <specId>')
  .description('Start a build for a spec')
  .action(async function(this: Command, specId: string) {
    try {
      const result = await getClient().builds.start(specId);
      warnIfStub(result.stub);
      print(result.build, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Pull Request Command
// ============================================
program
  .command('list-pull-requests')
  .alias('list-prs')
  .description('List pull requests opened by Syntropy builds')
  .action(async function(this: Command) {
    try {
      const result = await getClient().pullRequests.list();
      warnIfStub(result.stub);
      print(result.pull_requests, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Task Command
// ============================================
program
  .command('list-tasks')
  .description('List tasks')
  .action(async function(this: Command) {
    try {
      const result = await getClient().tasks.list();
      warnIfStub(result.stub);
      print(result.tasks, getFormat(this));
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
  .description('Make a raw authenticated request to an arbitrary Syntropy endpoint')
  .option('-X, --method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)', 'GET')
  .option('-q, --query <pairs...>', 'Query params as key=value pairs')
  .option('-d, --body <json>', 'Request body as a JSON string')
  .action(async function(this: Command, path: string, opts) {
    try {
      const query: Record<string, string> = {};
      for (const pair of (opts.query ?? []) as string[]) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        query[pair.slice(0, idx)] = pair.slice(idx + 1);
      }

      let body: unknown;
      if (opts.body) {
        try {
          body = JSON.parse(opts.body);
        } catch {
          error('--body must be valid JSON');
          process.exit(1);
        }
      }

      const result = await getClient().raw.request({
        method: (opts.method as string).toUpperCase() as HttpMethod,
        path,
        query: Object.keys(query).length ? query : undefined,
        body,
      });
      warnIfStub(result.stub);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
