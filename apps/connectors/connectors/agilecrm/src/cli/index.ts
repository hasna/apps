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
  getApiSecret,
  setApiSecret,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-agilecrm';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Agile CRM API connector CLI')
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
      process.env.AGILECRM_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  const email = getApiSecret(); // email stored as apiSecret
  const profile = loadProfile();
  const domain = (profile as Record<string, unknown>).domain as string | undefined;

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set AGILECRM_API_KEY environment variable.`);
    process.exit(1);
  }
  if (!email) {
    error(`No email configured. Run "${CONNECTOR_NAME} config set-email <email>" or set AGILECRM_EMAIL environment variable.`);
    process.exit(1);
  }
  if (!domain) {
    error(`No domain configured. Run "${CONNECTOR_NAME} config set-domain <domain>" to set your Agile CRM subdomain.`);
    process.exit(1);
  }
  return new Connector({ apiKey, email, domain });
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

    createProfile(name, {
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
    const profileData = config as Record<string, unknown>;

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Email: ${config.apiSecret || chalk.gray('not set')}`);
    info(`Domain: ${(profileData.domain as string) || chalk.gray('not set')}`);
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
  .command('set-email <email>')
  .description('Set account email (used for Basic Auth)')
  .action((email: string) => {
    setApiSecret(email);
    success(`Email saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-domain <domain>')
  .description('Set Agile CRM subdomain (e.g., "mycompany" for mycompany.agilecrm.com)')
  .action((domain: string) => {
    const config = loadProfile();
    (config as Record<string, unknown>).domain = domain;
    const { saveProfile } = require('../utils/config');
    saveProfile(config);
    success(`Domain "${domain}" saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const email = getApiSecret();
    const profile = loadProfile();
    const domain = (profile as Record<string, unknown>).domain as string | undefined;

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Email: ${email || chalk.gray('not set')}`);
    info(`Domain: ${domain || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Contact Commands
// ============================================
const contactCmd = program
  .command('contact')
  .description('Manage contacts');

contactCmd
  .command('list')
  .description('List contacts')
  .option('--page-size <n>', 'Results per page', '20')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.list({
        page_size: parseInt(opts.pageSize),
        cursor: opts.cursor,
      });
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('get <id>')
  .description('Get a contact by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.get(parseInt(id));
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('search-email <email>')
  .description('Search contact by email')
  .action(async (email: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.getByEmail(email);
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('search <query>')
  .description('Search contacts')
  .action(async (query: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.search(query);
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('delete <id>')
  .description('Delete a contact')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.contacts.delete(parseInt(id));
      success(`Contact ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('companies')
  .description('List all companies')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.contacts.listCompanies();
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Deal Commands
// ============================================
const dealCmd = program
  .command('deal')
  .description('Manage deals');

dealCmd
  .command('list')
  .description('List deals')
  .option('--page-size <n>', 'Results per page', '20')
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.deals.list({
        page_size: parseInt(opts.pageSize),
        cursor: opts.cursor,
      });
      print(result, getFormat(dealCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealCmd
  .command('get <id>')
  .description('Get a deal by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.deals.get(parseInt(id));
      print(result, getFormat(dealCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealCmd
  .command('create')
  .description('Create a deal')
  .requiredOption('--name <name>', 'Deal name')
  .requiredOption('--milestone <milestone>', 'Deal milestone/stage')
  .option('--value <value>', 'Expected value')
  .option('--probability <pct>', 'Win probability (0-100)')
  .option('--contact-ids <ids>', 'Contact IDs (comma-separated)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.deals.create({
        name: opts.name,
        milestone: opts.milestone,
        expected_value: opts.value ? parseFloat(opts.value) : undefined,
        probability: opts.probability ? parseInt(opts.probability) : undefined,
        contact_ids: opts.contactIds ? opts.contactIds.split(',').map(Number) : undefined,
      });
      success('Deal created');
      print(result, getFormat(dealCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealCmd
  .command('delete <id>')
  .description('Delete a deal')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deals.delete(parseInt(id));
      success(`Deal ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealCmd
  .command('by-contact <contactId>')
  .description('List deals for a contact')
  .action(async (contactId: string) => {
    try {
      const client = getClient();
      const result = await client.deals.getByContact(parseInt(contactId));
      print(result, getFormat(dealCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealCmd
  .command('my-deals')
  .description('List your deals')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.deals.getMyDeals();
      print(result, getFormat(dealCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Task Commands
// ============================================
const taskCmd = program
  .command('task')
  .description('Manage tasks');

taskCmd
  .command('list')
  .description('List all tasks')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.tasks.list();
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('get <id>')
  .description('Get a task by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.tasks.get(parseInt(id));
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('create')
  .description('Create a task')
  .requiredOption('--subject <text>', 'Task subject')
  .requiredOption('--type <type>', 'Task type (CALL, EMAIL, FOLLOW_UP, MEETING, MILESTONE, SEND, TWEET, OTHER)')
  .requiredOption('--due <timestamp>', 'Due date (Unix timestamp in ms)')
  .option('--priority <priority>', 'Priority (HIGH, NORMAL, LOW)', 'NORMAL')
  .option('--description <text>', 'Description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.create({
        subject: opts.subject,
        type: opts.type,
        due: parseInt(opts.due),
        priority_type: opts.priority,
        description: opts.description,
      });
      success('Task created');
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('delete <id>')
  .description('Delete a task')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.tasks.delete(parseInt(id));
      success(`Task ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

taskCmd
  .command('pending <days>')
  .description('List pending tasks for next N days')
  .action(async (days: string) => {
    try {
      const client = getClient();
      const result = await client.tasks.getPending(parseInt(days));
      print(result, getFormat(taskCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Note Commands
// ============================================
const noteCmd = program
  .command('note')
  .description('Manage notes');

noteCmd
  .command('by-contact <contactId>')
  .description('List notes for a contact')
  .action(async (contactId: string) => {
    try {
      const client = getClient();
      const result = await client.notes.getByContact(parseInt(contactId));
      print(result, getFormat(noteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

noteCmd
  .command('by-deal <dealId>')
  .description('List notes for a deal')
  .action(async (dealId: string) => {
    try {
      const client = getClient();
      const result = await client.notes.getByDeal(parseInt(dealId));
      print(result, getFormat(noteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

noteCmd
  .command('create')
  .description('Create a note')
  .requiredOption('--subject <text>', 'Note subject')
  .requiredOption('--description <text>', 'Note description')
  .option('--contact-ids <ids>', 'Contact IDs (comma-separated)')
  .option('--deal-ids <ids>', 'Deal IDs (comma-separated)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.notes.create({
        subject: opts.subject,
        description: opts.description,
        contact_ids: opts.contactIds ? opts.contactIds.split(',').map(Number) : undefined,
        deal_ids: opts.dealIds ? opts.dealIds.split(',').map(Number) : undefined,
      });
      success('Note created');
      print(result, getFormat(noteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
