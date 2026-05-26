#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Todoist } from '../api';
import type { TodoistConfig, OutputFormat } from '../types';
import {
  getApiKey,
  setApiKey,
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

function getClient(): Todoist {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(chalk.red('Error: API key not configured.'));
    console.error(chalk.yellow('Run: connect-todoist config set-key <api-key>'));
    console.error(chalk.yellow('Or set TODOIST_API_KEY environment variable'));
    process.exit(1);
  }

  const config: TodoistConfig = { apiKey };
  return new Todoist(config);
}

function formatOutput(data: unknown, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

function formatPriority(priority: number): string {
  const labels = ['', 'P4', 'P3', 'P2', 'P1'];
  const colors = [chalk.gray, chalk.gray, chalk.blue, chalk.yellow, chalk.red];
  return colors[priority]?.(labels[priority] || '') || '';
}

// ============================================
// Profile Commands
// ============================================

const profileCmd = new Command('profile')
  .description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles configured.'));
      console.log(chalk.gray('Create one with: connect-todoist profile create <name>'));
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
    const current = getCurrentProfile();
    console.log(current);
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
    console.log(chalk.gray('API Key:'), profile.apiKey ? '***configured***' : 'not set');
  });

// ============================================
// Config Commands
// ============================================

const configCmd = new Command('config')
  .description('Manage configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set the API key for current profile')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    const profile = getActiveProfileName();
    console.log(chalk.green(`API key saved to profile: ${profile}`));
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const apiKey = getApiKey();
    const configDir = getConfigDir();

    console.log(chalk.bold('Current Configuration:'));
    console.log(chalk.gray('Profile:'), profile);
    console.log(chalk.gray('Config directory:'), configDir);
    console.log(chalk.gray('API Key:'), apiKey ? '***configured***' : 'not set');
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

// ============================================
// Project Commands
// ============================================

const projectCmd = new Command('project')
  .description('Manage projects');

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
          const favorite = project.is_favorite ? chalk.yellow('* ') : '';
          const shared = project.is_shared ? chalk.blue(' [shared]') : '';
          const inbox = project.is_inbox_project ? chalk.gray(' (inbox)') : '';
          console.log(`${favorite}${chalk.cyan(project.name)}${shared}${inbox}`);
          console.log(chalk.gray(`  ID: ${project.id}`));
          if (project.parent_id) {
            console.log(chalk.gray(`  Parent: ${project.parent_id}`));
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
        console.log(chalk.gray('Color:'), project.color);
        console.log(chalk.gray('View:'), project.view_style);
        console.log(chalk.gray('Favorite:'), project.is_favorite ? 'Yes' : 'No');
        console.log(chalk.gray('Shared:'), project.is_shared ? 'Yes' : 'No');
        console.log(chalk.gray('Comments:'), project.comment_count);
        console.log(chalk.gray('URL:'), project.url);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('create <name>')
  .description('Create a new project')
  .option('-p, --parent <parentId>', 'Parent project ID')
  .option('-c, --color <color>', 'Project color')
  .option('--favorite', 'Mark as favorite')
  .option('-v, --view <view>', 'View style (list, board)', 'list')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (name: string, options) => {
    try {
      const client = getClient();
      const project = await client.createProject({
        name,
        parent_id: options.parent,
        color: options.color,
        is_favorite: options.favorite,
        view_style: options.view,
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
  .option('--favorite', 'Mark as favorite')
  .option('--no-favorite', 'Remove from favorites')
  .option('-v, --view <view>', 'View style (list, board)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (projectId: string, options) => {
    try {
      const client = getClient();
      const project = await client.updateProject(projectId, {
        name: options.name,
        color: options.color,
        is_favorite: options.favorite,
        view_style: options.view,
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

projectCmd
  .command('collaborators <projectId>')
  .description('List project collaborators')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (projectId: string, options) => {
    try {
      const client = getClient();
      const collaborators = await client.getCollaborators(projectId);

      if (options.format === 'json') {
        formatOutput(collaborators, 'json');
      } else {
        if (collaborators.length === 0) {
          console.log(chalk.yellow('No collaborators found.'));
          return;
        }
        console.log(chalk.bold(`Collaborators (${collaborators.length}):\n`));
        for (const collab of collaborators) {
          console.log(`${chalk.cyan(collab.name)} <${collab.email}>`);
          console.log(chalk.gray(`  ID: ${collab.id}`));
          console.log();
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================
// Section Commands
// ============================================

const sectionCmd = new Command('section')
  .description('Manage sections');

sectionCmd
  .command('list')
  .description('List sections')
  .option('-p, --project <projectId>', 'Filter by project ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      const sections = await client.listSections(options.project);

      if (options.format === 'json') {
        formatOutput(sections, 'json');
      } else {
        if (sections.length === 0) {
          console.log(chalk.yellow('No sections found.'));
          return;
        }
        console.log(chalk.bold(`Sections (${sections.length}):\n`));
        for (const section of sections) {
          console.log(chalk.cyan(section.name));
          console.log(chalk.gray(`  ID: ${section.id}`));
          console.log(chalk.gray(`  Project: ${section.project_id}`));
          console.log();
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

sectionCmd
  .command('get <sectionId>')
  .description('Get a section by ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (sectionId: string, options) => {
    try {
      const client = getClient();
      const section = await client.getSection(sectionId);

      if (options.format === 'json') {
        formatOutput(section, 'json');
      } else {
        console.log(chalk.bold(section.name));
        console.log(chalk.gray('ID:'), section.id);
        console.log(chalk.gray('Project:'), section.project_id);
        console.log(chalk.gray('Order:'), section.order);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

sectionCmd
  .command('create <name>')
  .description('Create a new section')
  .requiredOption('-p, --project <projectId>', 'Project ID')
  .option('-o, --order <order>', 'Section order', parseInt)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (name: string, options) => {
    try {
      const client = getClient();
      const section = await client.createSection({
        name,
        project_id: options.project,
        order: options.order,
      });

      if (options.format === 'json') {
        formatOutput(section, 'json');
      } else {
        console.log(chalk.green(`Created section: ${section.name}`));
        console.log(chalk.gray('ID:'), section.id);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

sectionCmd
  .command('update <sectionId>')
  .description('Update a section')
  .requiredOption('-n, --name <name>', 'New name')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (sectionId: string, options) => {
    try {
      const client = getClient();
      const section = await client.updateSection(sectionId, {
        name: options.name,
      });

      if (options.format === 'json') {
        formatOutput(section, 'json');
      } else {
        console.log(chalk.green(`Updated section: ${section.name}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

sectionCmd
  .command('delete <sectionId>')
  .description('Delete a section')
  .action(async (sectionId: string) => {
    try {
      const client = getClient();
      await client.deleteSection(sectionId);
      console.log(chalk.green('Section deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================
// Task Commands
// ============================================

const taskCmd = new Command('task')
  .description('Manage tasks');

taskCmd
  .command('list')
  .description('List tasks')
  .option('-p, --project <projectId>', 'Filter by project ID')
  .option('-s, --section <sectionId>', 'Filter by section ID')
  .option('-l, --label <label>', 'Filter by label')
  .option('--filter <filter>', 'Filter expression')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      const tasks = await client.listTasks({
        project_id: options.project,
        section_id: options.section,
        label: options.label,
        filter: options.filter,
      });

      if (options.format === 'json') {
        formatOutput(tasks, 'json');
      } else {
        if (tasks.length === 0) {
          console.log(chalk.yellow('No tasks found.'));
          return;
        }
        console.log(chalk.bold(`Tasks (${tasks.length}):\n`));
        for (const task of tasks) {
          const priority = formatPriority(task.priority);
          const due = task.due ? chalk.magenta(` [${task.due.string}]`) : '';
          const labels = task.labels.length > 0 ? chalk.blue(` @${task.labels.join(' @')}`) : '';
          console.log(`${priority} ${task.content}${due}${labels}`);
          console.log(chalk.gray(`  ID: ${task.id}`));
          if (task.description) {
            console.log(chalk.gray(`  ${task.description}`));
          }
          console.log();
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

taskCmd
  .command('get <taskId>')
  .description('Get a task by ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (taskId: string, options) => {
    try {
      const client = getClient();
      const task = await client.getTask(taskId);

      if (options.format === 'json') {
        formatOutput(task, 'json');
      } else {
        const priority = formatPriority(task.priority);
        console.log(`${priority} ${chalk.bold(task.content)}`);
        console.log(chalk.gray('ID:'), task.id);
        if (task.description) {
          console.log(chalk.gray('Description:'), task.description);
        }
        console.log(chalk.gray('Project:'), task.project_id);
        if (task.section_id) {
          console.log(chalk.gray('Section:'), task.section_id);
        }
        if (task.due) {
          console.log(chalk.gray('Due:'), task.due.string);
        }
        if (task.labels.length > 0) {
          console.log(chalk.gray('Labels:'), task.labels.join(', '));
        }
        console.log(chalk.gray('Comments:'), task.comment_count);
        console.log(chalk.gray('URL:'), task.url);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

taskCmd
  .command('create <content>')
  .description('Create a new task')
  .option('-d, --description <description>', 'Task description')
  .option('-p, --project <projectId>', 'Project ID')
  .option('-s, --section <sectionId>', 'Section ID')
  .option('--parent <parentId>', 'Parent task ID')
  .option('-l, --labels <labels>', 'Labels (comma-separated)')
  .option('--priority <priority>', 'Priority (1-4, 4 is highest)', parseInt)
  .option('--due <due>', 'Due date string (e.g., "tomorrow", "next monday")')
  .option('--due-date <date>', 'Due date (YYYY-MM-DD)')
  .option('--due-datetime <datetime>', 'Due datetime (RFC3339)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (content: string, options) => {
    try {
      const client = getClient();
      const task = await client.createTask({
        content,
        description: options.description,
        project_id: options.project,
        section_id: options.section,
        parent_id: options.parent,
        labels: options.labels?.split(',').map((l: string) => l.trim()),
        priority: options.priority,
        due_string: options.due,
        due_date: options.dueDate,
        due_datetime: options.dueDatetime,
      });

      if (options.format === 'json') {
        formatOutput(task, 'json');
      } else {
        console.log(chalk.green(`Created task: ${task.content}`));
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
  .option('-c, --content <content>', 'New content')
  .option('-d, --description <description>', 'New description')
  .option('-l, --labels <labels>', 'Labels (comma-separated)')
  .option('--priority <priority>', 'Priority (1-4)', parseInt)
  .option('--due <due>', 'Due date string')
  .option('--due-date <date>', 'Due date (YYYY-MM-DD)')
  .option('--due-datetime <datetime>', 'Due datetime (RFC3339)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (taskId: string, options) => {
    try {
      const client = getClient();
      const task = await client.updateTask(taskId, {
        content: options.content,
        description: options.description,
        labels: options.labels?.split(',').map((l: string) => l.trim()),
        priority: options.priority,
        due_string: options.due,
        due_date: options.dueDate,
        due_datetime: options.dueDatetime,
      });

      if (options.format === 'json') {
        formatOutput(task, 'json');
      } else {
        console.log(chalk.green(`Updated task: ${task.content}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

taskCmd
  .command('close <taskId>')
  .description('Complete a task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      await client.closeTask(taskId);
      console.log(chalk.green('Task completed.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

taskCmd
  .command('reopen <taskId>')
  .description('Reopen a completed task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      await client.reopenTask(taskId);
      console.log(chalk.green('Task reopened.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
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
      console.log(chalk.green('Task deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================
// Label Commands
// ============================================

const labelCmd = new Command('label')
  .description('Manage labels');

labelCmd
  .command('list')
  .description('List all labels')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      const client = getClient();
      const labels = await client.listLabels();

      if (options.format === 'json') {
        formatOutput(labels, 'json');
      } else {
        if (labels.length === 0) {
          console.log(chalk.yellow('No labels found.'));
          return;
        }
        console.log(chalk.bold(`Labels (${labels.length}):\n`));
        for (const label of labels) {
          const favorite = label.is_favorite ? chalk.yellow('* ') : '';
          console.log(`${favorite}${chalk.blue(`@${label.name}`)}`);
          console.log(chalk.gray(`  ID: ${label.id}`));
          console.log(chalk.gray(`  Color: ${label.color}`));
          console.log();
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

labelCmd
  .command('get <labelId>')
  .description('Get a label by ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (labelId: string, options) => {
    try {
      const client = getClient();
      const label = await client.getLabel(labelId);

      if (options.format === 'json') {
        formatOutput(label, 'json');
      } else {
        console.log(chalk.bold(`@${label.name}`));
        console.log(chalk.gray('ID:'), label.id);
        console.log(chalk.gray('Color:'), label.color);
        console.log(chalk.gray('Favorite:'), label.is_favorite ? 'Yes' : 'No');
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

labelCmd
  .command('create <name>')
  .description('Create a new label')
  .option('-c, --color <color>', 'Label color')
  .option('--favorite', 'Mark as favorite')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (name: string, options) => {
    try {
      const client = getClient();
      const label = await client.createLabel({
        name,
        color: options.color,
        is_favorite: options.favorite,
      });

      if (options.format === 'json') {
        formatOutput(label, 'json');
      } else {
        console.log(chalk.green(`Created label: @${label.name}`));
        console.log(chalk.gray('ID:'), label.id);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

labelCmd
  .command('update <labelId>')
  .description('Update a label')
  .option('-n, --name <name>', 'New name')
  .option('-c, --color <color>', 'New color')
  .option('--favorite', 'Mark as favorite')
  .option('--no-favorite', 'Remove from favorites')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (labelId: string, options) => {
    try {
      const client = getClient();
      const label = await client.updateLabel(labelId, {
        name: options.name,
        color: options.color,
        is_favorite: options.favorite,
      });

      if (options.format === 'json') {
        formatOutput(label, 'json');
      } else {
        console.log(chalk.green(`Updated label: @${label.name}`));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

labelCmd
  .command('delete <labelId>')
  .description('Delete a label')
  .action(async (labelId: string) => {
    try {
      const client = getClient();
      await client.deleteLabel(labelId);
      console.log(chalk.green('Label deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================
// Comment Commands
// ============================================

const commentCmd = new Command('comment')
  .description('Manage comments');

commentCmd
  .command('list')
  .description('List comments')
  .option('-t, --task <taskId>', 'Filter by task ID')
  .option('-p, --project <projectId>', 'Filter by project ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options) => {
    try {
      if (!options.task && !options.project) {
        console.error(chalk.red('Error: Either --task or --project is required.'));
        process.exit(1);
      }

      const client = getClient();
      const comments = await client.listComments({
        task_id: options.task,
        project_id: options.project,
      });

      if (options.format === 'json') {
        formatOutput(comments, 'json');
      } else {
        if (comments.length === 0) {
          console.log(chalk.yellow('No comments found.'));
          return;
        }
        console.log(chalk.bold(`Comments (${comments.length}):\n`));
        for (const comment of comments) {
          console.log(chalk.cyan(comment.content));
          console.log(chalk.gray(`  ID: ${comment.id}`));
          console.log(chalk.gray(`  Posted: ${comment.posted_at}`));
          if (comment.attachment) {
            console.log(chalk.gray(`  Attachment: ${comment.attachment.file_name}`));
          }
          console.log();
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

commentCmd
  .command('get <commentId>')
  .description('Get a comment by ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (commentId: string, options) => {
    try {
      const client = getClient();
      const comment = await client.getComment(commentId);

      if (options.format === 'json') {
        formatOutput(comment, 'json');
      } else {
        console.log(chalk.bold(comment.content));
        console.log(chalk.gray('ID:'), comment.id);
        console.log(chalk.gray('Posted:'), comment.posted_at);
        if (comment.task_id) {
          console.log(chalk.gray('Task:'), comment.task_id);
        }
        if (comment.project_id) {
          console.log(chalk.gray('Project:'), comment.project_id);
        }
        if (comment.attachment) {
          console.log(chalk.gray('Attachment:'), comment.attachment.file_url);
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

commentCmd
  .command('create <content>')
  .description('Create a new comment')
  .option('-t, --task <taskId>', 'Task ID')
  .option('-p, --project <projectId>', 'Project ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (content: string, options) => {
    try {
      if (!options.task && !options.project) {
        console.error(chalk.red('Error: Either --task or --project is required.'));
        process.exit(1);
      }

      const client = getClient();
      const comment = await client.createComment({
        content,
        task_id: options.task,
        project_id: options.project,
      });

      if (options.format === 'json') {
        formatOutput(comment, 'json');
      } else {
        console.log(chalk.green('Created comment.'));
        console.log(chalk.gray('ID:'), comment.id);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

commentCmd
  .command('update <commentId>')
  .description('Update a comment')
  .requiredOption('-c, --content <content>', 'New content')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (commentId: string, options) => {
    try {
      const client = getClient();
      const comment = await client.updateComment(commentId, {
        content: options.content,
      });

      if (options.format === 'json') {
        formatOutput(comment, 'json');
      } else {
        console.log(chalk.green('Updated comment.'));
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
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
      console.log(chalk.green('Comment deleted.'));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================
// Main Program
// ============================================

program
  .name('connect-todoist')
  .description('Todoist connector - Projects, tasks, sections, labels, and comments management')
  .version('0.0.1')
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
program.addCommand(sectionCmd);
program.addCommand(taskCmd);
program.addCommand(labelCmd);
program.addCommand(commentCmd);

program.parse();
