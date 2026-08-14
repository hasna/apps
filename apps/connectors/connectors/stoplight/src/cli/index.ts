#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Stoplight } from '../api';
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

const CONNECTOR_NAME = 'connect-stoplight';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stoplight connector - API design, documentation, projects, events, and search')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-b, --base-url <url>', 'API base URL (overrides config)')
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
    if (opts.apiKey) {
      process.env.STOPLIGHT_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.STOPLIGHT_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Stoplight {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} auth login <key>" or set STOPLIGHT_API_KEY.`);
    process.exit(1);
  }
  return new Stoplight({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

// ============================================
// Auth Commands
// ============================================
const authCmd = program.command('auth').description('Authentication');

authCmd
  .command('login <apiKey>')
  .description('Save API key to the active profile')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

authCmd
  .command('logout')
  .description('Clear API key from the active profile')
  .action(() => {
    clearConfig();
    success(`Credentials cleared for profile: ${getCurrentProfile()}`);
  });

authCmd
  .command('status')
  .description('Show authentication status')
  .action(() => {
    const apiKey = getApiKey();
    const profileName = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl()}`);
  });

// ============================================
// Profile Commands
// ============================================
const profileCmd = program.command('profile').description('Manage configuration profiles');

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
    info(`API key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.stoplight.io/v1)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL for the active profile')
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

    console.log(chalk.bold(`Active profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl()}`);
  });

// ============================================
// Project Commands
// ============================================
const projectCmd = program.command('project').description('Project operations');

projectCmd
  .command('list')
  .description('List projects')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listProjects();
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('get <projectId>')
  .description('Get a project by ID')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      const result = await client.getProject(projectId);
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('create')
  .description('Create a project')
  .option('--body <json>', 'Project JSON body')
  .option('--body-file <path>', 'Path to JSON file with project body')
  .action(async (opts) => {
    try {
      let body = parseJsonOption(opts.body, '--body');
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8')) as Record<string, unknown>;
      }
      if (!body) {
        error('Provide --body or --body-file with project JSON');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.createProject(body);
      success('Project created');
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Event Commands
// ============================================
const eventCmd = program.command('event').description('Event operations');

eventCmd
  .command('list')
  .description('List events')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listEvents();
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Search Commands
// ============================================
const searchCmd = program.command('search').description('Search operations');

searchCmd
  .command('run')
  .description('Run a search query')
  .option('--body <json>', 'Search JSON body')
  .option('--body-file <path>', 'Path to JSON file with search body')
  .action(async (opts) => {
    try {
      let body = parseJsonOption(opts.body, '--body');
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8')) as Record<string, unknown>;
      }
      if (!body) {
        error('Provide --body or --body-file with search JSON');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.search(body);
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Raw Request
// ============================================
program
  .command('raw <path>')
  .description('Send a raw API request')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON')
  .option('--body-file <path>', 'Path to JSON file for request body')
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const query = parseJsonOption(opts.query, '--query') as Record<string, string | number | boolean | undefined> | undefined;
      const result = await client.rawRequest(path, {
        method: opts.method,
        query,
        body: opts.bodyFile
          ? JSON.parse(readFileSync(opts.bodyFile, 'utf-8'))
          : parseJsonOption(opts.body, '--body'),
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
