#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Voltair } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
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

const CONNECTOR_NAME = 'connect-voltair';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Voltair connector CLI - AI project run API')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Voltair {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VOLTAIR_API_KEY`);
    process.exit(1);
  }
  return new Voltair({ apiKey, baseUrl: getBaseUrl() });
}

function parseQueryOption(queryJson?: string): Record<string, string | number | boolean> | undefined {
  if (!queryJson) return undefined;
  return JSON.parse(queryJson) as Record<string, string | number | boolean>;
}

function parseBodyOption(bodyJson?: string): Record<string, unknown> {
  if (!bodyJson) return {};
  return JSON.parse(bodyJson) as Record<string, unknown>;
}

// Profile commands
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found');
    return;
  }
  profiles.forEach((p) => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  });
});

profileCmd
  .command('use <name>')
  .description('Switch profile')
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
  .description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
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
  .description('Delete profile')
  .action((name: string) => {
    if (name === 'default') {
      error('Cannot delete default profile');
      process.exit(1);
    }
    if (deleteProfile(name)) success(`Profile "${name}" deleted`);
    else {
      error(`Profile "${name}" not found`);
      process.exit(1);
    }
  });

profileCmd
  .command('show [name]')
  .description('Show profile')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    console.log(chalk.bold(`Profile: ${profileName}`));
    info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success('API key saved');
  });

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const apiKey = getApiKey();
  info(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl()}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Projects commands
const projectsCmd = program.command('projects').description('Manage projects');

projectsCmd
  .command('list')
  .description('List projects')
  .option('-q, --query <json>', 'Query parameters as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listProjects(parseQueryOption(opts.query));
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('get <projectId>')
  .description('Get a project')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      const result = await client.getProject(projectId);
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Runs commands
const runsCmd = program.command('runs').description('Manage project runs');

runsCmd
  .command('create <projectId>')
  .description('Create a run')
  .option('-b, --body <json>', 'Request body as JSON')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createRun(projectId, parseBodyOption(opts.body));
      print(result, getFormat(runsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

runsCmd
  .command('get <projectId> <runId>')
  .description('Get a run')
  .action(async (projectId: string, runId: string) => {
    try {
      const client = getClient();
      const result = await client.getRun(projectId, runId);
      print(result, getFormat(runsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request
program
  .command('raw-request')
  .description('Send an arbitrary API request')
  .requiredOption('--path <path>', 'API path (e.g. /projects or /custom/endpoint)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-b, --body <json>', 'Request body as JSON')
  .option('-q, --query <json>', 'Query parameters as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        body: opts.body ? parseBodyOption(opts.body) : undefined,
        query: parseQueryOption(opts.query),
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
