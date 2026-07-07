#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  clearConfig,
  getConfigDir,
  getBaseUrl,
  getAuthMode,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';
import type { LinkCreateParams, PaginationParams } from '../types';

const CONNECTOR_NAME = 'connect-terminus';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Terminus UTM and link management API connector')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.TERMINUS_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TERMINUS_API_KEY.`);
    process.exit(1);
  }
  return new Connector({
    apiKey,
    baseUrl: getBaseUrl(),
    authMode: getAuthMode(),
  });
}

function paginationOpts(opts: { page?: string; items?: string }): { page?: number; items?: number } {
  const params: { page?: number; items?: number } = {};
  if (opts.page) params.page = parseInt(opts.page, 10);
  if (opts.items) params.items = parseInt(opts.items, 10);
  return params;
}

// Profile commands
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
    profiles.forEach((p) => {
      const active = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${active}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
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
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.terminusapp.com)')}`);
    info(`Auth mode: ${getAuthMode() || 'basic'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Project commands
const projectCmd = program.command('project').description('Manage Terminus projects');

projectCmd
  .command('list')
  .description('List projects')
  .option('--page <n>', 'Page number')
  .option('--items <n>', 'Items per page (1-100)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.projects.list(paginationOpts(opts));
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
// UTM value list helpers
function registerUtmCommand(
  name: string,
  description: string,
  accessor: (c: Connector) => { list: (id: string, p?: PaginationParams) => Promise<unknown> }
) {
  const cmd = program.command(name).description(description);
  cmd
    .command('list <projectId>')
    .description(`List ${name} values for a project`)
    .option('--page <n>', 'Page number')
    .option('--items <n>', 'Items per page (1-100)')
    .action(async (projectId: string, opts) => {
      try {
        const client = getClient();
        const result = await accessor(client).list(projectId, paginationOpts(opts));
        print(result, getFormat(cmd));
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}

registerUtmCommand('campaign', 'UTM campaign values', (c) => c.campaigns);
registerUtmCommand('content', 'UTM content values', (c) => c.contents);
registerUtmCommand('medium', 'UTM medium values', (c) => c.mediums);
registerUtmCommand('source', 'UTM source values', (c) => c.sources);
registerUtmCommand('term', 'UTM term values', (c) => c.terms);

// Link commands
const linkCmd = program.command('link').description('Manage tracked links');

linkCmd
  .command('list <projectId>')
  .description('List links for a project')
  .option('--page <n>', 'Page number')
  .option('--items <n>', 'Items per page')
  .option('--created-after <ts>', 'Unix timestamp — created_at[gt]')
  .option('--updated-after <ts>', 'Unix timestamp — updated_at[gt]')
  .action(async (projectId: string, opts: { page?: string; items?: string; createdAfter?: string; updatedAfter?: string }) => {
    try {
      const client = getClient();
      const params = {
        ...paginationOpts(opts),
        ...(opts.createdAfter ? { 'created_at[gt]': parseInt(opts.createdAfter, 10) } : {}),
        ...(opts.updatedAfter ? { 'updated_at[gt]': parseInt(opts.updatedAfter, 10) } : {}),
      };
      const result = await client.links.list(projectId, params);
      print(result, getFormat(linkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

linkCmd
  .command('create <projectId>')
  .description('Create a tracked link')
  .requiredOption('-u, --url <url>', 'Destination URL')
  .option('-d, --description <text>', 'Link description')
  .option('--body <json>', 'Full JSON body (overrides other options)')
  .option('--body-file <path>', 'JSON body from file')
  .action(async (projectId: string, opts: { url: string; description?: string; body?: string; bodyFile?: string }) => {
    try {
      const client = getClient();
      let data: LinkCreateParams;
      if (opts.bodyFile) {
        data = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else if (opts.body) {
        data = JSON.parse(opts.body);
      } else {
        data = { url: opts.url, description: opts.description };
      }
      const result = await client.links.create(projectId, data);
      success('Link created');
      print(result, getFormat(linkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request escape hatch
program
  .command('raw <method> <path>')
  .description('Send a raw API request (path relative to base URL, e.g. /v1/projects/)')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'JSON body from file')
  .action(async (method: string, path: string, opts: { body?: string; bodyFile?: string }) => {
    const upper = method.toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) {
      error(`Unsupported method: ${method}`);
      process.exit(1);
    }
    try {
      const client = getClient();
      let body: Record<string, unknown> | string | undefined;
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else if (opts.body) {
        body = JSON.parse(opts.body);
      }
      const result = await client.rawRequest(upper as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path, { body });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
