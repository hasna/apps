#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { GoogleDocs } from '../api';
import {
  getApiKey,
  setApiKey,
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

const CONNECTOR_NAME = 'connect-googledocs';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Google Docs API v1 connector - Create, read, and edit Google Docs')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
  .option('-k, --api-key <key>', 'API key for read-only access (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set credentials from flags if provided
    if (opts.token) {
      process.env.GOOGLE_ACCESS_TOKEN = opts.token;
    }
    if (opts.apiKey) {
      process.env.GOOGLE_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): GoogleDocs {
  const accessToken = getAccessToken();
  const apiKey = getApiKey();
  if (!accessToken && !apiKey) {
    error(`No credentials configured. Run "${CONNECTOR_NAME} config set-token <token>" or set GOOGLE_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  return new GoogleDocs({ accessToken, apiKey });
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
  .option('--token <token>', 'OAuth access token')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set OAuth access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-key <apiKey>')
  .description('Set API key (read-only access)')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Document Commands
// ============================================

program
  .command('get <documentId>')
  .description('Get a document by ID')
  .action(async (documentId: string) => {
    try {
      const client = getClient();
      const result = await client.documents.get(documentId);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('create <title>')
  .description('Create a new document (requires OAuth token)')
  .action(async (title: string) => {
    try {
      const client = getClient();
      if (!client.hasWriteAccess()) {
        error('Creating documents requires an OAuth access token. API key provides read-only access.');
        process.exit(1);
      }
      const result = await client.documents.create(title);
      success(`Document created: ${result.documentId}`);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('append <documentId> <text>')
  .description('Append text to the end of a document (requires OAuth token)')
  .action(async (documentId: string, text: string) => {
    try {
      const client = getClient();
      if (!client.hasWriteAccess()) {
        error('Modifying documents requires an OAuth access token. API key provides read-only access.');
        process.exit(1);
      }
      const result = await client.content.appendText(documentId, text);
      success('Text appended successfully');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('replace <documentId> <find> <replace>')
  .description('Find and replace text in a document (requires OAuth token)')
  .option('--match-case', 'Match case when finding text')
  .action(async (documentId: string, find: string, replace: string, opts) => {
    try {
      const client = getClient();
      if (!client.hasWriteAccess()) {
        error('Modifying documents requires an OAuth access token. API key provides read-only access.');
        process.exit(1);
      }
      const result = await client.content.replaceText(documentId, find, replace, opts.matchCase);

      // Get the number of occurrences changed from the response
      const replaceReply = result.replies?.find(r => r.replaceAllText);
      const count = replaceReply?.replaceAllText?.occurrencesChanged || 0;

      success(`Replaced ${count} occurrence(s)`);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('insert <documentId> <text> <index>')
  .description('Insert text at a specific position (requires OAuth token)')
  .action(async (documentId: string, text: string, index: string) => {
    try {
      const client = getClient();
      if (!client.hasWriteAccess()) {
        error('Modifying documents requires an OAuth access token. API key provides read-only access.');
        process.exit(1);
      }
      const idx = parseInt(index, 10);
      if (isNaN(idx) || idx < 1) {
        error('Index must be a positive integer (1 or greater)');
        process.exit(1);
      }
      const result = await client.content.insertText(documentId, text, idx);
      success('Text inserted successfully');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('delete-range <documentId> <startIndex> <endIndex>')
  .description('Delete content within a range (requires OAuth token)')
  .action(async (documentId: string, startIndex: string, endIndex: string) => {
    try {
      const client = getClient();
      if (!client.hasWriteAccess()) {
        error('Modifying documents requires an OAuth access token. API key provides read-only access.');
        process.exit(1);
      }
      const start = parseInt(startIndex, 10);
      const end = parseInt(endIndex, 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end <= start) {
        error('Invalid range. Start must be >= 1 and end must be > start.');
        process.exit(1);
      }
      const result = await client.content.deleteRange(documentId, start, end);
      success('Content deleted successfully');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('insert-image <documentId> <uri> <index>')
  .description('Insert an image at a specific position (requires OAuth token)')
  .action(async (documentId: string, uri: string, index: string) => {
    try {
      const client = getClient();
      if (!client.hasWriteAccess()) {
        error('Modifying documents requires an OAuth access token. API key provides read-only access.');
        process.exit(1);
      }
      const idx = parseInt(index, 10);
      if (isNaN(idx) || idx < 1) {
        error('Index must be a positive integer (1 or greater)');
        process.exit(1);
      }
      const result = await client.content.insertImage(documentId, uri, idx);
      success('Image inserted successfully');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
