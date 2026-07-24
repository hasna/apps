#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import type { RequestOptions } from '../api/client';
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
import type { ListParams } from '../types';

const CONNECTOR_NAME = 'connect-tave';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tave connector CLI - studio management CRM for photographers')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .option('--base-url <url>', 'Override the API base URL')
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
      process.env.TAVE_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.baseUrl) {
      process.env.TAVE_BASE_URL = opts.baseUrl;
      debug(`Base URL set from command line flag: ${opts.baseUrl}`);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TAVE_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: getBaseUrl() });
}

function listParams(opts: { limit?: string; page?: string; search?: string; status?: string }): ListParams {
  return {
    perPage: opts.limit ? parseInt(opts.limit, 10) : undefined,
    page: opts.page ? parseInt(opts.page, 10) : undefined,
    search: opts.search,
    status: opts.status,
  };
}

function addListOptions(cmd: Command): Command {
  return cmd
    .option('-l, --limit <number>', 'Max results per page')
    .option('--page <number>', 'Page number')
    .option('--search <query>', 'Search query')
    .option('--status <status>', 'Filter by status');
}

// ============================================
// Profile Commands
// ============================================
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
    profiles.forEach((p) => {
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
  .option('--base-url <url>', 'Base URL override')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://tave.io/v2)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <key>')
  .description('Set API key')
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL override')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
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
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://tave.io/v2)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Contacts Commands
// ============================================
const contactsCmd = program.command('contacts').description('Manage contacts');

addListOptions(contactsCmd.command('list').description('List contacts')).action(async (opts) => {
  try {
    const client = getClient();
    const result = await client.contacts.list(listParams(opts));
    print(result, getFormat(contactsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

contactsCmd
  .command('get <id>')
  .description('Get a contact by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.get(id);
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Jobs Commands
// ============================================
const jobsCmd = program.command('jobs').description('Manage jobs (shoots/projects)');

addListOptions(jobsCmd.command('list').description('List jobs')).action(async (opts) => {
  try {
    const client = getClient();
    const result = await client.jobs.list(listParams(opts));
    print(result, getFormat(jobsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

jobsCmd
  .command('get <id>')
  .description('Get a job by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.jobs.get(id);
      print(result, getFormat(jobsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Leads Commands
// ============================================
const leadsCmd = program.command('leads').description('Manage leads');

addListOptions(leadsCmd.command('list').description('List leads')).action(async (opts) => {
  try {
    const client = getClient();
    const result = await client.leads.list(listParams(opts));
    print(result, getFormat(leadsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

leadsCmd
  .command('get <id>')
  .description('Get a lead by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.leads.get(id);
      print(result, getFormat(leadsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadsCmd
  .command('create')
  .description('Create a new lead')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .option('--source <source>', 'Lead source')
  .option('--event-type <type>', 'Event/shoot type')
  .option('--event-date <date>', 'Event date')
  .option('--message <text>', 'Lead message/notes')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.leads.create({
        first_name: opts.firstName,
        last_name: opts.lastName,
        email: opts.email,
        phone: opts.phone,
        source: opts.source,
        event_type: opts.eventType,
        event_date: opts.eventDate,
        message: opts.message,
      });
      success('Lead created');
      print(result, getFormat(leadsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Orders Commands
// ============================================
const ordersCmd = program.command('orders').description('Manage orders/invoices');

addListOptions(ordersCmd.command('list').description('List orders')).action(async (opts) => {
  try {
    const client = getClient();
    const result = await client.orders.list(listParams(opts));
    print(result, getFormat(ordersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

ordersCmd
  .command('get <id>')
  .description('Get an order by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.orders.get(id);
      print(result, getFormat(ordersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Raw Commands (escape hatch for any endpoint)
// ============================================
const rawCmd = program.command('raw').description('Call any Tave API endpoint directly');

rawCmd
  .command('request <path>')
  .description('Make a raw request to an API path (e.g. /contacts)')
  .option('-X, --method <method>', 'HTTP method (GET, POST, PUT, DELETE)', 'GET')
  .option('-d, --data <json>', 'Request body as JSON string')
  .action(async (path: string, opts) => {
    try {
      const client = getClient();
      const options: RequestOptions = { method: (opts.method || 'GET').toUpperCase() };
      if (opts.data) {
        try {
          options.body = JSON.parse(opts.data);
        } catch {
          error('Invalid JSON in --data');
          process.exit(1);
        }
      }
      const result = await client.raw.request(path, options);
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
