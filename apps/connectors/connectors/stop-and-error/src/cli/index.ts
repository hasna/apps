#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { StopAndError } from '../api';
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
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

const CONNECTOR_NAME = 'stop-and-error';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('StopAndError API connector CLI - Workflow error handler')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
      process.env.STOP_AND_ERROR_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): StopAndError {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STOP_AND_ERROR_API_KEY.`);
    process.exit(1);
  }
  return new StopAndError({ apiKey, baseUrl: getBaseUrl() });
}

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
      error(`Profile "${name}" does not exist.`);
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
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
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.stop-and-error.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const statusCmd = program.command('status').description('Show connector status');

statusCmd.action(() => {
  const apiKey = getApiKey();
  const client = apiKey ? new StopAndError({ apiKey, baseUrl: getBaseUrl() }) : null;

  console.log(chalk.bold('StopAndError Connector Status'));
  info(`Profile: ${getCurrentProfile()}`);
  info(`API Key: ${apiKey ? client!.getApiKeyPreview() : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || 'https://api.stop-and-error.com/v1'}`);
});

const errorsCmd = program.command('errors').description('Workflow error operations');

errorsCmd
  .command('list')
  .description('List workflow errors')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listErrors({
        cursor: opts.cursor,
        limit: parseInt(opts.limit, 10),
      });
      print(result, getFormat(errorsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

errorsCmd
  .command('get <id>')
  .description('Get a workflow error by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getError(id);
      print(result, getFormat(errorsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

errorsCmd
  .command('create')
  .description('Create a workflow error')
  .requiredOption('-m, --message <message>', 'Error message')
  .option('--code <code>', 'Error code')
  .option('--severity <severity>', 'Error severity')
  .option('--workflow-id <id>', 'Workflow ID')
  .option('--node-id <id>', 'Node ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createError({
        message: opts.message,
        code: opts.code,
        severity: opts.severity,
        workflowId: opts.workflowId,
        nodeId: opts.nodeId,
      });
      success('Error created');
      print(result, getFormat(errorsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Workflow event operations');

eventsCmd
  .command('list')
  .description('List workflow events')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--error-id <id>', 'Filter by error ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents({
        cursor: opts.cursor,
        limit: parseInt(opts.limit, 10),
        errorId: opts.errorId,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Search workflow errors');

searchCmd
  .requiredOption('-q, --query <query>', 'Search query')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.search({
        query: opts.query,
        limit: parseInt(opts.limit, 10),
        cursor: opts.cursor,
      });
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Make a raw API request');

rawCmd
  .requiredOption('-p, --path <path>', 'API path (e.g. /errors)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-b, --body <json>', 'Request body as JSON string')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const result = await client.rawRequest({
        method: opts.method,
        path: opts.path,
        body,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
