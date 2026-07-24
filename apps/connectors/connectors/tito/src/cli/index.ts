#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Tito } from '../api';
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

const CONNECTOR_NAME = 'connect-tito';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tito connector CLI - event registrations, tickets, releases, and check-in lists')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
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
      process.env.TITO_API_TOKEN = opts.apiKey;
      debug('API token set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Tito {
  const apiToken = getApiKey();
  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set TITO_API_TOKEN.`);
    process.exit(1);
  }
  return new Tito({ apiToken });
}

function requireEventFlags(opts: { account?: string; event?: string }): { accountSlug: string; eventSlug: string } {
  if (!opts.account || !opts.event) {
    error('Both --account and --event are required for event-scoped commands.');
    process.exit(1);
  }
  return { accountSlug: opts.account, eventSlug: opts.event };
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
  .option('--api-key <key>', 'API token')
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
    info(`API Token: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiToken>')
  .description('Set API token')
  .action((apiToken: string) => {
    setApiKey(apiToken);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiToken = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Token: ${apiToken ? `${apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program
  .command('hello')
  .description('Verify API token and list accessible accounts')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.hello();
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const ticketsCmd = program.command('tickets').description('Manage event tickets');

ticketsCmd
  .command('list')
  .description('List tickets for an event')
  .requiredOption('--account <slug>', 'Tito account slug')
  .requiredOption('--event <slug>', 'Event slug')
  .action(async (opts) => {
    try {
      const client = getClient();
      const scope = requireEventFlags(opts);
      const result = await client.listTickets(scope);
      print(result, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('get <ticketSlug>')
  .description('Get a ticket by slug')
  .requiredOption('--account <slug>', 'Tito account slug')
  .requiredOption('--event <slug>', 'Event slug')
  .action(async (ticketSlug: string, opts) => {
    try {
      const client = getClient();
      const scope = requireEventFlags(opts);
      const result = await client.getTicket(scope, ticketSlug);
      print(result, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const registrationsCmd = program.command('registrations').description('Manage event registrations');

registrationsCmd
  .command('list')
  .description('List registrations for an event')
  .requiredOption('--account <slug>', 'Tito account slug')
  .requiredOption('--event <slug>', 'Event slug')
  .action(async (opts) => {
    try {
      const client = getClient();
      const scope = requireEventFlags(opts);
      const result = await client.listRegistrations(scope);
      print(result, getFormat(registrationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

registrationsCmd
  .command('get <registrationSlug>')
  .description('Get a registration by slug')
  .requiredOption('--account <slug>', 'Tito account slug')
  .requiredOption('--event <slug>', 'Event slug')
  .action(async (registrationSlug: string, opts) => {
    try {
      const client = getClient();
      const scope = requireEventFlags(opts);
      const result = await client.getRegistration(scope, registrationSlug);
      print(result, getFormat(registrationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const releasesCmd = program.command('releases').description('Manage event ticket releases');

releasesCmd
  .command('list')
  .description('List releases for an event')
  .requiredOption('--account <slug>', 'Tito account slug')
  .requiredOption('--event <slug>', 'Event slug')
  .action(async (opts) => {
    try {
      const client = getClient();
      const scope = requireEventFlags(opts);
      const result = await client.listReleases(scope);
      print(result, getFormat(releasesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const checkinListsCmd = program.command('checkin-lists').description('Manage event check-in lists');

checkinListsCmd
  .command('list')
  .description('List check-in lists for an event')
  .requiredOption('--account <slug>', 'Tito account slug')
  .requiredOption('--event <slug>', 'Event slug')
  .action(async (opts) => {
    try {
      const client = getClient();
      const scope = requireEventFlags(opts);
      const result = await client.listCheckinLists(scope);
      print(result, getFormat(checkinListsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
