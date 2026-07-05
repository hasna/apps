#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
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

const CONNECTOR_NAME = 'connect-wideframe';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wideframe API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.WIDEFRAME_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WIDEFRAME_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

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

    success('Profiles:');
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
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.wideframe.com/v1)')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <baseUrl>')
  .description('Set API base URL')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.wideframe.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const librariesCmd = program.command('libraries').description('Manage Wideframe footage libraries');

librariesCmd
  .command('list')
  .description('List footage libraries')
  .option('--status <status>', 'Filter by library status')
  .action(async (opts, cmd) => {
    const client = getClient();
    const args: Record<string, unknown> = {};
    if (opts.status) {
      args.query = { status: opts.status };
    }
    const result = await client.wideframe.listLibraries(args);
    print(result, getFormat(cmd));
  });

librariesCmd
  .command('get <libraryId>')
  .description('Get a footage library')
  .action(async (libraryId: string, _opts, cmd) => {
    const client = getClient();
    const result = await client.wideframe.getLibrary(libraryId);
    print(result, getFormat(cmd));
  });

const indexJobsCmd = program.command('index-jobs').description('Manage footage index jobs');

indexJobsCmd
  .command('create <libraryId>')
  .description('Create an index job for a library')
  .option('--folder-path <path>', 'Folder path to index')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (libraryId: string, opts, cmd) => {
    const client = getClient();
    const args: Record<string, unknown> = {
      ...parseJsonOption(opts.body, '--body'),
    };
    if (opts.folderPath) {
      args.folder_path = opts.folderPath;
    }
    const result = await client.wideframe.createIndexJob(libraryId, args);
    print(result, getFormat(cmd));
  });

indexJobsCmd
  .command('get <jobId>')
  .description('Get an index job')
  .action(async (jobId: string, _opts, cmd) => {
    const client = getClient();
    const result = await client.wideframe.getIndexJob(jobId);
    print(result, getFormat(cmd));
  });

program
  .command('search <libraryId>')
  .description('Search indexed footage in a library')
  .option('--search-text <text>', 'Semantic search query')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (libraryId: string, opts, cmd) => {
    const client = getClient();
    const args: Record<string, unknown> = {
      ...parseJsonOption(opts.body, '--body'),
    };
    if (opts.searchText) {
      args.search_text = opts.searchText;
    }
    if (opts.tags) {
      args.tags = opts.tags.split(',').map((t: string) => t.trim());
    }
    const result = await client.wideframe.searchFootage(libraryId, args);
    print(result, getFormat(cmd));
  });

const sequencesCmd = program.command('sequences').description('Manage rough-cut sequences');

sequencesCmd
  .command('create')
  .description('Create a rough-cut sequence')
  .option('--library-id <id>', 'Source library ID')
  .option('--brief <text>', 'Creative brief for the sequence')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (opts, cmd) => {
    const client = getClient();
    const args: Record<string, unknown> = {
      ...parseJsonOption(opts.body, '--body'),
    };
    if (opts.libraryId) {
      args.libraryId = opts.libraryId;
    }
    if (opts.brief) {
      args.brief = opts.brief;
    }
    const result = await client.wideframe.createSequence(args);
    print(result, getFormat(cmd));
  });

sequencesCmd
  .command('export-premiere <sequenceId>')
  .description('Export a sequence to Adobe Premiere Pro')
  .option('--format <format>', 'Export format (e.g. prproj)')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (sequenceId: string, opts, cmd) => {
    const client = getClient();
    const args: Record<string, unknown> = {
      ...parseJsonOption(opts.body, '--body'),
    };
    if (opts.format) {
      args.format = opts.format;
    }
    const result = await client.wideframe.exportPremiereProject(sequenceId, args);
    print(result, getFormat(cmd));
  });

program
  .command('raw-request')
  .description('Call any Wideframe API path')
  .option('--path <path>', 'API path (default: /libraries)', '/libraries')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'JSON request body')
  .option('--query <json>', 'JSON query parameters')
  .action(async (opts, cmd) => {
    const client = getClient();
    const result = await client.wideframe.rawRequest({
      path: opts.path,
      method: opts.method,
      body: parseJsonOption(opts.body, '--body'),
      query: parseJsonOption(opts.query, '--query') as Record<string, string | number | boolean | undefined>,
    });
    print(result, getFormat(cmd));
  });

program.parse();
