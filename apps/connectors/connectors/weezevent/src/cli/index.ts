#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { WeezeventConnector } from '../api';
import {
  getApiKey,
  getAccessToken,
  setApiKey,
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
  getBaseUrl,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-weezevent';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Weezevent API connector - event ticketing and participant management')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('--access-token <token>', 'Access token (overrides config)')
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
      process.env.WEEZEVENT_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.accessToken) {
      process.env.WEEZEVENT_ACCESS_TOKEN = opts.accessToken;
      debug('Access token set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WeezeventConnector {
  const apiKey = getApiKey();
  const accessToken = getAccessToken();
  if (!apiKey || !accessToken) {
    error(
      `Weezevent requires both API key and access token. Run "${CONNECTOR_NAME} config set-key <key>" and "${CONNECTOR_NAME} config set-access-token <token>", or set WEEZEVENT_API_KEY and WEEZEVENT_ACCESS_TOKEN.`,
    );
    process.exit(1);
  }
  return new WeezeventConnector({ apiKey, accessToken, baseUrl: getBaseUrl() });
}

function parseList(value: string): string[] {
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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
  .option('--access-token <token>', 'Access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, accessToken: opts.accessToken });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-access-token <token>').description('Set access token').action((token: string) => {
  setAccessToken(token);
  success(`Access token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  const accessToken = getAccessToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const authCmd = program.command('auth').description('Obtain an access token');

authCmd
  .command('token')
  .description('Exchange username/password for an access token')
  .requiredOption('-u, --username <username>', 'Weezevent organizer or partner login')
  .requiredOption('-w, --password <password>', 'Weezevent password')
  .option('-k, --api-key <key>', 'API key (defaults to configured key)')
  .action(async (opts) => {
    try {
      const apiKey = opts.apiKey || getApiKey();
      if (!apiKey) {
        error('API key is required. Use -k or config set-key.');
        process.exit(1);
      }
      const connector = new WeezeventConnector({ apiKey, accessToken: 'placeholder', baseUrl: getBaseUrl() });
      const result = await connector.exchangeAccessToken({
        username: opts.username,
        password: opts.password,
        apiKey,
      });
      setAccessToken(result.accessToken);
      success('Access token obtained and saved to active profile');
      print(result, getFormat(authCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Event operations');

eventsCmd
  .command('list')
  .description('List events accessible to the current user')
  .option('--include-closed', 'Include closed events')
  .option('--include-not-published', 'Include unpublished events')
  .option('--include-without-sales', 'Include events without ticket sales')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listEvents({
        include_closed: opts.includeClosed || undefined,
        include_not_published: opts.includeNotPublished || undefined,
        include_without_sales: opts.includeWithoutSales || undefined,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('details <eventId>')
  .description('Get details for a specific event')
  .action(async (eventId: string) => {
    try {
      const client = getClient();
      const result = await client.getEventDetails(eventId);
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('search')
  .description('Search partner calendar events')
  .option('--date <date>', 'Single date filter')
  .option('--date-start <date>', 'Period start date')
  .option('--date-end <date>', 'Period end date')
  .option('--category <id>', 'Category ID')
  .option('--city <city>', 'City name')
  .option('--zip-code <zip>', 'Postal code')
  .option('--country <code>', 'Country ISO code')
  .option('--province <province>', 'Province')
  .option('--organizer <name>', 'Organizer name')
  .option('--max-result <n>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.searchEvents({
        date: opts.date,
        date_start: opts.dateStart,
        date_end: opts.dateEnd,
        category: opts.category ? Number(opts.category) : undefined,
        city: opts.city,
        zip_code: opts.zipCode,
        country: opts.country,
        province: opts.province,
        organizer: opts.organizer,
        max_result: opts.maxResult ? Number(opts.maxResult) : undefined,
      });
      print(result, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const datesCmd = program.command('dates').description('Event date operations');

datesCmd
  .command('list')
  .description('List dates for one or more events')
  .requiredOption('-e, --event <ids>', 'Comma-separated event IDs')
  .option('--display-passed', 'Include passed dates')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listDates({
        id_event: parseList(opts.event),
        display_passed: opts.displayPassed || undefined,
      });
      print(result, getFormat(datesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const ticketsCmd = program.command('tickets').description('Ticket operations');

ticketsCmd
  .command('list')
  .description('List ticket price categories for events')
  .requiredOption('-e, --event <ids>', 'Comma-separated event IDs')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTickets({ id_event: parseList(opts.event) });
      print(result, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('stats <ticketId>')
  .description('Get scan statistics for a ticket price category')
  .option('--date-id <id>', 'Date ID filter')
  .action(async (ticketId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getTicketStats(ticketId, {
        id_date: opts.dateId,
      });
      print(result, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const participantsCmd = program.command('participants').description('Participant operations');

participantsCmd
  .command('list')
  .description('List participants')
  .option('-e, --event <ids>', 'Comma-separated event IDs')
  .option('-t, --ticket <ids>', 'Comma-separated ticket IDs')
  .option('--full', 'Include full inscription form answers')
  .option('--include-deleted', 'Include deleted participants')
  .option('--include-unpaid', 'Include unpaid participants')
  .option('--page <n>', 'Page number')
  .option('--max <n>', 'Max results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listParticipants({
        id_event: opts.event ? parseList(opts.event) : undefined,
        id_ticket: opts.ticket ? parseList(opts.ticket) : undefined,
        full: opts.full || undefined,
        include_deleted: opts.includeDeleted || undefined,
        include_unpaid: opts.includeUnpaid || undefined,
        page: opts.page ? Number(opts.page) : undefined,
        max: opts.max ? Number(opts.max) : undefined,
      });
      print(result, getFormat(participantsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

participantsCmd
  .command('answers <participantId>')
  .description('Get inscription form answers for a participant')
  .action(async (participantId: string) => {
    try {
      const client = getClient();
      const result = await client.getParticipantAnswers(participantId);
      print(result, getFormat(participantsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
