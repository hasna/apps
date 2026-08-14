#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TurbotPipes } from '../api';
import {
  getApiToken,
  setApiToken,
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

const CONNECTOR_NAME = 'connect-turbot-pipes';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Turbot Pipes connector - Cloud intelligence workspaces, queries, and snapshots')
  .version(VERSION)
  .option('-t, --token <token>', 'API token (overrides config)')
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
      process.env.TURBOT_PIPES_API_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TurbotPipes {
  const apiToken = getApiToken();
  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set TURBOT_PIPES_API_TOKEN environment variable.`);
    process.exit(1);
  }
  return new TurbotPipes({ apiToken });
}

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
  .option('--token <token>', 'API token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, { apiToken: opts.token });
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
    info(`API Token: ${config.apiToken ? `${config.apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set API token')
  .action((token: string) => {
    setApiToken(token);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiToken = getApiToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Token: ${apiToken ? `${apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program
  .command('validate')
  .description('Validate API credentials')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.validate();
      if (result.valid) {
        success('API credentials are valid');
      } else {
        error('API credentials are invalid');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('user')
  .description('Get current user')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.getCurrentUser();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const workspacesCmd = program
  .command('workspaces')
  .description('Manage workspaces');

workspacesCmd
  .command('list')
  .description('List workspaces in an organization')
  .requiredOption('--org <orgHandle>', 'Organization handle')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listWorkspaces(opts.org);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const workspaceCmd = program
  .command('workspace')
  .description('Workspace operations');

workspaceCmd
  .command('get')
  .description('Get a workspace')
  .requiredOption('--org <orgHandle>', 'Organization handle')
  .requiredOption('--workspace <workspaceHandle>', 'Workspace handle')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.getWorkspace(opts.org, opts.workspace);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const snapshotsCmd = program
  .command('snapshots')
  .description('Workspace snapshots');

snapshotsCmd
  .command('list')
  .description('List snapshots for a workspace')
  .requiredOption('--org <orgHandle>', 'Organization handle')
  .requiredOption('--workspace <workspaceHandle>', 'Workspace handle')
  .option('--limit <limit>', 'Maximum number of results', parseInt)
  .option('--next-token <token>', 'Pagination token')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listSnapshots(opts.org, opts.workspace, {
        limit: opts.limit,
        next_token: opts.nextToken,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const queryCmd = program
  .command('query')
  .description('Run SQL queries');

queryCmd
  .command('run')
  .description('Run a SQL query in a workspace')
  .requiredOption('--org <orgHandle>', 'Organization handle')
  .requiredOption('--workspace <workspaceHandle>', 'Workspace handle')
  .requiredOption('--sql <sql>', 'SQL query to execute')
  .option('--params <json>', 'Query parameters as JSON object or array')
  .action(async function(this: Command, opts) {
    try {
      let params: Record<string, unknown> | unknown[] | undefined;
      if (opts.params) {
        params = JSON.parse(opts.params);
      }
      const client = getClient();
      const result = await client.runQuery(opts.org, opts.workspace, {
        sql: opts.sql,
        params,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const processesCmd = program
  .command('processes')
  .description('Workspace processes');

processesCmd
  .command('list')
  .description('List processes for a workspace')
  .requiredOption('--org <orgHandle>', 'Organization handle')
  .requiredOption('--workspace <workspaceHandle>', 'Workspace handle')
  .option('--limit <limit>', 'Maximum number of results', parseInt)
  .option('--next-token <token>', 'Pagination token')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listProcesses(opts.org, opts.workspace, {
        limit: opts.limit,
        next_token: opts.nextToken,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
