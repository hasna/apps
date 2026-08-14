#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Pinterest } from '../api';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-pinterest';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Pinterest connector - Manage pins, boards, and user content')
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
      process.env.PINTEREST_ACCESS_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Pinterest {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set PINTEREST_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  return new Pinterest({ accessToken });
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
  .description('Manage CLI configuration');

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
  .description('User account commands');

userCmd
  .command('me')
  .description('Get your account info')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getUserAccount();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('analytics')
  .description('Get your account analytics')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--metrics <metrics>', 'Metric types (comma-separated)', 'IMPRESSION,SAVE,PIN_CLICK')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.getUserAnalytics({
        start_date: opts.start,
        end_date: opts.end,
        metric_types: opts.metrics.split(','),
      });
      print(result, getFormat(userCmd));
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
  .description('Manage boards');

boardCmd
  .command('list')
  .description('List your boards')
  .option('--bookmark <cursor>', 'Pagination cursor')
  .option('--page-size <size>', 'Page size', '25')
  .option('--privacy <privacy>', 'Privacy filter (PUBLIC, PROTECTED, SECRET)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listBoards({
        bookmark: opts.bookmark,
        page_size: parseInt(opts.pageSize),
        privacy: opts.privacy,
      });
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('get <boardId>')
  .description('Get a board by ID')
  .action(async (boardId: string) => {
    try {
      const client = getClient();
      const result = await client.getBoard(boardId);
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
  .option('--description <desc>', 'Board description')
  .option('--privacy <privacy>', 'Privacy (PUBLIC, PROTECTED, SECRET)', 'PUBLIC')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createBoard({
        name: opts.name,
        description: opts.description,
        privacy: opts.privacy,
      });
      success('Board created!');
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('update <boardId>')
  .description('Update a board')
  .option('--name <name>', 'Board name')
  .option('--description <desc>', 'Board description')
  .option('--privacy <privacy>', 'Privacy (PUBLIC, PROTECTED, SECRET)')
  .action(async (boardId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.updateBoard(boardId, {
        name: opts.name,
        description: opts.description,
        privacy: opts.privacy,
      });
      success('Board updated!');
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('delete <boardId>')
  .description('Delete a board')
  .action(async (boardId: string) => {
    try {
      const client = getClient();
      await client.deleteBoard(boardId);
      success('Board deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('pins <boardId>')
  .description('List pins in a board')
  .option('--bookmark <cursor>', 'Pagination cursor')
  .option('--page-size <size>', 'Page size', '25')
  .action(async (boardId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listBoardPins(boardId, {
        bookmark: opts.bookmark,
        page_size: parseInt(opts.pageSize),
      });
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Pin Commands
// ============================================
const pinCmd = program
  .command('pin')
  .description('Manage pins');

pinCmd
  .command('get <pinId>')
  .description('Get a pin by ID')
  .action(async (pinId: string) => {
    try {
      const client = getClient();
      const result = await client.getPin(pinId);
      print(result, getFormat(pinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pinCmd
  .command('create')
  .description('Create a new pin')
  .requiredOption('--board-id <id>', 'Board ID')
  .requiredOption('--image-url <url>', 'Image URL')
  .option('--title <title>', 'Pin title')
  .option('--description <desc>', 'Pin description')
  .option('--link <url>', 'Destination link')
  .option('--alt-text <text>', 'Alt text for accessibility')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createPin({
        board_id: opts.boardId,
        media_source: {
          source_type: 'image_url',
          url: opts.imageUrl,
        },
        title: opts.title,
        description: opts.description,
        link: opts.link,
        alt_text: opts.altText,
      });
      success('Pin created!');
      print(result, getFormat(pinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pinCmd
  .command('update <pinId>')
  .description('Update a pin')
  .option('--board-id <id>', 'Board ID')
  .option('--title <title>', 'Pin title')
  .option('--description <desc>', 'Pin description')
  .option('--link <url>', 'Destination link')
  .option('--alt-text <text>', 'Alt text')
  .action(async (pinId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.updatePin(pinId, {
        board_id: opts.boardId,
        title: opts.title,
        description: opts.description,
        link: opts.link,
        alt_text: opts.altText,
      });
      success('Pin updated!');
      print(result, getFormat(pinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pinCmd
  .command('delete <pinId>')
  .description('Delete a pin')
  .action(async (pinId: string) => {
    try {
      const client = getClient();
      await client.deletePin(pinId);
      success('Pin deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pinCmd
  .command('save <pinId>')
  .description('Save a pin to a board')
  .requiredOption('--board-id <id>', 'Board ID')
  .option('--section-id <id>', 'Board section ID')
  .action(async (pinId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.savePin(pinId, opts.boardId, opts.sectionId);
      success('Pin saved!');
      print(result, getFormat(pinCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pinCmd
  .command('analytics <pinId>')
  .description('Get pin analytics')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--metrics <metrics>', 'Metric types (comma-separated)', 'IMPRESSION,SAVE,PIN_CLICK')
  .action(async (pinId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getPinAnalytics(pinId, {
        start_date: opts.start,
        end_date: opts.end,
        metric_types: opts.metrics.split(','),
      });
      print(result, getFormat(pinCmd));
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
  .description('Manage board sections');

sectionCmd
  .command('list <boardId>')
  .description('List sections in a board')
  .option('--bookmark <cursor>', 'Pagination cursor')
  .option('--page-size <size>', 'Page size', '25')
  .action(async (boardId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listBoardSections(boardId, {
        bookmark: opts.bookmark,
        page_size: parseInt(opts.pageSize),
      });
      print(result, getFormat(sectionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sectionCmd
  .command('create <boardId>')
  .description('Create a board section')
  .requiredOption('--name <name>', 'Section name')
  .action(async (boardId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createBoardSection(boardId, {
        name: opts.name,
      });
      success('Section created!');
      print(result, getFormat(sectionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sectionCmd
  .command('delete <boardId> <sectionId>')
  .description('Delete a board section')
  .action(async (boardId: string, sectionId: string) => {
    try {
      const client = getClient();
      await client.deleteBoardSection(boardId, sectionId);
      success('Section deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sectionCmd
  .command('pins <boardId> <sectionId>')
  .description('List pins in a section')
  .option('--bookmark <cursor>', 'Pagination cursor')
  .option('--page-size <size>', 'Page size', '25')
  .action(async (boardId: string, sectionId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listBoardSectionPins(boardId, sectionId, {
        bookmark: opts.bookmark,
        page_size: parseInt(opts.pageSize),
      });
      print(result, getFormat(sectionCmd));
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
  .description('Search pins and boards');

searchCmd
  .command('pins <query>')
  .description('Search your pins')
  .option('--bookmark <cursor>', 'Pagination cursor')
  .option('--page-size <size>', 'Page size', '25')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.searchUserPins(query, {
        bookmark: opts.bookmark,
        page_size: parseInt(opts.pageSize),
      });
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('boards <query>')
  .description('Search your boards')
  .option('--bookmark <cursor>', 'Pagination cursor')
  .option('--page-size <size>', 'Page size', '25')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.searchUserBoards(query, {
        bookmark: opts.bookmark,
        page_size: parseInt(opts.pageSize),
      });
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Following Commands
// ============================================
const followingCmd = program
  .command('following')
  .description('Manage boards you follow');

followingCmd
  .command('boards')
  .description('List boards you follow')
  .option('--bookmark <cursor>', 'Pagination cursor')
  .option('--page-size <size>', 'Page size', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listFollowingBoards({
        bookmark: opts.bookmark,
        page_size: parseInt(opts.pageSize),
      });
      print(result, getFormat(followingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

followingCmd
  .command('follow <boardId>')
  .description('Follow a board')
  .action(async (boardId: string) => {
    try {
      const client = getClient();
      await client.followBoard(boardId);
      success('Board followed!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

followingCmd
  .command('unfollow <boardId>')
  .description('Unfollow a board')
  .action(async (boardId: string) => {
    try {
      const client = getClient();
      await client.unfollowBoard(boardId);
      success('Board unfollowed!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
