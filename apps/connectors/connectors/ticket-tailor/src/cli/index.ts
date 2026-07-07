#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TicketTailor } from '../api';
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

const CONNECTOR_NAME = 'connect-ticket-tailor';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Ticket Tailor connector CLI - event ticketing API with multi-profile support')
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
      process.env.TICKET_TAILOR_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TicketTailor {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TICKET_TAILOR_API_KEY environment variable.`);
    process.exit(1);
  }
  return new TicketTailor({ apiKey });
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

// ============================================
// API Commands
// ============================================
program
  .command('ping')
  .description('Verify API connectivity')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.ping();
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('overview')
  .description('Get account overview')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getOverview();
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program
  .command('events')
  .description('Event commands');

eventsCmd
  .command('list')
  .description('List events')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {};
      if (opts.page) params.page = parseInt(opts.page, 10);
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      const result = await client.listEvents(params);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('get <id>')
  .description('Get event by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getEvent(id);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const ordersCmd = program
  .command('orders')
  .description('Order commands');

ordersCmd
  .command('list')
  .description('List orders')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {};
      if (opts.page) params.page = parseInt(opts.page, 10);
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      const result = await client.listOrders(params);
      print(result, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ordersCmd
  .command('get <id>')
  .description('Get order by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getOrder(id);
      print(result, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const ticketsCmd = program
  .command('issued-tickets')
  .description('Issued ticket commands');

ticketsCmd
  .command('list')
  .description('List issued tickets')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {};
      if (opts.page) params.page = parseInt(opts.page, 10);
      if (opts.limit) params.limit = parseInt(opts.limit, 10);
      const result = await client.listIssuedTickets(params);
      print(result, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('get <id>')
  .description('Get issued ticket by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getIssuedTicket(id);
      print(result, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
