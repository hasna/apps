#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Asana } from '../api';
import {
  getAccessToken,
  setAccessToken,
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
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-asana';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Asana connector - Projects, tasks, workspaces, and teams management')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
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
      process.env.ASANA_ACCESS_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Asana {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ASANA_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  return new Asana({ accessToken });
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
  .option('--token <token>', 'Access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Workspace Commands
// ============================================
const workspaceCmd = program
  .command('workspace')
  .description('Workspace management');

workspaceCmd
  .command('list')
  .description('List all workspaces')
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

workspaceCmd
  .command('get <gid>')
  .description('Get a workspace by GID')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      const result = await client.getWorkspace(gid);
      print(result, getFormat(workspaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .description('User management');

userCmd
  .command('me')
  .description('Get current user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getMe();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('get <gid>')
  .description('Get a user by GID')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      const result = await client.getUser(gid);
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('list')
  .description('List users in a workspace')
  .requiredOption('--workspace <gid>', 'Workspace GID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listUsersInWorkspace(opts.workspace);
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Team Commands
// ============================================
const teamCmd = program
  .command('team')
  .description('Team management');

teamCmd
  .command('list')
  .description('List teams in a workspace/organization')
  .requiredOption('--workspace <gid>', 'Workspace/Organization GID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTeamsInWorkspace(opts.workspace);
      print(result, getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('get <gid>')
  .description('Get a team by GID')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      const result = await client.getTeam(gid);
      print(result, getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Project Commands
// ============================================
const projectCmd = program
  .command('project')
  .description('Project management');

projectCmd
  .command('list')
  .description('List projects')
  .option('--workspace <gid>', 'Filter by workspace GID')
  .option('--team <gid>', 'Filter by team GID')
  .option('--archived', 'Include archived projects')
  .option('--limit <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listProjects({
        workspace: opts.workspace,
        team: opts.team,
        archived: opts.archived,
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('get <gid>')
  .description('Get a project by GID')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      const result = await client.getProject(gid);
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('create')
  .description('Create a new project')
  .requiredOption('--name <name>', 'Project name')
  .option('--workspace <gid>', 'Workspace GID')
  .option('--team <gid>', 'Team GID')
  .option('--notes <notes>', 'Project notes')
  .option('--color <color>', 'Project color')
  .option('--public', 'Make project public')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createProject({
        name: opts.name,
        workspace: opts.workspace,
        team: opts.team,
        notes: opts.notes,
        color: opts.color,
        public: opts.public,
      });
      success('Project created!');
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('delete <gid>')
  .description('Delete a project')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      await client.deleteProject(gid);
      success(`Project ${gid} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Section Commands
// ============================================
const sectionCmd = program
  .command('section')
  .description('Section management');

sectionCmd
  .command('list')
  .description('List sections in a project')
  .requiredOption('--project <gid>', 'Project GID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSections(opts.project);
      print(result, getFormat(sectionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sectionCmd
  .command('get <gid>')
  .description('Get a section by GID')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      const result = await client.getSection(gid);
      print(result, getFormat(sectionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sectionCmd
  .command('create')
  .description('Create a new section')
  .requiredOption('--project <gid>', 'Project GID')
  .requiredOption('--name <name>', 'Section name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createSection(opts.project, { name: opts.name });
      success('Section created!');
      print(result, getFormat(sectionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sectionCmd
  .command('delete <gid>')
  .description('Delete a section')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      await client.deleteSection(gid);
      success(`Section ${gid} deleted`);
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
  .description('Task management');

taskCmd
  .command('list')
  .description('List tasks')
  .option('--project <gid>', 'Filter by project GID')
  .option('--section <gid>', 'Filter by section GID')
  .option('--assignee <gid>', 'Filter by assignee GID (requires --workspace)')
  .option('--workspace <gid>', 'Workspace GID (required with --assignee)')
  .option('--limit <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTasks({
        project: opts.project,
        section: opts.section,
        assignee: opts.assignee,
        workspace: opts.workspace,
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('get <gid>')
  .description('Get a task by GID')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      const result = await client.getTask(gid);
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('create')
  .description('Create a new task')
  .requiredOption('--name <name>', 'Task name')
  .option('--workspace <gid>', 'Workspace GID')
  .option('--projects <gids>', 'Project GIDs (comma-separated)')
  .option('--assignee <gid>', 'Assignee GID')
  .option('--notes <notes>', 'Task notes')
  .option('--due-on <date>', 'Due date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createTask({
        name: opts.name,
        workspace: opts.workspace,
        projects: opts.projects?.split(','),
        assignee: opts.assignee,
        notes: opts.notes,
        due_on: opts.dueOn,
      });
      success('Task created!');
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('update <gid>')
  .description('Update a task')
  .option('--name <name>', 'Task name')
  .option('--assignee <gid>', 'Assignee GID')
  .option('--notes <notes>', 'Task notes')
  .option('--due-on <date>', 'Due date (YYYY-MM-DD)')
  .option('--completed', 'Mark as completed')
  .action(async (gid: string, opts) => {
    try {
      const client = getClient();
      const result = await client.updateTask(gid, {
        name: opts.name,
        assignee: opts.assignee,
        notes: opts.notes,
        due_on: opts.dueOn,
        completed: opts.completed,
      });
      success('Task updated!');
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('delete <gid>')
  .description('Delete a task')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      await client.deleteTask(gid);
      success(`Task ${gid} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('subtasks <gid>')
  .description('List subtasks of a task')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      const result = await client.getSubtasks(gid);
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Tag Commands
// ============================================
const tagCmd = program
  .command('tag')
  .description('Tag management');

tagCmd
  .command('list')
  .description('List tags in a workspace')
  .requiredOption('--workspace <gid>', 'Workspace GID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTags(opts.workspace);
      print(result, getFormat(tagCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagCmd
  .command('get <gid>')
  .description('Get a tag by GID')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      const result = await client.getTag(gid);
      print(result, getFormat(tagCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagCmd
  .command('create')
  .description('Create a new tag')
  .requiredOption('--name <name>', 'Tag name')
  .requiredOption('--workspace <gid>', 'Workspace GID')
  .option('--color <color>', 'Tag color')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createTag({
        name: opts.name,
        workspace: opts.workspace,
        color: opts.color,
      });
      success('Tag created!');
      print(result, getFormat(tagCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Story (Comment) Commands
// ============================================
const storyCmd = program
  .command('story')
  .alias('comment')
  .description('Story/Comment management');

storyCmd
  .command('list')
  .description('List stories/comments on a task')
  .requiredOption('--task <gid>', 'Task GID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listStories(opts.task);
      print(result, getFormat(storyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

storyCmd
  .command('create')
  .description('Add a comment to a task')
  .requiredOption('--task <gid>', 'Task GID')
  .requiredOption('--text <text>', 'Comment text')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createStory(opts.task, { text: opts.text });
      success('Comment added!');
      print(result, getFormat(storyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

storyCmd
  .command('delete <gid>')
  .description('Delete a story/comment')
  .action(async (gid: string) => {
    try {
      const client = getClient();
      await client.deleteStory(gid);
      success(`Story ${gid} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Search Commands
// ============================================
const searchCmd = program
  .command('search')
  .description('Search tasks');

searchCmd
  .command('tasks')
  .description('Search tasks in a workspace')
  .requiredOption('--workspace <gid>', 'Workspace GID')
  .option('--text <text>', 'Search text')
  .option('--projects <gids>', 'Filter by project GIDs (comma-separated)')
  .option('--assignee <gid>', 'Filter by assignee GID')
  .option('--completed', 'Include completed tasks')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.searchTasks(opts.workspace, {
        text: opts.text,
        'projects.any': opts.projects,
        'assignee.any': opts.assignee,
        completed: opts.completed,
      });
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
