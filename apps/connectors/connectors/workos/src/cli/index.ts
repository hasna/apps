#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { WorkOS } from '../api';
import {
  getApiKey,
  setApiKey,
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

const CONNECTOR_NAME = 'connect-workos';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('WorkOS connector CLI — organizations, SSO connections, directories, and events')
  .version(VERSION)
  .option('-k, --api-key <key>', 'WorkOS API key (overrides config)')
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
      process.env.WORKOS_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WorkOS {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WORKOS_API_KEY.`);
    process.exit(1);
  }
  return new WorkOS({ apiKey });
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
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'WorkOS API key')
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

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set WorkOS API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
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
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const organizationsCmd = program.command('organizations').description('WorkOS organizations');

organizationsCmd
  .command('list')
  .description('List organizations')
  .option('-n, --limit <number>', 'Maximum results', '10')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--before <cursor>', 'Pagination cursor')
  .option('--search <text>', 'Search by organization name')
  .action(async (opts: { limit: string; after?: string; before?: string; search?: string }) => {
    try {
      const client = getClient();
      const result = await client.listOrganizations({
        limit: parseInt(opts.limit, 10),
        after: opts.after,
        before: opts.before,
        search: opts.search,
      });
      print(result, getFormat(organizationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const connectionsCmd = program.command('connections').description('SSO connections');

connectionsCmd
  .command('list')
  .description('List SSO connections')
  .option('-n, --limit <number>', 'Maximum results', '10')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--before <cursor>', 'Pagination cursor')
  .option('--organization-id <id>', 'Filter by organization')
  .action(async (opts: { limit: string; after?: string; before?: string; organizationId?: string }) => {
    try {
      const client = getClient();
      const result = await client.listConnections({
        limit: parseInt(opts.limit, 10),
        after: opts.after,
        before: opts.before,
        organization_id: opts.organizationId,
      });
      print(result, getFormat(connectionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const directoriesCmd = program.command('directories').description('Directory sync');

directoriesCmd
  .command('list')
  .description('List directories')
  .option('-n, --limit <number>', 'Maximum results', '10')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--before <cursor>', 'Pagination cursor')
  .option('--organization-id <id>', 'Filter by organization')
  .action(async (opts: { limit: string; after?: string; before?: string; organizationId?: string }) => {
    try {
      const client = getClient();
      const result = await client.listDirectories({
        limit: parseInt(opts.limit, 10),
        after: opts.after,
        before: opts.before,
        organization_id: opts.organizationId,
      });
      print(result, getFormat(directoriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const directoryUsersCmd = program.command('directory-users').description('Directory users');

directoryUsersCmd
  .command('list')
  .description('List users in a directory')
  .requiredOption('--directory-id <id>', 'Directory ID')
  .option('-n, --limit <number>', 'Maximum results', '10')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--before <cursor>', 'Pagination cursor')
  .action(async (opts: { directoryId: string; limit: string; after?: string; before?: string }) => {
    try {
      const client = getClient();
      const result = await client.listDirectoryUsers({
        directory_id: opts.directoryId,
        limit: parseInt(opts.limit, 10),
        after: opts.after,
        before: opts.before,
      });
      print(result, getFormat(directoryUsersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('WorkOS events');

eventsCmd
  .command('list')
  .description('List events')
  .option('-n, --limit <number>', 'Maximum results', '10')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--before <cursor>', 'Pagination cursor')
  .option('--organization-id <id>', 'Filter by organization')
  .action(async (opts: { limit: string; after?: string; before?: string; organizationId?: string }) => {
    try {
      const client = getClient();
      const result = await client.listEvents({
        limit: parseInt(opts.limit, 10),
        after: opts.after,
        before: opts.before,
        organization_id: opts.organizationId,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
