#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TicketSource } from '../api';
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

const CONNECTOR_NAME = 'connect-ticketsource';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TicketSource connector CLI - event ticketing and booking API')
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
      process.env.TICKETSOURCE_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TicketSource {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TICKETSOURCE_API_KEY.`);
    process.exit(1);
  }
  return new TicketSource({ apiKey });
}

function parseQueryOptions(opts: Record<string, unknown>): Record<string, string | number | undefined> {
  const query: Record<string, string | number | undefined> = {};
  if (opts.page !== undefined) query.page = Number(opts.page);
  if (opts.limit !== undefined) query.limit = Number(opts.limit);
  if (typeof opts.query === 'string') {
    for (const pair of opts.query.split(',')) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) query[key.trim()] = value.trim();
    }
  }
  return query;
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
    const active = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

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
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const eventsCmd = program
  .command('events')
  .description('Event commands');

eventsCmd
  .command('list')
  .description('List events')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .option('--query <pairs>', 'Extra query params as key=value,key=value')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents(parseQueryOptions(opts));
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('get <eventId>')
  .description('Get event by ID')
  .option('--query <pairs>', 'Extra query params as key=value,key=value')
  .action(async (eventId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getEvent(eventId, parseQueryOptions(opts));
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('venues <eventId>')
  .description('List venues for an event')
  .option('--query <pairs>', 'Extra query params as key=value,key=value')
  .action(async (eventId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listEventVenues(eventId, parseQueryOptions(opts));
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('dates <eventId>')
  .description('List dates for an event')
  .option('--query <pairs>', 'Extra query params as key=value,key=value')
  .action(async (eventId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listEventDates(eventId, parseQueryOptions(opts));
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const venuesCmd = program
  .command('venues')
  .description('Venue commands');

venuesCmd
  .command('dates <venueId>')
  .description('List dates for a venue')
  .option('--query <pairs>', 'Extra query params as key=value,key=value')
  .action(async (venueId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listVenueDates(venueId, parseQueryOptions(opts));
      print(result, getFormat(venuesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const customersCmd = program
  .command('customers')
  .description('Customer commands');

customersCmd
  .command('list')
  .description('List customers')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .option('--query <pairs>', 'Extra query params as key=value,key=value')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listCustomers(parseQueryOptions(opts));
      print(result, getFormat(customersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

customersCmd
  .command('get <customerId>')
  .description('Get customer by ID')
  .option('--query <pairs>', 'Extra query params as key=value,key=value')
  .action(async (customerId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getCustomer(customerId, parseQueryOptions(opts));
      print(result, getFormat(customersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const bookingsCmd = program
  .command('bookings')
  .description('Booking commands');

bookingsCmd
  .command('list')
  .description('List bookings')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .option('--query <pairs>', 'Extra query params as key=value,key=value')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listBookings(parseQueryOptions(opts));
      print(result, getFormat(bookingsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
