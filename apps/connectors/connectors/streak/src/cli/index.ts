#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-streak';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Streak CRM API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) setVerboseMode(true);
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist.`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.STREAK_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  return (cmd.parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STREAK_API_KEY.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
}

async function run(fn: (client: Connector) => Promise<unknown>): Promise<void> {
  try {
    const result = await fn(getClient());
    if (result !== undefined) print(result, (program.opts().format || 'pretty') as OutputFormat);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`));
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').option('--api-key <key>').option('--use').action((name: string, opts) => {
  if (profileExists(name)) {
    error(`Profile "${name}" already exists`);
    process.exit(1);
  }
  createProfile(name, { apiKey: opts.apiKey });
  success(`Profile "${name}" created`);
  if (opts.use) setCurrentProfile(name);
});

profileCmd.command('delete <name>').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete default profile');
    process.exit(1);
  }
  if (!deleteProfile(name)) {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// User commands
program.command('get-current-user').description('Get the current user').action(async function () {
  await run( c => c.users.me());
});

program.command('get-user <key>').description('Get a user by key').action(async function (key: string) {
  await run( c => c.users.get(key));
});

// Pipeline commands
program.command('list-pipelines').description('List pipelines').action(async function () {
  await run( c => c.pipelines.list());
});

program.command('get-pipeline <key>').description('Get a pipeline').action(async function (key: string) {
  await run( c => c.pipelines.get(key));
});

program
  .command('create-pipeline')
  .description('Create a pipeline')
  .requiredOption('--name <name>', 'Pipeline name')
  .option('--description <desc>', 'Description')
  .option('--org-wide', 'Org-wide pipeline')
  .action(async function (opts) {
    await run( c => c.pipelines.create({
      name: opts.name,
      description: opts.description,
      orgWide: opts.orgWide,
    }));
  });

program
  .command('update-pipeline <key>')
  .description('Update a pipeline')
  .option('--name <name>', 'Pipeline name')
  .option('--description <desc>', 'Description')
  .action(async function (key: string, opts) {
    await run( c => c.pipelines.update(key, {
      name: opts.name,
      description: opts.description,
    }));
  });

program.command('delete-pipeline <key>').description('Delete a pipeline').action(async function (key: string) {
  try {
    await getClient().pipelines.delete(key);
    success('Pipeline deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Box commands
program
  .command('list-boxes')
  .description('List boxes')
  .option('--pipeline-key <key>', 'Filter by pipeline')
  .option('--sort-by <field>', 'Sort field')
  .option('--limit <n>', 'Limit')
  .option('--page <n>', 'Page number')
  .action(async function (opts) {
    const params: Record<string, string | number | undefined> = {};
    if (opts.sortBy) params.sortBy = opts.sortBy;
    if (opts.limit) params.limit = parseInt(opts.limit, 10);
    if (opts.page) params.page = parseInt(opts.page, 10);
    await run( c => c.boxes.list(opts.pipelineKey, params));
  });

program.command('get-box <key>').description('Get a box').action(async function (key: string) {
  await run( c => c.boxes.get(key));
});

program
  .command('create-box')
  .description('Create a box in a pipeline')
  .requiredOption('--pipeline-key <key>', 'Pipeline key')
  .requiredOption('--name <name>', 'Box name')
  .option('--notes <notes>', 'Notes')
  .option('--stage-key <key>', 'Stage key')
  .action(async function (opts) {
    await run( c => c.boxes.create(opts.pipelineKey, {
      name: opts.name,
      notes: opts.notes,
      stageKey: opts.stageKey,
    }));
  });

program
  .command('update-box <key>')
  .description('Update a box')
  .option('--name <name>', 'Box name')
  .option('--notes <notes>', 'Notes')
  .option('--stage-key <key>', 'Stage key')
  .option('--fields <json>', 'Fields JSON object')
  .action(async function (key: string, opts) {
    const data: Record<string, unknown> = {};
    if (opts.name) data.name = opts.name;
    if (opts.notes) data.notes = opts.notes;
    if (opts.stageKey) data.stageKey = opts.stageKey;
    if (opts.fields) data.fields = JSON.parse(opts.fields);
    await run( c => c.boxes.update(key, data));
  });

program.command('delete-box <key>').description('Delete a box').action(async function (key: string) {
  try {
    await getClient().boxes.delete(key);
    success('Box deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Stage commands
program
  .command('list-stages')
  .description('List pipeline stages')
  .requiredOption('--pipeline-key <key>', 'Pipeline key')
  .action(async function (opts) {
    await run( c => c.stages.list(opts.pipelineKey));
  });

program
  .command('create-stage')
  .description('Create a stage')
  .requiredOption('--pipeline-key <key>', 'Pipeline key')
  .requiredOption('--name <name>', 'Stage name')
  .action(async function (opts) {
    await run( c => c.stages.create(opts.pipelineKey, opts.name));
  });

// Field commands
program
  .command('list-fields')
  .description('List custom fields')
  .requiredOption('--pipeline-key <key>', 'Pipeline key')
  .action(async function (opts) {
    await run( c => c.fields.list(opts.pipelineKey));
  });

program
  .command('create-field')
  .description('Create a custom field')
  .requiredOption('--pipeline-key <key>', 'Pipeline key')
  .requiredOption('--name <name>', 'Field name')
  .requiredOption('--type <type>', 'Field type')
  .action(async function (opts) {
    await run( c => c.fields.create(opts.pipelineKey, { name: opts.name, type: opts.type }));
  });

// Task commands
program
  .command('list-tasks')
  .description('List tasks on a box')
  .requiredOption('--box-key <key>', 'Box key')
  .action(async function (opts) {
    await run( c => c.tasks.list(opts.boxKey));
  });

program
  .command('create-task')
  .description('Create a task on a box')
  .requiredOption('--box-key <key>', 'Box key')
  .requiredOption('--text <text>', 'Task text')
  .option('--due-date <ms>', 'Due date (epoch ms)')
  .option('--assigned-to <emails>', 'Comma-separated assignee emails')
  .action(async function (opts) {
    await run( c => c.tasks.create(opts.boxKey, {
      text: opts.text,
      dueDate: opts.dueDate ? parseInt(opts.dueDate, 10) : undefined,
      assignedTo: opts.assignedTo ? opts.assignedTo.split(',') : undefined,
    }));
  });

program
  .command('update-task <key>')
  .description('Update a task')
  .option('--text <text>', 'Task text')
  .option('--due-date <ms>', 'Due date (epoch ms)')
  .option('--status <status>', 'Task status')
  .option('--assigned-to <emails>', 'Comma-separated assignee emails')
  .action(async function (key: string, opts) {
    await run( c => c.tasks.update(key, {
      text: opts.text,
      dueDate: opts.dueDate ? parseInt(opts.dueDate, 10) : undefined,
      status: opts.status,
      assignedTo: opts.assignedTo ? opts.assignedTo.split(',') : undefined,
    }));
  });

program.command('delete-task <key>').description('Delete a task').action(async function (key: string) {
  try {
    await getClient().tasks.delete(key);
    success('Task deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Comment commands
program
  .command('list-comments')
  .description('List comments on a box')
  .requiredOption('--box-key <key>', 'Box key')
  .action(async function (opts) {
    await run( c => c.comments.list(opts.boxKey));
  });

program
  .command('create-comment')
  .description('Add a comment to a box')
  .requiredOption('--box-key <key>', 'Box key')
  .requiredOption('--message <message>', 'Comment message')
  .action(async function (opts) {
    await run( c => c.comments.create(opts.boxKey, opts.message));
  });

program.command('delete-comment <key>').description('Delete a comment').action(async function (key: string) {
  try {
    await getClient().comments.delete(key);
    success('Comment deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Thread commands
program
  .command('list-threads')
  .description('List email threads on a box')
  .requiredOption('--box-key <key>', 'Box key')
  .action(async function (opts) {
    await run( c => c.threads.list(opts.boxKey));
  });

// Reminder commands
program
  .command('list-reminders')
  .description('List reminders on a box')
  .requiredOption('--box-key <key>', 'Box key')
  .action(async function (opts) {
    await run( c => c.reminders.list(opts.boxKey));
  });

program
  .command('create-reminder')
  .description('Create a reminder on a box')
  .requiredOption('--box-key <key>', 'Box key')
  .requiredOption('--message <message>', 'Reminder message')
  .requiredOption('--remind-date <ms>', 'Remind date (epoch ms)')
  .option('--remind-followers', 'Remind followers')
  .action(async function (opts) {
    await run( c => c.reminders.create(opts.boxKey, {
      message: opts.message,
      remindDate: parseInt(opts.remindDate, 10),
      remindFollowers: opts.remindFollowers,
    }));
  });

// File commands
program
  .command('list-files')
  .description('List files on a box')
  .requiredOption('--box-key <key>', 'Box key')
  .action(async function (opts) {
    await run( c => c.files.list(opts.boxKey));
  });

// Team commands
program.command('list-teams').description('List teams').action(async function () {
  await run( c => c.teams.list());
});

program
  .command('list-users-on-team')
  .description('List users on a team')
  .requiredOption('--team-key <key>', 'Team key')
  .action(async function (opts) {
    await run( c => c.teams.getUsers(opts.teamKey));
  });

// Search
program
  .command('search')
  .description('Free-text search')
  .requiredOption('--query <query>', 'Search query')
  .action(async function (opts) {
    await run( c => c.search.search(opts.query));
  });

program.parse();
