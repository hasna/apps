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

const CONNECTOR_NAME = 'connect-ticketmaster';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Ticketmaster Discovery API connector CLI')
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
      process.env.TICKETMASTER_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TICKETMASTER_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
}

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
    const apiKey = config.apiKey || config.token;

    console.log(`Profile: ${profileName}`);
    console.log(`API Key: ${apiKey ? `${apiKey.substring(0, 6)}...` : '(not set)'}`);
  });

const configCmd = program
  .command('config')
  .description('Manage connector configuration');

configCmd
  .command('set-key <key>')
  .description('Set the Ticketmaster API key for the current profile')
  .action((key: string) => {
    setApiKey(key);
    success('API key saved');
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const apiKey = getApiKey();
    console.log(`Profile: ${profile}`);
    console.log(`Config dir: ${getConfigDir()}`);
    console.log(`API Key: ${apiKey ? `${apiKey.substring(0, 6)}...` : '(not set)'}`);
  });

configCmd
  .command('clear')
  .description('Clear current profile configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

const eventsCmd = program
  .command('events')
  .description('Search and retrieve events');

eventsCmd
  .command('search')
  .description('Search events')
  .option('--keyword <keyword>', 'Search keyword')
  .option('--countryCode <code>', 'Country code (e.g. US)')
  .option('--stateCode <code>', 'State code (e.g. CA)')
  .option('--city <city>', 'City name')
  .option('--startDateTime <datetime>', 'Start date-time (ISO 8601)')
  .option('--endDateTime <datetime>', 'End date-time (ISO 8601)')
  .option('--classificationName <name>', 'Classification name')
  .option('--venueId <id>', 'Filter by venue ID')
  .option('--attractionId <id>', 'Filter by attraction ID')
  .option('--size <size>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '0')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.events.search({
        keyword: opts.keyword,
        countryCode: opts.countryCode,
        stateCode: opts.stateCode,
        city: opts.city,
        startDateTime: opts.startDateTime,
        endDateTime: opts.endDateTime,
        classificationName: opts.classificationName,
        venueId: opts.venueId,
        attractionId: opts.attractionId,
        size: parseInt(opts.size, 10),
        page: parseInt(opts.page, 10),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('get <id>')
  .description('Get event by ID')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.events.get(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const attractionsCmd = program
  .command('attractions')
  .description('Search and retrieve attractions');

attractionsCmd
  .command('search')
  .description('Search attractions')
  .option('--keyword <keyword>', 'Search keyword')
  .option('--classificationName <name>', 'Classification name')
  .option('--size <size>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '0')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.attractions.search({
        keyword: opts.keyword,
        classificationName: opts.classificationName,
        size: parseInt(opts.size, 10),
        page: parseInt(opts.page, 10),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

attractionsCmd
  .command('get <id>')
  .description('Get attraction by ID')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.attractions.get(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const venuesCmd = program
  .command('venues')
  .description('Search and retrieve venues');

venuesCmd
  .command('search')
  .description('Search venues')
  .option('--keyword <keyword>', 'Search keyword')
  .option('--countryCode <code>', 'Country code (e.g. US)')
  .option('--stateCode <code>', 'State code (e.g. CA)')
  .option('--city <city>', 'City name')
  .option('--size <size>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '0')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.venues.search({
        keyword: opts.keyword,
        countryCode: opts.countryCode,
        stateCode: opts.stateCode,
        city: opts.city,
        size: parseInt(opts.size, 10),
        page: parseInt(opts.page, 10),
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

venuesCmd
  .command('get <id>')
  .description('Get venue by ID')
  .action(async (id: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.venues.get(id);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
