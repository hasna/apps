#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Toggl } from '../api';
import type { TogglConfig, OutputFormat } from '../types';
import {
  getApiToken,
  setApiToken,
  clearConfig,
  getConfigDir,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  setProfileOverride,
  getActiveProfileName,
} from '../utils/config';
import { print } from '../utils/output';

const program = new Command();

function getClient(): Toggl {
  const apiToken = getApiToken();
  if (!apiToken) {
    console.error(chalk.red('Error: API token not configured.'));
    console.error(chalk.yellow('Run: connect-toggl config set-token <api-token>'));
    console.error(chalk.yellow('Or set TOGGL_API_TOKEN environment variable'));
    process.exit(1);
  }

  const config: TogglConfig = { apiToken };
  return new Toggl(config);
}

function handleOutput(data: unknown, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    print(data, format === 'pretty' ? 'pretty' : 'table');
  }
}

function parseWorkspaceId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (Number.isNaN(id)) {
    throw new Error(`Invalid workspace ID: ${value}`);
  }
  return id;
}

function parseProjectId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (Number.isNaN(id)) {
    throw new Error(`Invalid project ID: ${value}`);
  }
  return id;
}

function parseTimeEntryId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (Number.isNaN(id)) {
    throw new Error(`Invalid time entry ID: ${value}`);
  }
  return id;
}

function parseClientId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (Number.isNaN(id)) {
    throw new Error(`Invalid client ID: ${value}`);
  }
  return id;
}

function parseTagId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (Number.isNaN(id)) {
    throw new Error(`Invalid tag ID: ${value}`);
  }
  return id;
}

const profileCmd = new Command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles configured.'));
      console.log(chalk.gray('Create one with: connect-toggl profile create <name>'));
      return;
    }

    console.log(chalk.bold('Profiles:'));
    for (const profile of profiles) {
      const marker = profile === current ? chalk.green(' (active)') : '';
      console.log(`  ${profile}${marker}`);
    }
  });

profileCmd
  .command('current')
  .description('Show current active profile')
  .action(() => {
    console.log(getCurrentProfile());
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      console.log(chalk.green(`Switched to profile: ${name}`));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      const created = createProfile(name);
      if (created) {
        console.log(chalk.green(`Created profile: ${name}`));
      } else {
        console.log(chalk.yellow(`Profile already exists: ${name}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    const deleted = deleteProfile(name);
    if (deleted) {
      console.log(chalk.green(`Deleted profile: ${name}`));
    } else {
      console.log(chalk.yellow(`Could not delete profile: ${name}`));
    }
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profile = loadProfile(name);
    const profileName = name || getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}`));
    console.log(chalk.gray('API Token:'), profile.apiToken ? '***configured***' : 'not set');
  });

const configCmd = new Command('config').description('Manage configuration');

configCmd
  .command('set-token <apiToken>')
  .description('Set the API token for current profile')
  .action((apiToken: string) => {
    setApiToken(apiToken);
    const profile = getActiveProfileName();
    console.log(chalk.green(`API token saved to profile: ${profile}`));
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const apiToken = getApiToken();
    const configDir = getConfigDir();

    console.log(chalk.bold('Current Configuration:'));
    console.log(chalk.gray('Profile:'), profile);
    console.log(chalk.gray('Config directory:'), configDir);
    console.log(chalk.gray('API Token:'), apiToken ? '***configured***' : 'not set');
  });

configCmd
  .command('clear')
  .description('Clear configuration for current profile')
  .action(() => {
    clearConfig();
    console.log(chalk.green('Configuration cleared.'));
  });

configCmd
  .command('path')
  .description('Show configuration directory path')
  .action(() => {
    console.log(getConfigDir());
  });

const meCmd = new Command('me').description('Current user and personal resources');

meCmd
  .command('show')
  .description('Get current user')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      handleOutput(await client.getCurrentUser(), options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

meCmd
  .command('workspaces')
  .description('List my workspaces')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      handleOutput(await client.listMyWorkspaces(), options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

meCmd
  .command('projects')
  .description('List my projects')
  .option('--include-archived', 'Include archived projects')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      handleOutput(await client.listMyProjects(options.includeArchived), options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

meCmd
  .command('clients')
  .description('List my clients')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      handleOutput(await client.listMyClients(), options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

meCmd
  .command('organizations')
  .description('List my organizations')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      handleOutput(await client.listOrganizations(), options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

const workspaceCmd = new Command('workspace').description('Workspace operations');

workspaceCmd
  .command('get <workspaceId>')
  .description('Get a workspace by ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, options) => {
    try {
      const client = getClient();
      handleOutput(await client.getWorkspace(parseWorkspaceId(workspaceId)), options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

workspaceCmd
  .command('users <workspaceId>')
  .description('List workspace users')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, options) => {
    try {
      const client = getClient();
      handleOutput(await client.listWorkspaceUsers(parseWorkspaceId(workspaceId)), options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

const projectCmd = new Command('project').description('Manage projects');

projectCmd
  .command('list <workspaceId>')
  .description('List workspace projects')
  .option('--active <value>', 'Filter by active (true, false, both)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.listProjects(parseWorkspaceId(workspaceId), {
          active: options.active as 'true' | 'false' | 'both' | undefined,
        }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('get <workspaceId> <projectId>')
  .description('Get a project')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, projectId: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.getProject(parseWorkspaceId(workspaceId), parseProjectId(projectId)),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('create <workspaceId> <name>')
  .description('Create a project')
  .option('--client-id <id>', 'Client ID', parseInt)
  .option('--billable', 'Mark as billable')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, name: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.createProject(parseWorkspaceId(workspaceId), {
          name,
          client_id: options.clientId,
          billable: options.billable,
        }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('update <workspaceId> <projectId>')
  .description('Update a project')
  .option('-n, --name <name>', 'Project name')
  .option('--active <value>', 'Active status (true/false)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, projectId: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.updateProject(parseWorkspaceId(workspaceId), parseProjectId(projectId), {
          name: options.name,
          active: options.active === undefined ? undefined : options.active === 'true',
        }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('delete <workspaceId> <projectId>')
  .description('Delete a project')
  .action(async (workspaceId: string, projectId: string) => {
    try {
      const client = getClient();
      await client.deleteProject(parseWorkspaceId(workspaceId), parseProjectId(projectId));
      console.log(chalk.green('Project deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

const clientCmd = new Command('client').description('Manage clients');

clientCmd
  .command('list <workspaceId>')
  .description('List workspace clients')
  .option('--status <status>', 'Filter by status (active, archived, both)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.listClients(parseWorkspaceId(workspaceId), { status: options.status }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

clientCmd
  .command('create <workspaceId> <name>')
  .description('Create a client')
  .option('--notes <notes>', 'Client notes')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, name: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.createClient(parseWorkspaceId(workspaceId), { name, notes: options.notes }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

clientCmd
  .command('update <workspaceId> <clientId>')
  .description('Update a client')
  .option('-n, --name <name>', 'Client name')
  .option('--notes <notes>', 'Client notes')
  .option('--archived', 'Archive client')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, clientId: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.updateClient(parseWorkspaceId(workspaceId), parseClientId(clientId), {
          name: options.name,
          notes: options.notes,
          archived: options.archived,
        }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

clientCmd
  .command('delete <workspaceId> <clientId>')
  .description('Delete a client')
  .action(async (workspaceId: string, clientId: string) => {
    try {
      const client = getClient();
      await client.deleteClient(parseWorkspaceId(workspaceId), parseClientId(clientId));
      console.log(chalk.green('Client deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

const tagCmd = new Command('tag').description('Manage tags');

tagCmd
  .command('list <workspaceId>')
  .description('List workspace tags')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, options) => {
    try {
      const client = getClient();
      handleOutput(await client.listTags(parseWorkspaceId(workspaceId)), options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

tagCmd
  .command('create <workspaceId> <name>')
  .description('Create a tag')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, name: string, options) => {
    try {
      const client = getClient();
      handleOutput(await client.createTag(parseWorkspaceId(workspaceId), name), options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

tagCmd
  .command('delete <workspaceId> <tagId>')
  .description('Delete a tag')
  .action(async (workspaceId: string, tagId: string) => {
    try {
      const client = getClient();
      await client.deleteTag(parseWorkspaceId(workspaceId), parseTagId(tagId));
      console.log(chalk.green('Tag deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

const taskCmd = new Command('task').description('Manage tasks');

taskCmd
  .command('list <workspaceId>')
  .description('List workspace tasks')
  .option('-p, --project <projectId>', 'Filter by project ID', parseInt)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.listTasks(parseWorkspaceId(workspaceId), { projectId: options.project }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

taskCmd
  .command('create <workspaceId> <projectId> <name>')
  .description('Create a task')
  .option('--estimated-seconds <seconds>', 'Estimated duration in seconds', parseInt)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, projectId: string, name: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.createTask(parseWorkspaceId(workspaceId), parseProjectId(projectId), {
          name,
          estimated_seconds: options.estimatedSeconds,
        }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

const timeEntryCmd = new Command('time-entry').description('Manage time entries');

timeEntryCmd
  .command('list')
  .description('List my time entries')
  .option('--start-date <date>', 'Start date filter (YYYY-MM-DD)')
  .option('--end-date <date>', 'End date filter (YYYY-MM-DD)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.listTimeEntries({
          startDate: options.startDate,
          endDate: options.endDate,
        }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

timeEntryCmd
  .command('current')
  .description('Get current running time entry')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      handleOutput(await client.getCurrentTimeEntry(), options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

timeEntryCmd
  .command('get <workspaceId> <timeEntryId>')
  .description('Get a time entry')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, timeEntryId: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.getTimeEntry(parseWorkspaceId(workspaceId), parseTimeEntryId(timeEntryId)),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

timeEntryCmd
  .command('create <workspaceId>')
  .description('Create a time entry')
  .requiredOption('--start <datetime>', 'Start datetime (ISO 8601)')
  .option('--description <text>', 'Entry description')
  .option('--project-id <id>', 'Project ID', parseInt)
  .option('--task-id <id>', 'Task ID', parseInt)
  .option('--billable', 'Mark as billable')
  .option('--stop <datetime>', 'Stop datetime (ISO 8601)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.createTimeEntry(parseWorkspaceId(workspaceId), {
          start: options.start,
          stop: options.stop,
          description: options.description,
          project_id: options.projectId,
          task_id: options.taskId,
          billable: options.billable,
          created_with: 'connect-toggl',
        }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

timeEntryCmd
  .command('update <workspaceId> <timeEntryId>')
  .description('Update a time entry')
  .option('--description <text>', 'Entry description')
  .option('--project-id <id>', 'Project ID', parseInt)
  .option('--billable', 'Mark as billable')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, timeEntryId: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.updateTimeEntry(parseWorkspaceId(workspaceId), parseTimeEntryId(timeEntryId), {
          description: options.description,
          project_id: options.projectId,
          billable: options.billable,
        }),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

timeEntryCmd
  .command('stop <workspaceId> <timeEntryId>')
  .description('Stop a running time entry')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (workspaceId: string, timeEntryId: string, options) => {
    try {
      const client = getClient();
      handleOutput(
        await client.stopTimeEntry(parseWorkspaceId(workspaceId), parseTimeEntryId(timeEntryId)),
        options.format
      );
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

timeEntryCmd
  .command('delete <workspaceId> <timeEntryId>')
  .description('Delete a time entry')
  .action(async (workspaceId: string, timeEntryId: string) => {
    try {
      const client = getClient();
      await client.deleteTimeEntry(parseWorkspaceId(workspaceId), parseTimeEntryId(timeEntryId));
      console.log(chalk.green('Time entry deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program
  .name('connect-toggl')
  .description('Toggl Track connector - Time tracking, workspaces, projects, and time entries')
  .version('0.1.0')
  .option('--profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

program.addCommand(profileCmd);
program.addCommand(configCmd);
program.addCommand(meCmd);
program.addCommand(workspaceCmd);
program.addCommand(projectCmd);
program.addCommand(clientCmd);
program.addCommand(tagCmd);
program.addCommand(taskCmd);
program.addCommand(timeEntryCmd);

program.parse();
