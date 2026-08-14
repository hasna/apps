#!/usr/bin/env bun
import { Command } from 'commander';
import { GoogleTasksClient } from '../api';
import { BulkApi } from '../api/bulk';
import {
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  getConfigDir,
  getBaseConfigDir,
  getClientId,
  getClientSecret,
  setCredentials,
  setTokens,
  getAccessToken,
  getRefreshToken,
  isTokenExpired,
  clearTokens,
  loadProfile,
} from '../utils/config';
import {
  print,
  success,
  error,
  info,
  printTaskLists,
  printTaskList,
  printTasks,
  printTask,
} from '../utils/output';
import type { OutputFormat } from '../types';

const program = new Command();

// Helper to get format option
function getFormat(cmd: Command): OutputFormat {
  const opts = cmd.optsWithGlobals();
  return opts.format || 'pretty';
}

// Helper to get client
async function getClient(): Promise<GoogleTasksClient> {
  let token = getAccessToken();

  // If no access token or token is expired, try to refresh using refresh token
  if (!token || isTokenExpired()) {
    const refreshToken = getRefreshToken();
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (refreshToken && clientId && clientSecret) {
      try {
        const tokens = await GoogleTasksClient.refreshAccessToken(refreshToken, clientId, clientSecret);
        setTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
        token = tokens.access_token;
      } catch {
        // Fall through to error below if refresh fails
      }
    }

    if (!token) {
      throw new Error('Not authenticated. Run "connect-googletasks auth login" first.');
    }
  }

  return new GoogleTasksClient(token);
}

program
  .name('connect-googletasks')
  .description('Google Tasks API CLI - Manage task lists and tasks')
  .version('0.1.0')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Authentication commands');

authCmd
  .command('setup')
  .description('Set up OAuth credentials')
  .requiredOption('--client-id <id>', 'Google OAuth Client ID')
  .requiredOption('--client-secret <secret>', 'Google OAuth Client Secret')
  .action(async function(this: Command, opts) {
    try {
      setCredentials(opts.clientId, opts.clientSecret);
      success('OAuth credentials saved');
      info('Now run "connect-googletasks auth login" to authenticate');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd
  .command('login')
  .description('Authenticate with Google')
  .action(async function(this: Command) {
    try {
      const clientId = getClientId();
      const clientSecret = getClientSecret();

      if (!clientId || !clientSecret) {
        error('OAuth credentials not set. Run "connect-googletasks auth setup" first.');
        process.exit(1);
      }

      const authUrl = GoogleTasksClient.getAuthUrl(clientId);
      console.log('\n1. Open this URL in your browser:\n');
      console.log(`   ${authUrl}\n`);
      console.log('2. Authorize the application and copy the authorization code\n');
      console.log('3. Run: connect-googletasks auth callback <code>\n');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd
  .command('callback <code>')
  .description('Complete authentication with authorization code')
  .action(async function(this: Command, code: string) {
    try {
      const clientId = getClientId();
      const clientSecret = getClientSecret();

      if (!clientId || !clientSecret) {
        error('OAuth credentials not set. Run "connect-googletasks auth setup" first.');
        process.exit(1);
      }

      const tokens = await GoogleTasksClient.exchangeCode(code, clientId, clientSecret);
      setTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
      success('Authentication successful!');
      info('You can now use Google Tasks commands');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd
  .command('refresh')
  .description('Refresh access token')
  .action(async function(this: Command) {
    try {
      const clientId = getClientId();
      const clientSecret = getClientSecret();
      const refreshToken = getRefreshToken();

      if (!clientId || !clientSecret || !refreshToken) {
        error('Cannot refresh token. Run "connect-googletasks auth login" to re-authenticate.');
        process.exit(1);
      }

      const tokens = await GoogleTasksClient.refreshAccessToken(refreshToken, clientId, clientSecret);
      setTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
      success('Token refreshed successfully');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd
  .command('logout')
  .description('Clear stored tokens')
  .action(async function(this: Command) {
    try {
      clearTokens();
      success('Logged out successfully');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(async function(this: Command) {
    try {
      const token = getAccessToken();
      const refreshToken = getRefreshToken();
      const config = loadProfile();

      if (token) {
        success('Authenticated');
        info(`Access token: ${token.substring(0, 20)}...`);
        if (refreshToken) {
          info(`Refresh token: ${refreshToken.substring(0, 20)}...`);
        }
        if (config.tokenExpiry) {
          const expiry = new Date(config.tokenExpiry);
          const isExpired = Date.now() >= config.tokenExpiry;
          info(`Token expires: ${expiry.toLocaleString()} ${isExpired ? '(EXPIRED)' : ''}`);
        }
      } else {
        info('Not authenticated. Run "connect-googletasks auth login" to authenticate.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(function(this: Command) {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      info('No profiles found');
      return;
    }

    success('Profiles:');
    for (const profile of profiles) {
      const marker = profile === current ? ' (active)' : '';
      console.log(`  ${profile}${marker}`);
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action(function(this: Command, name: string) {
    try {
      setCurrentProfile(name);
      success(`Switched to profile "${name}"`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action(function(this: Command, name: string) {
    try {
      if (createProfile(name)) {
        success(`Profile "${name}" created`);
      } else {
        error(`Profile "${name}" already exists`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action(function(this: Command, name: string) {
    try {
      if (deleteProfile(name)) {
        success(`Profile "${name}" deleted`);
      } else {
        error(`Cannot delete profile "${name}"`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('show')
  .description('Show current configuration')
  .action(function(this: Command) {
    const profile = getCurrentProfile();
    info(`Active Profile: ${profile}`);
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);

    const config = loadProfile();
    if (config.clientId) {
      info(`Client ID: ${config.clientId.substring(0, 20)}...`);
    }
    if (config.accessToken) {
      info(`Access Token: ${config.accessToken.substring(0, 20)}...`);
    }
  });

// ============================================
// Task Lists Commands
// ============================================
const listsCmd = program
  .command('lists')
  .description('Manage task lists');

listsCmd
  .command('list')
  .alias('ls')
  .description('List all task lists')
  .action(async function(this: Command) {
    try {
      const client = await getClient();
      const response = await client.listTaskLists();
      printTaskLists(response.items || [], getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('get <listId>')
  .description('Get a task list by ID')
  .action(async function(this: Command, listId: string) {
    try {
      const client = await getClient();
      const list = await client.getTaskList(listId);
      printTaskList(list, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('create <title>')
  .description('Create a new task list')
  .action(async function(this: Command, title: string) {
    try {
      const client = await getClient();
      const list = await client.createTaskList({ title });
      success(`Task list "${list.title}" created`);
      printTaskList(list, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('rename <listId> <title>')
  .description('Rename a task list')
  .action(async function(this: Command, listId: string, title: string) {
    try {
      const client = await getClient();
      const list = await client.updateTaskList(listId, { title });
      success(`Task list renamed to "${list.title}"`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('delete <listId>')
  .description('Delete a task list')
  .action(async function(this: Command, listId: string) {
    try {
      const client = await getClient();
      await client.deleteTaskList(listId);
      success('Task list deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Tasks Commands
// ============================================
const tasksCmd = program
  .command('tasks')
  .description('Manage tasks');

tasksCmd
  .command('list <listId>')
  .alias('ls')
  .description('List tasks in a task list')
  .option('--all', 'Show completed and deleted tasks')
  .option('--completed', 'Show completed tasks')
  .option('--max <number>', 'Maximum number of tasks', '100')
  .action(async function(this: Command, listId: string, opts) {
    try {
      const client = await getClient();
      const response = await client.listTasks(listId, {
        maxResults: parseInt(opts.max),
        showCompleted: opts.all || opts.completed,
        showDeleted: opts.all,
        showHidden: opts.all,
      });
      printTasks(response.items || [], getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('get <listId> <taskId>')
  .description('Get a task by ID')
  .action(async function(this: Command, listId: string, taskId: string) {
    try {
      const client = await getClient();
      const task = await client.getTask(listId, taskId);
      printTask(task, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('add <listId> <title>')
  .description('Create a new task')
  .option('-n, --notes <notes>', 'Task notes')
  .option('-d, --due <date>', 'Due date (YYYY-MM-DD)')
  .action(async function(this: Command, listId: string, title: string, opts) {
    try {
      const client = await getClient();
      const task = await client.createTask(listId, {
        title,
        notes: opts.notes,
        due: opts.due ? new Date(opts.due).toISOString() : undefined,
      });
      success(`Task "${task.title}" created`);
      printTask(task, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('update <listId> <taskId>')
  .description('Update a task')
  .option('-t, --title <title>', 'New title')
  .option('-n, --notes <notes>', 'New notes')
  .option('-d, --due <date>', 'New due date (YYYY-MM-DD)')
  .action(async function(this: Command, listId: string, taskId: string, opts) {
    try {
      const client = await getClient();
      const task = await client.updateTask(listId, taskId, {
        title: opts.title,
        notes: opts.notes,
        due: opts.due ? new Date(opts.due).toISOString() : undefined,
      });
      success(`Task updated`);
      printTask(task, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('complete <listId> <taskId>')
  .alias('done')
  .description('Mark a task as completed')
  .action(async function(this: Command, listId: string, taskId: string) {
    try {
      const client = await getClient();
      const task = await client.completeTask(listId, taskId);
      success(`Task "${task.title}" marked as completed`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('uncomplete <listId> <taskId>')
  .alias('undo')
  .description('Mark a task as not completed')
  .action(async function(this: Command, listId: string, taskId: string) {
    try {
      const client = await getClient();
      const task = await client.uncompleteTask(listId, taskId);
      success(`Task "${task.title}" marked as needs action`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('delete <listId> <taskId>')
  .alias('rm')
  .description('Delete a task')
  .action(async function(this: Command, listId: string, taskId: string) {
    try {
      const client = await getClient();
      await client.deleteTask(listId, taskId);
      success('Task deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('move <listId> <taskId>')
  .description('Move a task to a different position')
  .option('--parent <parentId>', 'Make a subtask of this task')
  .option('--after <taskId>', 'Position after this task')
  .action(async function(this: Command, listId: string, taskId: string, opts) {
    try {
      const client = await getClient();
      const task = await client.moveTask(listId, taskId, {
        parent: opts.parent,
        previous: opts.after,
      });
      success(`Task "${task.title}" moved`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('clear <listId>')
  .description('Clear all completed tasks from a list')
  .action(async function(this: Command, listId: string) {
    try {
      const client = await getClient();
      await client.clearCompleted(listId);
      success('Completed tasks cleared');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Bulk Operations
// ============================================
const bulkCmd = program
  .command('bulk')
  .description('Bulk operations on tasks');

bulkCmd
  .command('preview <listId>')
  .description('Preview tasks in a list')
  .option('-q, --query <text>', 'Filter by search query')
  .option('--show-completed', 'Include completed tasks')
  .option('-n, --max <number>', 'Maximum tasks to preview', '50')
  .action(async function(this: Command, listId: string, opts) {
    try {
      const api = new BulkApi();
      const result = await api.preview(listId, {
        query: opts.query,
        showCompleted: opts.showCompleted,
        maxResults: parseInt(opts.max),
      });
      success(`Found ${result.total} task(s) in list ${listId}`);
      print(result.tasks, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('complete <listId>')
  .description('Bulk mark tasks as completed')
  .option('-q, --query <text>', 'Filter by search query')
  .option('--show-completed', 'Include completed in search')
  .option('-n, --max <number>', 'Maximum tasks to process', '100')
  .option('-c, --concurrency <number>', 'Max concurrent API calls', '10')
  .option('--dry-run', 'Preview without making changes')
  .action(async function(this: Command, listId: string, opts) {
    try {
      const api = new BulkApi();
      let current = 0;
      const result = await api.complete({
        taskListId: listId,
        query: opts.query,
        showCompleted: opts.showCompleted,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        onProgress: (cur, total) => {
          current = cur;
          process.stdout.write(`\r  Progress: ${cur}/${total}`);
        },
      });
      process.stdout.write('\n');
      if (opts.dryRun) {
        info(`[Dry run] Would mark ${result.success} task(s) as completed`);
      } else {
        success(`${result.success} task(s) marked as completed, ${result.failed} failed`);
      }
      if (result.errors.length > 0) {
        warn(`Errors: ${JSON.stringify(result.errors)}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('uncomplete <listId>')
  .description('Bulk mark completed tasks back to pending')
  .option('-n, --max <number>', 'Maximum tasks to process', '100')
  .option('-c, --concurrency <number>', 'Max concurrent API calls', '10')
  .option('--dry-run', 'Preview without making changes')
  .action(async function(this: Command, listId: string, opts) {
    try {
      const api = new BulkApi();
      const result = await api.uncomplete({
        taskListId: listId,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
      });
      if (opts.dryRun) {
        info(`[Dry run] Would uncomplete ${result.success} task(s)`);
      } else {
        success(`${result.success} task(s) uncompleted, ${result.failed} failed`);
      }
      if (result.errors.length > 0) {
        warn(`Errors: ${JSON.stringify(result.errors)}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('delete <listId>')
  .description('Bulk delete tasks')
  .option('-q, --query <text>', 'Filter by search query')
  .option('--show-completed', 'Include completed tasks')
  .option('-n, --max <number>', 'Maximum tasks to process', '100')
  .option('-c, --concurrency <number>', 'Max concurrent API calls', '10')
  .option('--dry-run', 'Preview without making changes')
  .option('--confirm', 'Confirm deletion (required)')
  .action(async function(this: Command, listId: string, opts) {
    if (!opts.confirm) {
      error('Use --confirm to confirm deletion');
      process.exit(1);
    }
    try {
      const api = new BulkApi();
      const result = await api.delete({
        taskListId: listId,
        query: opts.query,
        showCompleted: opts.showCompleted,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
      });
      if (opts.dryRun) {
        info(`[Dry run] Would delete ${result.success} task(s)`);
      } else {
        success(`${result.success} task(s) deleted, ${result.failed} failed`);
      }
      if (result.errors.length > 0) {
        warn(`Errors: ${JSON.stringify(result.errors)}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('update <listId>')
  .description('Bulk update due dates or notes on tasks')
  .option('-q, --query <text>', 'Filter by search query')
  .option('--show-completed', 'Include completed tasks')
  .option('-n, --max <number>', 'Maximum tasks to process', '100')
  .option('-c, --concurrency <number>', 'Max concurrent API calls', '10')
  .option('--dry-run', 'Preview without making changes')
  .option('--due <date>', 'Set due date (YYYY-MM-DD)')
  .option('--notes <text>', 'Set notes')
  .action(async function(this: Command, listId: string, opts) {
    if (!opts.due && !opts.notes) {
      error('Specify at least --due or --notes');
      process.exit(1);
    }
    try {
      const api = new BulkApi();
      const result = await api.update(listId, {
        query: opts.query,
        showCompleted: opts.showCompleted,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        updates: {
          due: opts.due ? new Date(opts.due).toISOString() : undefined,
          notes: opts.notes,
        },
      });
      if (opts.dryRun) {
        info(`[Dry run] Would update ${result.success} task(s)`);
      } else {
        success(`${result.success} task(s) updated, ${result.failed} failed`);
      }
      if (result.errors.length > 0) {
        warn(`Errors: ${JSON.stringify(result.errors)}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
