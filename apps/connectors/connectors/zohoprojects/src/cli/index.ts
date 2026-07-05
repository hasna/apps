#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoProjects } from '../api';
import {
  getToken,
  setToken,
  getPortalId,
  setPortalId,
  getDataCenter,
  setDataCenter,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-zohoprojects';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Projects API connector CLI')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides profile)')
  .option('--portal-id <id>', 'Default portal ID')
  .option('--data-center <dc>', 'Zoho data center (com, eu, in, com.au, jp, ca, sa)')
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

    if (opts.token) {
      process.env.ZOHOPROJECTS_TOKEN = opts.token;
    }
    if (opts.portalId) {
      process.env.ZOHOPROJECTS_PORTAL_ID = opts.portalId;
    }
    if (opts.dataCenter) {
      process.env.ZOHOPROJECTS_DATA_CENTER = opts.dataCenter;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoProjects {
  const token = getToken();
  if (!token) {
    error(
      `No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHOPROJECTS_TOKEN.`,
    );
    process.exit(1);
  }
  return new ZohoProjects({
    token,
    portalId: getPortalId(),
    dataCenter: getDataCenter(),
    baseUrl: getBaseUrl(),
  });
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
      error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'OAuth access token')
  .option('--portal-id <id>', 'Default portal ID')
  .option('--data-center <dc>', 'Zoho data center')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      token: opts.token,
      portalId: opts.portalId,
      dataCenter: opts.dataCenter,
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

    console.log(
      chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`),
    );
    info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Portal ID: ${config.portalId || chalk.gray('not set')}`);
    info(`Data center: ${config.dataCenter || chalk.gray('com (default)')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set OAuth access token')
  .action((token: string) => {
    setToken(token);
    success(`Token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-portal-id <portalId>')
  .description('Set default portal ID')
  .action((portalId: string) => {
    setPortalId(portalId);
    success(`Portal ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-data-center <dc>')
  .description('Set Zoho data center')
  .action((dc: string) => {
    setDataCenter(dc);
    success(`Data center saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Override API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const token = getToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Portal ID: ${getPortalId() || chalk.gray('not set')}`);
    info(`Data center: ${getDataCenter() || chalk.gray('com (default)')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('auto from data center')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const portalsCmd = program.command('portals').description('Portal operations');

portalsCmd
  .command('list')
  .description('List accessible portals')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listPortals();
      print(result, getFormat(portalsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const projectsCmd = program.command('projects').description('Project operations');

projectsCmd
  .command('list')
  .description('List projects in a portal')
  .option('--portal-id <id>', 'Portal ID')
  .option('--status <status>', 'Filter by status (active, archived, template)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listProjects(opts.portalId, { status: opts.status });
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('get <projectId>')
  .description('Get a project by ID')
  .option('--portal-id <id>', 'Portal ID')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getProject(opts.portalId, projectId);
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('create')
  .description('Create a project')
  .requiredOption('-n, --name <name>', 'Project name')
  .option('--portal-id <id>', 'Portal ID')
  .option('--description <text>', 'Project description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createProject(opts.portalId, {
        name: opts.name,
        description: opts.description,
      });
      success('Project created');
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('delete <projectId>')
  .description('Delete a project')
  .option('--portal-id <id>', 'Portal ID')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      await client.deleteProject(opts.portalId, projectId);
      success('Project deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const tasksCmd = program.command('tasks').description('Task operations');

tasksCmd
  .command('list <projectId>')
  .description('List tasks in a project')
  .option('--portal-id <id>', 'Portal ID')
  .option('--status <status>', 'Task status (open, closed, all)')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listTasks(opts.portalId, projectId, { status: opts.status });
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('get <projectId> <taskId>')
  .description('Get a task by ID')
  .option('--portal-id <id>', 'Portal ID')
  .action(async (projectId: string, taskId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getTask(opts.portalId, projectId, taskId);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('create <projectId>')
  .description('Create a task')
  .requiredOption('-n, --name <name>', 'Task name')
  .option('--portal-id <id>', 'Portal ID')
  .option('--tasklist-id <id>', 'Task list ID')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createTask(opts.portalId, projectId, {
        name: opts.name,
        tasklistId: opts.tasklistId,
      });
      success('Task created');
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('delete <projectId> <taskId>')
  .description('Delete a task')
  .option('--portal-id <id>', 'Portal ID')
  .action(async (projectId: string, taskId: string, opts) => {
    try {
      const client = getClient();
      await client.deleteTask(opts.portalId, projectId, taskId);
      success('Task deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
