#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Trello } from '../api';
import {
  getApiKey,
  setApiKey,
  getToken,
  setToken,
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

const CONNECTOR_NAME = 'connect-trello';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Trello connector - Boards, lists, cards, and checklists management')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-t, --token <token>', 'Token (overrides config)')
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
      process.env.TRELLO_API_KEY = opts.apiKey;
    }
    if (opts.token) {
      process.env.TRELLO_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Trello {
  const apiKey = getApiKey();
  const token = getToken();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRELLO_API_KEY environment variable.`);
    process.exit(1);
  }
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set TRELLO_TOKEN environment variable.`);
    process.exit(1);
  }
  return new Trello({ apiKey, token });
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
  .option('--token <token>', 'Token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      token: opts.token,
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
    info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-token <token>')
  .description('Set token')
  .action((token: string) => {
    setToken(token);
    success(`Token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const token = getToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Member Commands
// ============================================
const memberCmd = program
  .command('member')
  .description('Member management');

memberCmd
  .command('me')
  .description('Get current member')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getMe();
      print(result, getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd
  .command('get <idOrUsername>')
  .description('Get a member by ID or username')
  .action(async (idOrUsername: string) => {
    try {
      const client = getClient();
      const result = await client.getMember(idOrUsername);
      print(result, getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd
  .command('boards')
  .description('List boards for a member')
  .option('--member <idOrUsername>', 'Member ID or username', 'me')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.getMemberBoards(opts.member);
      print(result, getFormat(memberCmd));
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
  .description('Board management');

boardCmd
  .command('list')
  .description('List all boards for current user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getMemberBoards('me');
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
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('create')
  .description('Create a new board')
  .requiredOption('--name <name>', 'Board name')
  .option('--desc <desc>', 'Board description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createBoard({
        name: opts.name,
        desc: opts.desc,
      });
      success('Board created!');
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('delete <id>')
  .description('Delete a board')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteBoard(id);
      success(`Board ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('lists <boardId>')
  .description('Get lists on a board')
  .option('--filter <filter>', 'Filter (all, open, closed)', 'open')
  .action(async (boardId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getBoardLists(boardId, opts.filter);
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('cards <boardId>')
  .description('Get cards on a board')
  .option('--filter <filter>', 'Filter (all, open, closed, visible)', 'open')
  .action(async (boardId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getBoardCards(boardId, opts.filter);
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('labels <boardId>')
  .description('Get labels on a board')
  .action(async (boardId: string) => {
    try {
      const client = getClient();
      const result = await client.getBoardLabels(boardId);
      print(result, getFormat(boardCmd));
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
  .description('List management');

listCmd
  .command('get <id>')
  .description('Get a list by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getList(id);
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('create')
  .description('Create a new list')
  .requiredOption('--name <name>', 'List name')
  .requiredOption('--board <boardId>', 'Board ID')
  .option('--pos <pos>', 'Position (top, bottom, or number)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createList({
        name: opts.name,
        idBoard: opts.board,
        pos: opts.pos,
      });
      success('List created!');
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('archive <id>')
  .description('Archive a list')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.archiveList(id);
      success(`List ${id} archived`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('cards <listId>')
  .description('Get cards in a list')
  .action(async (listId: string) => {
    try {
      const client = getClient();
      const result = await client.getListCards(listId);
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Card Commands
// ============================================
const cardCmd = program
  .command('card')
  .description('Card management');

cardCmd
  .command('get <id>')
  .description('Get a card by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getCard(id);
      print(result, getFormat(cardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardCmd
  .command('create')
  .description('Create a new card')
  .requiredOption('--name <name>', 'Card name')
  .requiredOption('--list <listId>', 'List ID')
  .option('--desc <desc>', 'Card description')
  .option('--due <date>', 'Due date')
  .option('--pos <pos>', 'Position (top, bottom, or number)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createCard({
        name: opts.name,
        idList: opts.list,
        desc: opts.desc,
        due: opts.due,
        pos: opts.pos,
      });
      success('Card created!');
      print(result, getFormat(cardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardCmd
  .command('update <id>')
  .description('Update a card')
  .option('--name <name>', 'Card name')
  .option('--desc <desc>', 'Card description')
  .option('--due <date>', 'Due date')
  .option('--closed', 'Archive the card')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.updateCard(id, {
        name: opts.name,
        desc: opts.desc,
        due: opts.due,
        closed: opts.closed,
      });
      success('Card updated!');
      print(result, getFormat(cardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardCmd
  .command('delete <id>')
  .description('Delete a card')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteCard(id);
      success(`Card ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardCmd
  .command('move <id>')
  .description('Move a card to another list')
  .requiredOption('--list <listId>', 'Destination list ID')
  .option('--pos <pos>', 'Position (top, bottom, or number)')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.moveCard(id, opts.list, opts.pos);
      success('Card moved!');
      print(result, getFormat(cardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

cardCmd
  .command('archive <id>')
  .description('Archive a card')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.archiveCard(id);
      success(`Card ${id} archived`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Checklist Commands
// ============================================
const checklistCmd = program
  .command('checklist')
  .description('Checklist management');

checklistCmd
  .command('get <id>')
  .description('Get a checklist by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getChecklist(id);
      print(result, getFormat(checklistCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checklistCmd
  .command('create')
  .description('Create a new checklist')
  .requiredOption('--name <name>', 'Checklist name')
  .requiredOption('--card <cardId>', 'Card ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createChecklist({
        name: opts.name,
        idCard: opts.card,
      });
      success('Checklist created!');
      print(result, getFormat(checklistCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checklistCmd
  .command('delete <id>')
  .description('Delete a checklist')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteChecklist(id);
      success(`Checklist ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checklistCmd
  .command('items <checklistId>')
  .description('Get items in a checklist')
  .action(async (checklistId: string) => {
    try {
      const client = getClient();
      const result = await client.getChecklistItems(checklistId);
      print(result, getFormat(checklistCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checklistCmd
  .command('add-item')
  .description('Add an item to a checklist')
  .requiredOption('--checklist <checklistId>', 'Checklist ID')
  .requiredOption('--name <name>', 'Item name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createCheckItem(opts.checklist, { name: opts.name });
      success('Check item added!');
      print(result, getFormat(checklistCmd));
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
  .description('Comment management');

commentCmd
  .command('add')
  .description('Add a comment to a card')
  .requiredOption('--card <cardId>', 'Card ID')
  .requiredOption('--text <text>', 'Comment text')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.addComment(opts.card, opts.text);
      success('Comment added!');
      print(result, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Label Commands
// ============================================
const labelCmd = program
  .command('label')
  .description('Label management');

labelCmd
  .command('create')
  .description('Create a new label')
  .requiredOption('--name <name>', 'Label name')
  .requiredOption('--color <color>', 'Label color')
  .requiredOption('--board <boardId>', 'Board ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createLabel({
        name: opts.name,
        color: opts.color,
        idBoard: opts.board,
      });
      success('Label created!');
      print(result, getFormat(labelCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

labelCmd
  .command('delete <id>')
  .description('Delete a label')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteLabel(id);
      success(`Label ${id} deleted`);
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
  .description('Search Trello');

searchCmd
  .command('query <query>')
  .description('Search for boards, cards, members')
  .option('--boards <boardIds>', 'Limit to specific boards (comma-separated)')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.search(query, {
        idBoards: opts.boards,
      });
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
