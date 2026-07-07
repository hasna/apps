#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Trellistech } from '../api';
import {
  getApiKey,
  setApiKey,
  getWorkspaceId,
  setWorkspaceId,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-trellistech';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Trellis Tech property and task management API connector')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-w, --workspace-id <id>', 'Workspace ID (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
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
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.TRELLISTECH_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.workspaceId) {
      process.env.TRELLISTECH_WORKSPACE_ID = opts.workspaceId;
      debug('Workspace ID set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Trellistech {
  const apiKey = getApiKey();
  const workspaceId = getWorkspaceId();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRELLISTECH_API_KEY.`);
    process.exit(1);
  }
  if (!workspaceId) {
    error(`No workspace ID configured. Run "${CONNECTOR_NAME} config set-workspace <id>" or set TRELLISTECH_WORKSPACE_ID.`);
    process.exit(1);
  }

  return new Trellistech({ apiKey, workspaceId });
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
    profiles.forEach((p) => {
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
  .option('--workspace-id <id>', 'Workspace ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      workspaceId: opts.workspaceId,
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
    info(`Workspace ID: ${config.workspaceId || chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-workspace <workspaceId>')
  .description('Set workspace ID')
  .action((workspaceId: string) => {
    setWorkspaceId(workspaceId);
    success(`Workspace ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const workspaceId = getWorkspaceId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Workspace ID: ${workspaceId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const propertiesCmd = program.command('properties').description('Manage Trellis properties');

propertiesCmd
  .command('list')
  .description('List properties')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('-s, --status <status>', 'Filter by status (ACTIVE, PROSPECT, etc.)')
  .option('-q, --query <text>', 'Search name, internal code, or city')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.properties.list({
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
        status: opts.status,
        q: opts.query,
      });
      print(result, getFormat(propertiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propertiesCmd
  .command('get <propertyId>')
  .description('Get a property by ID')
  .action(async (propertyId: string) => {
    try {
      const client = getClient();
      const result = await client.properties.get(propertyId);
      print(result, getFormat(propertiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propertiesCmd
  .command('create')
  .description('Create a property')
  .requiredOption('-n, --name <name>', 'Property name')
  .option('-s, --status <status>', 'Property status')
  .option('--city <city>', 'City')
  .option('--country <country>', 'Country code')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.properties.create({
        name: opts.name,
        status: opts.status,
        city: opts.city,
        country: opts.country,
      });
      success('Property created');
      print(result, getFormat(propertiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propertiesCmd
  .command('update <propertyId>')
  .description('Update a property')
  .option('-n, --name <name>', 'Property name')
  .option('-s, --status <status>', 'Property status')
  .action(async (propertyId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.properties.update(propertyId, {
        name: opts.name,
        status: opts.status,
      });
      success('Property updated');
      print(result, getFormat(propertiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

propertiesCmd
  .command('delete <propertyId>')
  .description('Delete a property')
  .action(async (propertyId: string) => {
    try {
      const client = getClient();
      const result = await client.properties.delete(propertyId);
      success('Property deleted');
      print(result, getFormat(propertiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const tasksCmd = program.command('tasks').description('Manage Trellis tasks');

tasksCmd
  .command('list')
  .description('List tasks')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('-s, --status <status>', 'Filter by status')
  .option('--priority <priority>', 'Filter by priority')
  .option('--property-id <id>', 'Filter by property ID')
  .option('-q, --query <text>', 'Search title, description, or short ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.list({
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
        status: opts.status,
        priority: opts.priority,
        propertyId: opts.propertyId,
        q: opts.query,
      });
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
  .command('create')
  .description('Create a task')
  .requiredOption('-t, --title <title>', 'Task title')
  .requiredOption('-d, --department-id <id>', 'Department ID')
  .option('--description <text>', 'Task description')
  .option('--property-id <id>', 'Property ID')
  .option('--priority <priority>', 'Priority (NORMAL, HIGH, etc.)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.create({
        title: opts.title,
        departmentId: opts.departmentId,
        description: opts.description,
        propertyId: opts.propertyId,
        priority: opts.priority,
      });
      success('Task created');
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('update <taskId>')
  .description('Update a task')
  .option('-t, --title <title>', 'Task title')
  .option('-s, --status <status>', 'Task status')
  .option('--priority <priority>', 'Priority')
  .action(async (taskId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.update(taskId, {
        title: opts.title,
        status: opts.status,
        priority: opts.priority,
      });
      success('Task updated');
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('delete <taskId>')
  .description('Delete a task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.tasks.delete(taskId);
      success('Task deleted');
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
