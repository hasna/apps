#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TickTick } from '../api';
import type { TickTickConfig, OutputFormat } from '../types';
import {
  getAccessToken,
  setAccessToken,
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

const program = new Command();

function getClient(): TickTick {
  const accessToken = getAccessToken();
  if (!accessToken) {
    console.error(chalk.red('Error: Access token not configured.'));
    console.error(chalk.yellow('Run: connect-ticktick config set-token <access-token>'));
    console.error(chalk.yellow('Or set TICKTICK_ACCESS_TOKEN environment variable'));
    process.exit(1);
  }

  const config: TickTickConfig = { accessToken };
  return new TickTick(config);
}

function formatOutput(data: unknown, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

function formatPriority(priority?: number): string {
  const labels: Record<number, string> = { 0: '', 1: 'P3', 3: 'P2', 5: 'P1' };
  const colors: Record<number, (s: string) => string> = {
    0: chalk.gray,
    1: chalk.blue,
    3: chalk.yellow,
    5: chalk.red,
  };
  const p = priority ?? 0;
  const label = labels[p] || '';
  return label ? (colors[p]?.(`[${label}]`) || label) : '';
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
      console.log(chalk.gray('Create one with: connect-ticktick profile create <name>'));
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
    console.log(chalk.gray('Access Token:'), profile.accessToken ? '***configured***' : 'not set');
  });

const configCmd = new Command('config').description('Manage configuration');

configCmd
  .command('set-token <accessToken>')
  .description('Set the OAuth2 access token for current profile')
  .action((accessToken: string) => {
    setAccessToken(accessToken);
    const profile = getActiveProfileName();
    console.log(chalk.green(`Access token saved to profile: ${profile}`));
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const accessToken = getAccessToken();
    const configDir = getConfigDir();

    console.log(chalk.bold('Current Configuration:'));
    console.log(chalk.gray('Profile:'), profile);
    console.log(chalk.gray('Config directory:'), configDir);
    console.log(chalk.gray('Access Token:'), accessToken ? '***configured***' : 'not set');
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

const projectCmd = new Command('project').description('Manage projects');

projectCmd
  .command('list')
  .description('List all projects')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      const projects = await client.listProjects();

      if (options.format === 'json') {
        formatOutput(projects, 'json');
      } else {
        if (projects.length === 0) {
          console.log(chalk.yellow('No projects found.'));
          return;
        }
        console.log(chalk.bold(`Projects (${projects.length}):\n`));
        for (const project of projects) {
          const closed = project.closed ? chalk.gray(' (closed)') : '';
          console.log(`${chalk.cyan(project.name)}${closed}`);
          console.log(chalk.gray(`  ID: ${project.id}`));
          if (project.viewMode) {
            console.log(chalk.gray(`  View: ${project.viewMode}`));
          }
          console.log();
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('get <projectId>')
  .description('Get a project by ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (projectId: string, options) => {
    try {
      const client = getClient();
      const project = await client.getProject(projectId);

      if (options.format === 'json') {
        formatOutput(project, 'json');
      } else {
        console.log(chalk.bold(project.name));
        console.log(chalk.gray('ID:'), project.id);
        if (project.color) console.log(chalk.gray('Color:'), project.color);
        if (project.viewMode) console.log(chalk.gray('View:'), project.viewMode);
        if (project.kind) console.log(chalk.gray('Kind:'), project.kind);
        console.log(chalk.gray('Closed:'), project.closed ? 'Yes' : 'No');
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('data <projectId>')
  .description('Get a project with tasks and columns')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (projectId: string, options) => {
    try {
      const client = getClient();
      const data = await client.getProjectWithData(projectId);
      formatOutput(data, options.format === 'json' ? 'json' : 'json');
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('create <name>')
  .description('Create a new project')
  .option('-c, --color <color>', 'Project color (hex)')
  .option('-v, --view <viewMode>', 'View mode (list, kanban, timeline)')
  .option('--kind <kind>', 'Project kind (TASK, NOTE)')
  .option('--group <groupId>', 'Group ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (name: string, options) => {
    try {
      const client = getClient();
      const project = await client.createProject({
        name,
        color: options.color,
        viewMode: options.view,
        kind: options.kind,
        groupId: options.group,
      });

      if (options.format === 'json') {
        formatOutput(project, 'json');
      } else {
        console.log(chalk.green(`Created project: ${project.name}`));
        console.log(chalk.gray('ID:'), project.id);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('update <projectId>')
  .description('Update a project')
  .option('-n, --name <name>', 'New name')
  .option('-c, --color <color>', 'New color')
  .option('-v, --view <viewMode>', 'View mode (list, kanban, timeline)')
  .option('--kind <kind>', 'Project kind (TASK, NOTE)')
  .option('--group <groupId>', 'Group ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (projectId: string, options) => {
    try {
      const client = getClient();
      const project = await client.updateProject(projectId, {
        name: options.name,
        color: options.color,
        viewMode: options.view,
        kind: options.kind,
        groupId: options.group,
      });

      if (options.format === 'json') {
        formatOutput(project, 'json');
      } else {
        console.log(chalk.green(`Updated project: ${project.name}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('delete <projectId>')
  .description('Delete a project')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      await client.deleteProject(projectId);
      console.log(chalk.green('Project deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

const taskCmd = new Command('task').description('Manage tasks');

taskCmd
  .command('get <projectId> <taskId>')
  .description('Get a task by project and task ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (projectId: string, taskId: string, options) => {
    try {
      const client = getClient();
      const task = await client.getTask(projectId, taskId);

      if (options.format === 'json') {
        formatOutput(task, 'json');
      } else {
        const priority = formatPriority(typeof task.priority === 'number' ? task.priority : 0);
        console.log(`${priority} ${chalk.bold(task.title)}`);
        console.log(chalk.gray('ID:'), task.id);
        console.log(chalk.gray('Project:'), task.projectId);
        if (task.content) console.log(chalk.gray('Content:'), task.content);
        if (task.dueDate) console.log(chalk.gray('Due:'), task.dueDate);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

taskCmd
  .command('create <title>')
  .description('Create a new task')
  .option('-p, --project <projectId>', 'Project ID')
  .option('-c, --content <content>', 'Task content')
  .option('-d, --desc <desc>', 'Task description')
  .option('--priority <priority>', 'Priority (0=none, 1=low, 3=medium, 5=high)', parseInt)
  .option('--due <dueDate>', 'Due date (yyyy-MM-ddTHH:mm:ssZ)')
  .option('--start <startDate>', 'Start date (yyyy-MM-ddTHH:mm:ssZ)')
  .option('--all-day', 'All-day task')
  .option('--timezone <timeZone>', 'Timezone (e.g. America/Los_Angeles)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (title: string, options) => {
    try {
      const client = getClient();
      const task = await client.createTask({
        title,
        projectId: options.project,
        content: options.content,
        desc: options.desc,
        priority: options.priority,
        dueDate: options.due,
        startDate: options.start,
        isAllDay: options.allDay,
        timeZone: options.timezone,
      });

      if (options.format === 'json') {
        formatOutput(task, 'json');
      } else {
        console.log(chalk.green(`Created task: ${task.title}`));
        console.log(chalk.gray('ID:'), task.id);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

taskCmd
  .command('update <taskId>')
  .description('Update a task')
  .option('-p, --project <projectId>', 'Project ID')
  .option('-t, --title <title>', 'New title')
  .option('-c, --content <content>', 'Task content')
  .option('-d, --desc <desc>', 'Task description')
  .option('--priority <priority>', 'Priority (0, 1, 3, 5)', parseInt)
  .option('--due <dueDate>', 'Due date')
  .option('--start <startDate>', 'Start date')
  .option('--all-day', 'All-day task')
  .option('--timezone <timeZone>', 'Timezone')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (taskId: string, options) => {
    try {
      const client = getClient();
      const task = await client.updateTask(taskId, {
        projectId: options.project,
        title: options.title,
        content: options.content,
        desc: options.desc,
        priority: options.priority,
        dueDate: options.due,
        startDate: options.start,
        isAllDay: options.allDay,
        timeZone: options.timezone,
      });

      if (options.format === 'json') {
        formatOutput(task, 'json');
      } else {
        console.log(chalk.green(`Updated task: ${task.title}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

taskCmd
  .command('complete <projectId> <taskId>')
  .description('Mark a task as complete')
  .action(async (projectId: string, taskId: string) => {
    try {
      const client = getClient();
      await client.completeTask(projectId, taskId);
      console.log(chalk.green('Task completed.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

taskCmd
  .command('delete <projectId> <taskId>')
  .description('Delete a task')
  .action(async (projectId: string, taskId: string) => {
    try {
      const client = getClient();
      await client.deleteTask(projectId, taskId);
      console.log(chalk.green('Task deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program
  .name('connect-ticktick')
  .description('TickTick connector - Projects and tasks via the TickTick Open API')
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
program.addCommand(projectCmd);
program.addCommand(taskCmd);

program.parse();
