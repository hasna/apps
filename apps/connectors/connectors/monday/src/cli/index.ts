#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Monday } from '../api';
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

const CONNECTOR_NAME = 'connect-monday';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Monday.com connector CLI - Workspaces, boards, items, and columns management')
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
      process.env.MONDAY_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Monday {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set MONDAY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Monday({ apiKey });
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
      const result = await client.me();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('list')
  .description('List users')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--kind <kind>', 'User kind: all, non_guests, guests, non_pending')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listUsers({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        kind: opts.kind,
      });
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
  .description('Workspace operations');

workspaceCmd
  .command('list')
  .description('List workspaces')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listWorkspaces({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(workspaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Board Commands
// ============================================
const boardCmd = program
  .command('board')
  .description('Board operations');

boardCmd
  .command('list')
  .description('List boards')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--workspace <id>', 'Filter by workspace ID')
  .option('--kind <kind>', 'Board kind: public, private, share')
  .option('--state <state>', 'Board state: active, archived, deleted, all')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listBoards({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        workspace_ids: opts.workspace ? [parseInt(opts.workspace)] : undefined,
        board_kind: opts.kind,
        state: opts.state,
      });
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('get <id>')
  .description('Get a board by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getBoard(id);
      if (!result) {
        error('Board not found');
        process.exit(1);
      }
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('create')
  .description('Create a new board')
  .requiredOption('-n, --name <name>', 'Board name')
  .option('--kind <kind>', 'Board kind: public, private, share', 'public')
  .option('--workspace <id>', 'Workspace ID')
  .option('--template <id>', 'Template ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createBoard({
        board_name: opts.name,
        board_kind: opts.kind,
        workspace_id: opts.workspace ? parseInt(opts.workspace) : undefined,
        template_id: opts.template ? parseInt(opts.template) : undefined,
      });
      success('Board created!');
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Group Commands
// ============================================
const groupCmd = program
  .command('group')
  .description('Group operations');

groupCmd
  .command('create')
  .description('Create a new group in a board')
  .requiredOption('-b, --board <id>', 'Board ID')
  .requiredOption('-n, --name <name>', 'Group name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createGroup({
        board_id: parseInt(opts.board),
        group_name: opts.name,
      });
      success('Group created!');
      print(result, getFormat(groupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Item Commands
// ============================================
const itemCmd = program
  .command('item')
  .description('Item operations');

itemCmd
  .command('list <boardId>')
  .description('List items in a board')
  .option('-l, --limit <number>', 'Maximum results')
  .option('--group <id>', 'Filter by group ID')
  .action(async (boardId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listItems(boardId, {
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        group_id: opts.group,
      });
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemCmd
  .command('get <id>')
  .description('Get an item by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getItem(id);
      if (!result) {
        error('Item not found');
        process.exit(1);
      }
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemCmd
  .command('create')
  .description('Create a new item')
  .requiredOption('-b, --board <id>', 'Board ID')
  .requiredOption('-n, --name <name>', 'Item name')
  .option('--group <id>', 'Group ID')
  .option('--column-values <json>', 'Column values as JSON string')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createItem({
        board_id: parseInt(opts.board),
        item_name: opts.name,
        group_id: opts.group,
        column_values: opts.columnValues,
      });
      success('Item created!');
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemCmd
  .command('update')
  .description('Update an item column value')
  .requiredOption('-b, --board <id>', 'Board ID')
  .requiredOption('-i, --item <id>', 'Item ID')
  .requiredOption('-c, --column <id>', 'Column ID')
  .requiredOption('-v, --value <json>', 'Value as JSON string')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.updateItem(
        opts.board,
        opts.item,
        opts.column,
        opts.value
      );
      success('Item updated!');
      print(result, getFormat(itemCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

itemCmd
  .command('delete <id>')
  .description('Delete an item')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.deleteItem(id);
      success(`Item ${result.id} deleted!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Update (Comment) Commands
// ============================================
const updateCmd = program
  .command('update')
  .description('Update (comment) operations');

updateCmd
  .command('create')
  .description('Create an update/comment on an item')
  .requiredOption('-i, --item <id>', 'Item ID')
  .requiredOption('-b, --body <text>', 'Update body text')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createUpdate(opts.item, opts.body);
      success('Update created!');
      print(result, getFormat(updateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
