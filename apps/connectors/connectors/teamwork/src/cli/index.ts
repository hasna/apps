#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getInstallation,
  setInstallation,
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
import type { ListParams } from '../types';

const CONNECTOR_NAME = 'connect-teamwork';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Teamwork connector CLI - projects, tasks, milestones, time, and people')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
  .option('-s, --installation <name>', 'Teamwork site name (subdomain of {installation}.teamwork.com)')
  .option('--base-url <url>', 'Full base URL override (https://{installation}.teamwork.com)')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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
      process.env.TEAMWORK_API_KEY = opts.apiKey;
      debug('API token set from command line flag');
    }
    if (opts.installation) {
      process.env.TEAMWORK_INSTALLATION = opts.installation;
      debug('Installation set from command line flag');
    }
    if (opts.baseUrl) {
      process.env.TEAMWORK_BASE_URL = opts.baseUrl;
      debug('Base URL set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set TEAMWORK_API_KEY environment variable.`);
    process.exit(1);
  }
  const installation = getInstallation();
  const baseUrl = getBaseUrl();
  if (!installation && !baseUrl) {
    error(`No Teamwork site configured. Run "${CONNECTOR_NAME} config set-installation <name>" or set TEAMWORK_INSTALLATION environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, installation, baseUrl });
}

function listOptions(cmd: Command): Command {
  return cmd
    .option('-l, --limit <number>', 'Max results per page', '20')
    .option('--page <number>', 'Page number (1-indexed)', '1')
    .option('--search <query>', 'Search term')
    .option('--order-by <field>', 'Field to order by')
    .option('--order-mode <mode>', 'Order mode (asc, desc)')
    .option('--include <sideloads>', 'Comma-separated sideloads to include');
}

function toListParams(opts: Record<string, string | undefined>): ListParams {
  const params: ListParams = {};
  if (opts.limit) params.pageSize = parseInt(opts.limit, 10);
  if (opts.page) params.page = parseInt(opts.page, 10);
  if (opts.search) params.searchTerm = opts.search;
  if (opts.orderBy) params.orderBy = opts.orderBy;
  if (opts.orderMode === 'asc' || opts.orderMode === 'desc') params.orderMode = opts.orderMode;
  if (opts.include) params.include = opts.include;
  return params;
}

function fail(err: unknown): never {
  error(String(err));
  process.exit(1);
}

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
  .option('--api-key <key>', 'API token')
  .option('--installation <name>', 'Teamwork site name')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      installation: opts.installation,
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
    info(`API Token: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Installation: ${config.installation || chalk.gray('not set')}`);
    if (config.baseUrl) info(`Base URL: ${config.baseUrl}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <token>')
  .description('Set API token')
  .action((token: string) => {
    setApiKey(token);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-installation <name>')
  .description('Set Teamwork site name')
  .action((name: string) => {
    setInstallation(name);
    success(`Installation saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set full base URL override')
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
    info(`API Token: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Installation: ${getInstallation() || chalk.gray('not set')}`);
    if (getBaseUrl()) info(`Base URL: ${getBaseUrl()}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Projects Commands
// ============================================
const projectsCmd = program.command('projects').description('Manage projects');

listOptions(projectsCmd.command('list').description('List projects')).action(async (opts, cmd) => {
  try {
    const result = await getClient().projects.list(toListParams(opts));
    print(result, getFormat(cmd.parent));
  } catch (err) {
    fail(err);
  }
});

projectsCmd
  .command('get <id>')
  .description('Get a project by ID')
  .option('--include <sideloads>', 'Comma-separated sideloads to include')
  .action(async (id: string, opts, cmd) => {
    try {
      const result = await getClient().projects.get(id, opts.include);
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

projectsCmd
  .command('create')
  .description('Create a new project')
  .requiredOption('-n, --name <name>', 'Project name')
  .option('--description <text>', 'Project description')
  .option('--start-date <date>', 'Start date (YYYYMMDD or ISO)')
  .option('--end-date <date>', 'End date (YYYYMMDD or ISO)')
  .option('--company-id <id>', 'Owner company ID')
  .action(async (opts, cmd) => {
    try {
      const result = await getClient().projects.create({
        name: opts.name,
        description: opts.description,
        startDate: opts.startDate,
        endDate: opts.endDate,
        companyId: opts.companyId ? parseInt(opts.companyId, 10) : undefined,
      });
      success('Project created');
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

projectsCmd
  .command('delete <id>')
  .description('Delete a project by ID')
  .action(async (id: string) => {
    try {
      await getClient().projects.delete(id);
      success(`Project ${id} deleted`);
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Tasks Commands
// ============================================
const tasksCmd = program.command('tasks').description('Manage tasks');

listOptions(tasksCmd.command('list').description('List tasks'))
  .option('--project <id>', 'Filter by project ID')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const params = toListParams(opts);
      const result = opts.project
        ? await client.tasks.listByProject(opts.project, params)
        : await client.tasks.list(params);
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

tasksCmd
  .command('get <id>')
  .description('Get a task by ID')
  .option('--include <sideloads>', 'Comma-separated sideloads to include')
  .action(async (id: string, opts, cmd) => {
    try {
      const result = await getClient().tasks.get(id, opts.include);
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

tasksCmd
  .command('create <tasklistId>')
  .description('Create a task inside a tasklist')
  .requiredOption('-n, --name <name>', 'Task name')
  .option('--description <text>', 'Task description')
  .option('--priority <priority>', 'Priority (low, medium, high)')
  .option('--start-date <date>', 'Start date (YYYYMMDD or ISO)')
  .option('--due-date <date>', 'Due date (YYYYMMDD or ISO)')
  .action(async (tasklistId: string, opts, cmd) => {
    try {
      const result = await getClient().tasks.create(tasklistId, {
        name: opts.name,
        description: opts.description,
        priority: opts.priority,
        startDate: opts.startDate,
        dueDate: opts.dueDate,
      });
      success('Task created');
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

tasksCmd
  .command('complete <id>')
  .description('Mark a task as complete')
  .action(async (id: string) => {
    try {
      await getClient().tasks.complete(id);
      success(`Task ${id} marked complete`);
    } catch (err) {
      fail(err);
    }
  });

tasksCmd
  .command('delete <id>')
  .description('Delete a task by ID')
  .action(async (id: string) => {
    try {
      await getClient().tasks.delete(id);
      success(`Task ${id} deleted`);
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Tasklists Commands
// ============================================
const tasklistsCmd = program.command('tasklists').description('Manage task lists');

listOptions(tasklistsCmd.command('list <projectId>').description('List task lists in a project')).action(
  async (projectId: string, opts, cmd) => {
    try {
      const result = await getClient().tasklists.listByProject(projectId, toListParams(opts));
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  }
);

tasklistsCmd
  .command('get <id>')
  .description('Get a task list by ID')
  .action(async (id: string, _opts, cmd) => {
    try {
      const result = await getClient().tasklists.get(id);
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

tasklistsCmd
  .command('create <projectId>')
  .description('Create a task list in a project')
  .requiredOption('-n, --name <name>', 'Task list name')
  .option('--description <text>', 'Description')
  .action(async (projectId: string, opts, cmd) => {
    try {
      const result = await getClient().tasklists.create(projectId, {
        name: opts.name,
        description: opts.description,
      });
      success('Task list created');
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Milestones Commands
// ============================================
const milestonesCmd = program.command('milestones').description('Manage milestones');

listOptions(milestonesCmd.command('list').description('List milestones'))
  .option('--project <id>', 'Filter by project ID')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const params = toListParams(opts);
      const result = opts.project
        ? await client.milestones.listByProject(opts.project, params)
        : await client.milestones.list(params);
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

milestonesCmd
  .command('get <id>')
  .description('Get a milestone by ID')
  .action(async (id: string, _opts, cmd) => {
    try {
      const result = await getClient().milestones.get(id);
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// People Commands
// ============================================
const peopleCmd = program.command('people').description('Manage people');

listOptions(peopleCmd.command('list').description('List people'))
  .option('--project <id>', 'Filter by project ID')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const params = toListParams(opts);
      const result = opts.project
        ? await client.people.listByProject(opts.project, params)
        : await client.people.list(params);
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

peopleCmd
  .command('get <id>')
  .description('Get a person by ID')
  .action(async (id: string, _opts, cmd) => {
    try {
      const result = await getClient().people.get(id);
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

peopleCmd
  .command('me')
  .description('Get the currently authenticated user')
  .action(async (_opts, cmd) => {
    try {
      const result = await getClient().people.me();
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Companies Commands
// ============================================
const companiesCmd = program.command('companies').description('Manage companies');

listOptions(companiesCmd.command('list').description('List companies')).action(async (opts, cmd) => {
  try {
    const result = await getClient().companies.list(toListParams(opts));
    print(result, getFormat(cmd.parent));
  } catch (err) {
    fail(err);
  }
});

companiesCmd
  .command('get <id>')
  .description('Get a company by ID')
  .action(async (id: string, _opts, cmd) => {
    try {
      const result = await getClient().companies.get(id);
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Time Commands
// ============================================
const timeCmd = program.command('time').description('View time entries');

listOptions(timeCmd.command('list').description('List time entries'))
  .option('--project <id>', 'Filter by project ID')
  .option('--task <id>', 'Filter by task ID')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const params = toListParams(opts);
      let result;
      if (opts.task) {
        result = await client.time.listByTask(opts.task, params);
      } else if (opts.project) {
        result = await client.time.listByProject(opts.project, params);
      } else {
        result = await client.time.list(params);
      }
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

// ============================================
// Comments Commands
// ============================================
const commentsCmd = program.command('comments').description('View comments');

listOptions(commentsCmd.command('list').description('List comments'))
  .option('--task <id>', 'Filter by task ID')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const params = toListParams(opts);
      const result = opts.task
        ? await client.comments.listByTask(opts.task, params)
        : await client.comments.list(params);
      print(result, getFormat(cmd.parent));
    } catch (err) {
      fail(err);
    }
  });

// Parse and execute
program.parse();
