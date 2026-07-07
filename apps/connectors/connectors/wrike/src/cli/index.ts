#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Wrike } from '../api';
import {
  getApiToken,
  setApiToken,
  getHost,
  setHost,
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

const CONNECTOR_NAME = 'connect-wrike';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wrike connector CLI - Work management, tasks, folders, and team collaboration')
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
      process.env.WRIKE_API_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Wrike {
  const apiToken = getApiToken();
  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set WRIKE_API_TOKEN.`);
    process.exit(1);
  }
  return new Wrike({ apiToken, host: getHost() });
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'API token')
  .option('--host <host>', 'Wrike host')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiToken: opts.token, host: opts.host });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Token: ${config.apiToken ? `${config.apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Host: ${config.host || chalk.gray('www.wrike.com (default)')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').description('Set API token').action((token: string) => {
  setApiToken(token);
  success(`API token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-host <host>').description('Set Wrike host (e.g. www.wrike.com)').action((host: string) => {
  setHost(host);
  success(`Host saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiToken = getApiToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Host: ${getHost()}`);
  info(`Token: ${apiToken ? `${apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Version
program.command('version').description('Get Wrike API version').action(async () => {
  try {
    const client = getClient();
    print(await client.getVersion(), getFormat(program));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Task commands
const taskCmd = program.command('task').description('Task operations');

taskCmd
  .command('list')
  .description('List tasks')
  .option('--folder <id>', 'Folder ID')
  .option('--status <status>', 'Filter by status')
  .option('--page-size <n>', 'Page size', parseInt)
  .action(async (opts) => {
    try {
      const client = getClient();
      print(await client.listTasks({
        folderId: opts.folder,
        status: opts.status,
        pageSize: opts.pageSize,
      }), getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd.command('get <id>').description('Get a task').action(async (id: string) => {
  try {
    print(await getClient().getTask(id), getFormat(taskCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

taskCmd
  .command('create')
  .description('Create a task')
  .requiredOption('--folder <id>', 'Parent folder ID')
  .requiredOption('--title <title>', 'Task title')
  .option('--description <text>', 'Task description')
  .action(async (opts) => {
    try {
      const result = await getClient().createTask({
        folderId: opts.folder,
        title: opts.title,
        description: opts.description,
      });
      success('Task created');
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('update <id>')
  .description('Update a task')
  .option('--title <title>', 'Task title')
  .option('--description <text>', 'Task description')
  .option('--status <status>', 'Task status')
  .action(async (id: string, opts) => {
    try {
      const result = await getClient().updateTask({
        id,
        title: opts.title,
        description: opts.description,
        status: opts.status,
      });
      success('Task updated');
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd.command('delete <id>').description('Delete a task').action(async (id: string) => {
  try {
    await getClient().deleteTask(id);
    success(`Task ${id} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Folder commands
const folderCmd = program.command('folder').description('Folder operations');

folderCmd
  .command('list')
  .description('List folders')
  .option('--space <id>', 'Space ID')
  .action(async (opts) => {
    try {
      print(await getClient().listFolders({ spaceId: opts.space }), getFormat(folderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

folderCmd.command('get <id>').description('Get a folder').action(async (id: string) => {
  try {
    print(await getClient().getFolder(id), getFormat(folderCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

folderCmd
  .command('create')
  .description('Create a folder')
  .requiredOption('--parent <id>', 'Parent folder ID')
  .requiredOption('--title <title>', 'Folder title')
  .action(async (opts) => {
    try {
      const result = await getClient().createFolder({
        parentFolderId: opts.parent,
        title: opts.title,
      });
      success('Folder created');
      print(result, getFormat(folderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

folderCmd.command('delete <id>').description('Delete a folder').action(async (id: string) => {
  try {
    await getClient().deleteFolder(id);
    success(`Folder ${id} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Space commands
const spaceCmd = program.command('space').description('Space operations');

spaceCmd.command('list').description('List spaces').action(async () => {
  try {
    print(await getClient().listSpaces(), getFormat(spaceCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

spaceCmd.command('get <id>').description('Get a space').action(async (id: string) => {
  try {
    print(await getClient().getSpace(id), getFormat(spaceCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Comment commands
const commentCmd = program.command('comment').description('Comment operations');

commentCmd
  .command('list')
  .description('List comments')
  .option('--task <id>', 'Task ID')
  .option('--folder <id>', 'Folder ID')
  .action(async (opts) => {
    try {
      print(await getClient().listComments({ taskId: opts.task, folderId: opts.folder }), getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd
  .command('create')
  .description('Create a comment')
  .option('--task <id>', 'Task ID')
  .option('--folder <id>', 'Folder ID')
  .requiredOption('--text <text>', 'Comment text')
  .action(async (opts) => {
    try {
      const result = await getClient().createComment({
        taskId: opts.task,
        folderId: opts.folder,
        text: opts.text,
      });
      success('Comment created');
      print(result, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd.command('delete <id>').description('Delete a comment').action(async (id: string) => {
  try {
    await getClient().deleteComment(id);
    success(`Comment ${id} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Timelog commands
const timelogCmd = program.command('timelog').description('Timelog operations');

timelogCmd
  .command('list')
  .description('List timelogs')
  .option('--task <id>', 'Task ID')
  .option('--folder <id>', 'Folder ID')
  .action(async (opts) => {
    try {
      print(await getClient().listTimelogs({ taskId: opts.task, folderId: opts.folder }), getFormat(timelogCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

timelogCmd
  .command('create')
  .description('Create a timelog')
  .requiredOption('--task <id>', 'Task ID')
  .requiredOption('--hours <n>', 'Hours tracked', parseFloat)
  .requiredOption('--date <date>', 'Tracked date (YYYY-MM-DD)')
  .option('--comment <text>', 'Comment')
  .action(async (opts) => {
    try {
      const result = await getClient().createTimelog({
        taskId: opts.task,
        hours: opts.hours,
        trackedDate: opts.date,
        comment: opts.comment,
      });
      success('Timelog created');
      print(result, getFormat(timelogCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

timelogCmd.command('delete <id>').description('Delete a timelog').action(async (id: string) => {
  try {
    await getClient().deleteTimelog(id);
    success(`Timelog ${id} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Contact commands
const contactCmd = program.command('contact').description('Contact operations');

contactCmd
  .command('list')
  .description('List contacts')
  .option('--me', 'Current user only')
  .action(async (opts) => {
    try {
      print(await getClient().listContacts({ me: opts.me }), getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd.command('get <id>').description('Get a contact').action(async (id: string) => {
  try {
    print(await getClient().getContact(id), getFormat(contactCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const workflowCmd = program.command('workflow').description('Workflow operations');

workflowCmd.command('list').description('List workflows').action(async () => {
  try {
    print(await getClient().listWorkflows(), getFormat(workflowCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const customFieldCmd = program.command('customfield').description('Custom field operations');

customFieldCmd.command('list').description('List custom fields').action(async () => {
  try {
    print(await getClient().listCustomFields(), getFormat(customFieldCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

customFieldCmd
  .command('create')
  .description('Create a custom field')
  .requiredOption('--title <title>', 'Field title')
  .requiredOption('--type <type>', 'Field type')
  .action(async (opts) => {
    try {
      const result = await getClient().createCustomField({ title: opts.title, type: opts.type });
      success('Custom field created');
      print(result, getFormat(customFieldCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
