#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ClickUp } from '../api';
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

const CONNECTOR_NAME = 'connect-clickup';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('ClickUp connector CLI - Workspaces, spaces, folders, lists, and tasks management')
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
      process.env.CLICKUP_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ClickUp {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set CLICKUP_API_KEY environment variable.`);
    process.exit(1);
  }
  return new ClickUp({ apiKey });
}

// ============================================
// Profile Commands
// ============================================
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

    success(`Profiles:`);
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

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
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .description('User operations');

userCmd
  .command('me')
  .description('Get current authenticated user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getAuthorizedUser();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Workspace Commands
// ============================================
const workspaceCmd = program
  .command('workspace')
  .description('Workspace (team) operations');

workspaceCmd
  .command('list')
  .description('List workspaces')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listWorkspaces();
      print(result, getFormat(workspaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Space Commands
// ============================================
const spaceCmd = program
  .command('space')
  .description('Space operations');

spaceCmd
  .command('list <teamId>')
  .description('List spaces in a workspace')
  .option('--archived', 'Include archived spaces')
  .action(async (teamId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listSpaces(teamId, { archived: opts.archived });
      print(result, getFormat(spaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

spaceCmd
  .command('get <spaceId>')
  .description('Get a space by ID')
  .action(async (spaceId: string) => {
    try {
      const client = getClient();
      const result = await client.getSpace(spaceId);
      print(result, getFormat(spaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

spaceCmd
  .command('create')
  .description('Create a new space')
  .requiredOption('-t, --team <id>', 'Team/workspace ID')
  .requiredOption('-n, --name <name>', 'Space name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createSpace(opts.team, { name: opts.name });
      success('Space created!');
      print(result, getFormat(spaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

spaceCmd
  .command('delete <spaceId>')
  .description('Delete a space')
  .action(async (spaceId: string) => {
    try {
      const client = getClient();
      await client.deleteSpace(spaceId);
      success(`Space ${spaceId} deleted!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Folder Commands
// ============================================
const folderCmd = program
  .command('folder')
  .description('Folder operations');

folderCmd
  .command('list <spaceId>')
  .description('List folders in a space')
  .option('--archived', 'Include archived folders')
  .action(async (spaceId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listFolders(spaceId, { archived: opts.archived });
      print(result, getFormat(folderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

folderCmd
  .command('get <folderId>')
  .description('Get a folder by ID')
  .action(async (folderId: string) => {
    try {
      const client = getClient();
      const result = await client.getFolder(folderId);
      print(result, getFormat(folderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

folderCmd
  .command('create')
  .description('Create a new folder')
  .requiredOption('-s, --space <id>', 'Space ID')
  .requiredOption('-n, --name <name>', 'Folder name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createFolder(opts.space, { name: opts.name });
      success('Folder created!');
      print(result, getFormat(folderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

folderCmd
  .command('delete <folderId>')
  .description('Delete a folder')
  .action(async (folderId: string) => {
    try {
      const client = getClient();
      await client.deleteFolder(folderId);
      success(`Folder ${folderId} deleted!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// List Commands
// ============================================
const listCmd = program
  .command('list')
  .description('List operations');

listCmd
  .command('show <folderId>')
  .description('List lists in a folder')
  .option('--archived', 'Include archived lists')
  .action(async (folderId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listLists(folderId, { archived: opts.archived });
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('get <listId>')
  .description('Get a list by ID')
  .action(async (listId: string) => {
    try {
      const client = getClient();
      const result = await client.getList(listId);
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('create')
  .description('Create a new list')
  .requiredOption('-o, --folder <id>', 'Folder ID')
  .requiredOption('-n, --name <name>', 'List name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createList(opts.folder, { name: opts.name });
      success('List created!');
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('delete <listId>')
  .description('Delete a list')
  .action(async (listId: string) => {
    try {
      const client = getClient();
      await client.deleteList(listId);
      success(`List ${listId} deleted!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Task Commands
// ============================================
const taskCmd = program
  .command('task')
  .description('Task operations');

taskCmd
  .command('show <listId>')
  .description('List tasks in a list')
  .option('--archived', 'Include archived tasks')
  .option('--subtasks', 'Include subtasks')
  .option('--include-closed', 'Include closed tasks')
  .option('-p, --page <number>', 'Page number')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listTasks(listId, {
        archived: opts.archived,
        subtasks: opts.subtasks,
        include_closed: opts.includeClosed,
        page: opts.page ? parseInt(opts.page) : undefined,
      });
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('get <taskId>')
  .description('Get a task by ID')
  .option('--include-subtasks', 'Include subtasks')
  .action(async (taskId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getTask(taskId, { include_subtasks: opts.includeSubtasks });
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('create')
  .description('Create a new task')
  .requiredOption('-l, --list <id>', 'List ID')
  .requiredOption('-n, --name <name>', 'Task name')
  .option('-d, --description <text>', 'Task description')
  .option('--priority <number>', 'Priority (1=urgent, 2=high, 3=normal, 4=low)')
  .option('--status <status>', 'Task status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createTask(opts.list, {
        name: opts.name,
        description: opts.description,
        priority: opts.priority ? parseInt(opts.priority) : undefined,
        status: opts.status,
      });
      success('Task created!');
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('update <taskId>')
  .description('Update a task')
  .option('-n, --name <name>', 'Task name')
  .option('-d, --description <text>', 'Task description')
  .option('--priority <number>', 'Priority')
  .option('--status <status>', 'Task status')
  .action(async (taskId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.updateTask(taskId, {
        name: opts.name,
        description: opts.description,
        priority: opts.priority ? parseInt(opts.priority) : undefined,
        status: opts.status,
      });
      success('Task updated!');
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('delete <taskId>')
  .description('Delete a task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      await client.deleteTask(taskId);
      success(`Task ${taskId} deleted!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Comment Commands
// ============================================
const commentCmd = program
  .command('comment')
  .description('Comment operations');

commentCmd
  .command('list <taskId>')
  .description('List comments on a task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.listTaskComments(taskId);
      print(result, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd
  .command('create')
  .description('Create a comment on a task')
  .requiredOption('-t, --task <id>', 'Task ID')
  .requiredOption('-c, --comment <text>', 'Comment text')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createTaskComment(opts.task, { comment_text: opts.comment });
      success('Comment created!');
      print(result, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd
  .command('delete <commentId>')
  .description('Delete a comment')
  .action(async (commentId: string) => {
    try {
      const client = getClient();
      await client.deleteComment(commentId);
      success(`Comment ${commentId} deleted!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Goal Commands
// ============================================
const goalCmd = program
  .command('goal')
  .description('Goal operations');

goalCmd
  .command('list <teamId>')
  .description('List goals in a workspace')
  .option('--include-completed', 'Include completed goals')
  .action(async (teamId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listGoals(teamId, { include_completed: opts.includeCompleted });
      print(result, getFormat(goalCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

goalCmd
  .command('get <goalId>')
  .description('Get a goal by ID')
  .action(async (goalId: string) => {
    try {
      const client = getClient();
      const result = await client.getGoal(goalId);
      print(result, getFormat(goalCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
