#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { StickyNote } from '../api';
import type { StickyNoteConfig } from '../types';
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
  setBaseUrl,
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
import { print, type OutputFormat } from '../utils/output';

const program = new Command();

function getClient(): StickyNote {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(chalk.red('Error: API key not configured.'));
    console.error(chalk.yellow('Run: connect-sticky-note config set-key <api-key>'));
    console.error(chalk.yellow('Or set STICKY_NOTE_API_KEY environment variable'));
    process.exit(1);
  }

  const config: StickyNoteConfig = {
    apiKey,
    baseUrl: getBaseUrl(),
  };
  return new StickyNote(config);
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    console.error(chalk.red(`Error: invalid ${label} JSON: ${(error as Error).message}`));
    process.exit(1);
  }
}

const profileCmd = new Command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles configured.'));
      return;
    }

    console.log(chalk.bold('Profiles:'));
    for (const profile of profiles) {
      const marker = profile === current ? chalk.green(' (active)') : '';
      console.log(`  ${profile}${marker}`);
    }
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
      console.log(created ? chalk.green(`Created profile: ${name}`) : chalk.yellow(`Profile already exists: ${name}`));
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
    console.log(deleted ? chalk.green(`Deleted profile: ${name}`) : chalk.yellow(`Could not delete profile: ${name}`));
  });

const configCmd = new Command('config').description('Manage configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set the API key for current profile')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    console.log(chalk.green(`API key saved to profile: ${getActiveProfileName()}`));
  });

configCmd
  .command('set-base-url <baseUrl>')
  .description('Set the API base URL for current profile')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    console.log(chalk.green(`Base URL saved to profile: ${getActiveProfileName()}`));
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold('Current Configuration:'));
    console.log(chalk.gray('Profile:'), profile);
    console.log(chalk.gray('Config directory:'), getConfigDir());
    console.log(chalk.gray('API Key:'), apiKey ? '***configured***' : 'not set');
    console.log(chalk.gray('Base URL:'), baseUrl || '(default https://api.sticky-note.com/v1)');
  });

configCmd
  .command('clear')
  .description('Clear configuration for current profile')
  .action(() => {
    clearConfig();
    console.log(chalk.green('Configuration cleared.'));
  });

program
  .command('list-notes')
  .description('List notes')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options: { format: OutputFormat }) => {
    try {
      const client = getClient();
      const result = await client.listNotes();
      print(result, options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('create-note')
  .description('Create a note')
  .option('-t, --title <title>', 'Note title')
  .option('-c, --content <content>', 'Note content')
  .option('-b, --body <json>', 'Full note body as JSON object')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options: { title?: string; content?: string; body?: string; format: OutputFormat }) => {
    try {
      const client = getClient();
      const input = options.body
        ? parseJsonOption(options.body, 'body')
        : {
            ...(options.title ? { title: options.title } : {}),
            ...(options.content ? { content: options.content } : {}),
          };
      const result = await client.createNote(input);
      print(result, options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('get-note <noteId>')
  .description('Get a note by ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (noteId: string, options: { format: OutputFormat }) => {
    try {
      const client = getClient();
      const result = await client.getNote(noteId);
      print(result, options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('list-events')
  .description('List events')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options: { format: OutputFormat }) => {
    try {
      const client = getClient();
      const result = await client.listEvents();
      print(result, options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search notes and events')
  .option('-q, --query <query>', 'Search query')
  .option('-b, --body <json>', 'Full search body as JSON object')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options: { query?: string; body?: string; format: OutputFormat }) => {
    try {
      const client = getClient();
      const input = options.body
        ? parseJsonOption(options.body, 'body')
        : {
            ...(options.query ? { query: options.query } : {}),
          };
      const result = await client.search(input);
      print(result, options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send a raw API request')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-p, --path <path>', 'API path (default /notes)', '/notes')
  .option('-q, --query <json>', 'Query parameters as JSON object')
  .option('-b, --body <json>', 'Request body as JSON object')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .action(async (options: { method: string; path: string; query?: string; body?: string; format: OutputFormat }) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        method: options.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: options.path,
        query: options.query ? (parseJsonOption(options.query, 'query') as Record<string, string | number | boolean | undefined>) : undefined,
        body: options.body ? parseJsonOption(options.body, 'body') : undefined,
      });
      print(result, options.format);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

program
  .name('connect-sticky-note')
  .description('StickyNote connector - notes, events, search, and raw API access')
  .version('0.1.0')
  .option('--profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

program.addCommand(profileCmd);
program.addCommand(configCmd);

program.parse();
