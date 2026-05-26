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
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-accelo';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Accelo connector CLI - professional services automation')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Access token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .option('-d, --deployment <name>', 'Accelo deployment name (subdomain)')
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
      process.env.ACCELO_ACCESS_TOKEN = opts.apiKey;
      debug('Access token set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set ACCELO_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  const deployment = program.opts().deployment || process.env.ACCELO_DEPLOYMENT;
  return new Connector({ apiKey, deployment });
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
  .option('--api-key <key>', 'Access token')
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

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Access Token: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <token>')
  .description('Set access token')
  .action((token: string) => {
    setApiKey(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Companies Commands
// ============================================
const companiesCmd = program
  .command('companies')
  .description('Manage companies');

companiesCmd
  .command('list')
  .description('List companies')
  .option('-l, --limit <number>', 'Max results per page', '10')
  .option('--page <number>', 'Page number (0-indexed)', '0')
  .option('--search <query>', 'Search query')
  .option('--fields <fields>', 'Fields to return')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.companies.list({
        _limit: parseInt(opts.limit),
        _page: parseInt(opts.page),
        _search: opts.search,
        _fields: opts.fields,
      });
      print(result, getFormat(companiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companiesCmd
  .command('get <id>')
  .description('Get a company by ID')
  .option('--fields <fields>', 'Fields to return')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.companies.get(id, opts.fields);
      print(result, getFormat(companiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companiesCmd
  .command('create')
  .description('Create a new company')
  .requiredOption('-n, --name <name>', 'Company name')
  .option('-w, --website <url>', 'Website URL')
  .option('--phone <phone>', 'Phone number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.companies.create({
        name: opts.name,
        website: opts.website,
        phone: opts.phone,
      });
      success('Company created');
      print(result, getFormat(companiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Contacts Commands
// ============================================
const contactsCmd = program
  .command('contacts')
  .description('Manage contacts');

contactsCmd
  .command('list')
  .description('List contacts')
  .option('-l, --limit <number>', 'Max results per page', '10')
  .option('--page <number>', 'Page number (0-indexed)', '0')
  .option('--search <query>', 'Search query')
  .option('--fields <fields>', 'Fields to return')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.list({
        _limit: parseInt(opts.limit),
        _page: parseInt(opts.page),
        _search: opts.search,
        _fields: opts.fields,
      });
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('get <id>')
  .description('Get a contact by ID')
  .option('--fields <fields>', 'Fields to return')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.get(id, opts.fields);
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('create')
  .description('Create a new contact')
  .requiredOption('--firstname <name>', 'First name')
  .requiredOption('--surname <name>', 'Surname')
  .option('--email <email>', 'Email address')
  .option('--phone <phone>', 'Phone number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.create({
        firstname: opts.firstname,
        surname: opts.surname,
        email: opts.email,
        phone: opts.phone,
      });
      success('Contact created');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Tasks Commands
// ============================================
const tasksCmd = program
  .command('tasks')
  .description('Manage tasks');

tasksCmd
  .command('list')
  .description('List tasks')
  .option('-l, --limit <number>', 'Max results per page', '10')
  .option('--page <number>', 'Page number (0-indexed)', '0')
  .option('--search <query>', 'Search query')
  .option('--fields <fields>', 'Fields to return')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.list({
        _limit: parseInt(opts.limit),
        _page: parseInt(opts.page),
        _search: opts.search,
        _fields: opts.fields,
      });
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('get <id>')
  .description('Get a task by ID')
  .option('--fields <fields>', 'Fields to return')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.get(id, opts.fields);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('create')
  .description('Create a new task')
  .requiredOption('-t, --title <title>', 'Task title')
  .requiredOption('--against-type <type>', 'Object type (e.g., job, issue)')
  .requiredOption('--against-id <id>', 'Object ID')
  .option('--description <text>', 'Task description')
  .option('--date-due <timestamp>', 'Due date (Unix timestamp)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.create({
        title: opts.title,
        against_type: opts.againstType,
        against_id: opts.againstId,
        description: opts.description,
        date_due: opts.dateDue,
      });
      success('Task created');
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Issues (Tickets) Commands
// ============================================
const issuesCmd = program
  .command('issues')
  .description('Manage support tickets');

issuesCmd
  .command('list')
  .description('List issues')
  .option('-l, --limit <number>', 'Max results per page', '10')
  .option('--page <number>', 'Page number (0-indexed)', '0')
  .option('--search <query>', 'Search query')
  .option('--fields <fields>', 'Fields to return')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.issues.list({
        _limit: parseInt(opts.limit),
        _page: parseInt(opts.page),
        _search: opts.search,
        _fields: opts.fields,
      });
      print(result, getFormat(issuesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issuesCmd
  .command('get <id>')
  .description('Get an issue by ID')
  .option('--fields <fields>', 'Fields to return')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.issues.get(id, opts.fields);
      print(result, getFormat(issuesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Jobs (Projects) Commands
// ============================================
const jobsCmd = program
  .command('jobs')
  .description('Manage projects');

jobsCmd
  .command('list')
  .description('List jobs/projects')
  .option('-l, --limit <number>', 'Max results per page', '10')
  .option('--page <number>', 'Page number (0-indexed)', '0')
  .option('--search <query>', 'Search query')
  .option('--fields <fields>', 'Fields to return')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.jobs.list({
        _limit: parseInt(opts.limit),
        _page: parseInt(opts.page),
        _search: opts.search,
        _fields: opts.fields,
      });
      print(result, getFormat(jobsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobsCmd
  .command('get <id>')
  .description('Get a job/project by ID')
  .option('--fields <fields>', 'Fields to return')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.jobs.get(id, opts.fields);
      print(result, getFormat(jobsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Prospects (Sales) Commands
// ============================================
const prospectsCmd = program
  .command('prospects')
  .description('Manage sales opportunities');

prospectsCmd
  .command('list')
  .description('List prospects/sales')
  .option('-l, --limit <number>', 'Max results per page', '10')
  .option('--page <number>', 'Page number (0-indexed)', '0')
  .option('--search <query>', 'Search query')
  .option('--fields <fields>', 'Fields to return')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.prospects.list({
        _limit: parseInt(opts.limit),
        _page: parseInt(opts.page),
        _search: opts.search,
        _fields: opts.fields,
      });
      print(result, getFormat(prospectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

prospectsCmd
  .command('get <id>')
  .description('Get a prospect/sale by ID')
  .option('--fields <fields>', 'Fields to return')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.prospects.get(id, opts.fields);
      print(result, getFormat(prospectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Staff Commands
// ============================================
const staffCmd = program
  .command('staff')
  .description('Manage team members');

staffCmd
  .command('list')
  .description('List staff members')
  .option('-l, --limit <number>', 'Max results per page', '10')
  .option('--page <number>', 'Page number (0-indexed)', '0')
  .option('--search <query>', 'Search query')
  .option('--fields <fields>', 'Fields to return')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.staff.list({
        _limit: parseInt(opts.limit),
        _page: parseInt(opts.page),
        _search: opts.search,
        _fields: opts.fields,
      });
      print(result, getFormat(staffCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

staffCmd
  .command('me')
  .description('Get current authenticated user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.staff.me();
      print(result, getFormat(staffCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Activities Commands
// ============================================
const activitiesCmd = program
  .command('activities')
  .description('Manage activities (notes, emails, meetings)');

activitiesCmd
  .command('list')
  .description('List activities')
  .option('-l, --limit <number>', 'Max results per page', '10')
  .option('--page <number>', 'Page number (0-indexed)', '0')
  .option('--search <query>', 'Search query')
  .option('--fields <fields>', 'Fields to return')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.activities.list({
        _limit: parseInt(opts.limit),
        _page: parseInt(opts.page),
        _search: opts.search,
        _fields: opts.fields,
      });
      print(result, getFormat(activitiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

activitiesCmd
  .command('get <id>')
  .description('Get an activity by ID')
  .option('--fields <fields>', 'Fields to return')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.activities.get(id, opts.fields);
      print(result, getFormat(activitiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
