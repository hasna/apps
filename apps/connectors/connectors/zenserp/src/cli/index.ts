#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Zenserp } from '../api';
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
  clearConfig,
  getConfigDir,
  getBaseConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
} from '../utils/config';
import type { SearchParams } from '../types';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-zenserp';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zenserp SERP API connector CLI')
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
      process.env.ZENSERP_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Zenserp {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ZENSERP_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Zenserp({ apiKey, baseUrl: getBaseUrl() });
}

function searchOptions(opts: Record<string, string | undefined>): SearchParams {
  return {
    engine: opts.engine as SearchParams['engine'],
    location: opts.location,
    hl: opts.hl,
    gl: opts.gl,
    device: opts.device as SearchParams['device'],
    num: opts.num ? parseInt(opts.num, 10) : undefined,
    start: opts.start ? parseInt(opts.start, 10) : undefined,
  };
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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, { apiKey: opts.apiKey });
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
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
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    console.log();
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);
    console.log();
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://app.zenserp.com/api/v2)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const searchCmd = program.command('search').description('Google/web search');

searchCmd
  .command('query <query>')
  .description('Perform a SERP search')
  .option('-e, --engine <engine>', 'Search engine (google, bing, yandex)', 'google')
  .option('-l, --location <location>', 'Search location')
  .option('--hl <code>', 'Interface language')
  .option('--gl <code>', 'Country code')
  .option('-d, --device <device>', 'Device type (desktop, mobile, tablet)')
  .option('-n, --num <number>', 'Number of results')
  .option('-s, --start <offset>', 'Result offset')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.search.search({ q: query, ...searchOptions(opts) });
      print(result, getFormat(searchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const imageCmd = program.command('image').description('Image search');

imageCmd
  .command('query <query>')
  .description('Search Google Images')
  .option('-e, --engine <engine>', 'Search engine', 'google')
  .option('-l, --location <location>', 'Search location')
  .option('--hl <code>', 'Interface language')
  .option('--gl <code>', 'Country code')
  .option('-d, --device <device>', 'Device type')
  .option('-n, --num <number>', 'Number of results')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.search.imageSearch({ q: query, ...searchOptions(opts) });
      print(result, getFormat(imageCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const mapCmd = program.command('map').description('Map/local search');

mapCmd
  .command('query <query>')
  .description('Search Google Maps')
  .option('-l, --location <location>', 'Search location')
  .option('--hl <code>', 'Interface language')
  .option('--gl <code>', 'Country code')
  .option('-n, --num <number>', 'Number of results')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.search.mapSearch({ q: query, ...searchOptions(opts) });
      print(result, getFormat(mapCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const reverseImageCmd = program.command('reverse-image').description('Reverse image search');

reverseImageCmd
  .command('lookup <imageUrl>')
  .description('Reverse image search by URL')
  .option('-l, --location <location>', 'Search location')
  .option('--hl <code>', 'Interface language')
  .option('--gl <code>', 'Country code')
  .action(async (imageUrl: string, opts) => {
    try {
      const client = getClient();
      const result = await client.search.reverseImageSearch({
        image_url: imageUrl,
        location: opts.location,
        hl: opts.hl,
        gl: opts.gl,
      });
      print(result, getFormat(reverseImageCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Raw API request');

rawCmd
  .command('get <path>')
  .description('Make a raw GET request to a Zenserp API path')
  .option('-q, --query <query>', 'Search query (q param)')
  .option('-e, --engine <engine>', 'Search engine')
  .option('-l, --location <location>', 'Search location')
  .option('--tbm <type>', 'Search type (isch, map, nws, shop, vid)')
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.query) params.q = opts.query;
      if (opts.engine) params.engine = opts.engine;
      if (opts.location) params.location = opts.location;
      if (opts.tbm) params.tbm = opts.tbm;

      const result = await client.search.rawRequest(path, params);
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
