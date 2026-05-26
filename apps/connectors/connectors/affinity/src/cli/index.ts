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

const CONNECTOR_NAME = 'connect-affinity';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Affinity CRM API connector CLI')
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
      process.env.AFFINITY_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set AFFINITY_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
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
// Person Commands
// ============================================
const personCmd = program
  .command('person')
  .description('Manage persons');

personCmd
  .command('list')
  .description('List persons')
  .option('--page-size <size>', 'Page size')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.pageSize) params.page_size = parseInt(opts.pageSize);
      if (opts.pageToken) params.page_token = opts.pageToken;
      const result = await client.persons.list(params);
      print(result, getFormat(personCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

personCmd
  .command('get <id>')
  .description('Get a person by ID')
  .option('--field-ids <ids>', 'Comma-separated field IDs to include')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const fieldIds = opts.fieldIds ? opts.fieldIds.split(',').map(Number) : undefined;
      const result = await client.persons.get(parseInt(id), fieldIds);
      print(result, getFormat(personCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

personCmd
  .command('create')
  .description('Create a person')
  .requiredOption('--first-name <name>', 'First name')
  .requiredOption('--last-name <name>', 'Last name')
  .option('--emails <emails>', 'Comma-separated emails')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = {
        first_name: opts.firstName,
        last_name: opts.lastName,
      };
      if (opts.emails) data.emails = opts.emails.split(',');
      const result = await client.persons.create(data as any);
      success('Person created!');
      print(result, getFormat(personCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

personCmd
  .command('delete <id>')
  .description('Delete a person')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.persons.delete(parseInt(id));
      success('Person deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Company Commands
// ============================================
const companyCmd = program
  .command('company')
  .description('Manage companies (organizations)');

companyCmd
  .command('list')
  .description('List companies')
  .option('--page-size <size>', 'Page size')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.pageSize) params.page_size = parseInt(opts.pageSize);
      if (opts.pageToken) params.page_token = opts.pageToken;
      const result = await client.organizations.list(params);
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companyCmd
  .command('get <id>')
  .description('Get a company by ID')
  .option('--field-ids <ids>', 'Comma-separated field IDs to include')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const fieldIds = opts.fieldIds ? opts.fieldIds.split(',').map(Number) : undefined;
      const result = await client.organizations.get(parseInt(id), fieldIds);
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companyCmd
  .command('create')
  .description('Create a company')
  .requiredOption('--name <name>', 'Company name')
  .option('--domain <domain>', 'Company domain')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = { name: opts.name };
      if (opts.domain) data.domain = opts.domain;
      const result = await client.organizations.create(data as any);
      success('Company created!');
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companyCmd
  .command('delete <id>')
  .description('Delete a company')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.organizations.delete(parseInt(id));
      success('Company deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Opportunity Commands
// ============================================
const opportunityCmd = program
  .command('opportunity')
  .description('Manage opportunities');

opportunityCmd
  .command('list')
  .description('List opportunities')
  .option('--page-size <size>', 'Page size')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.pageSize) params.page_size = parseInt(opts.pageSize);
      if (opts.pageToken) params.page_token = opts.pageToken;
      const result = await client.opportunities.list(params);
      print(result, getFormat(opportunityCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

opportunityCmd
  .command('get <id>')
  .description('Get an opportunity by ID')
  .option('--field-ids <ids>', 'Comma-separated field IDs to include')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const fieldIds = opts.fieldIds ? opts.fieldIds.split(',').map(Number) : undefined;
      const result = await client.opportunities.get(parseInt(id), fieldIds);
      print(result, getFormat(opportunityCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

opportunityCmd
  .command('create')
  .description('Create an opportunity')
  .requiredOption('--name <name>', 'Opportunity name')
  .requiredOption('--list-id <id>', 'List ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.opportunities.create({
        name: opts.name,
        list_id: parseInt(opts.listId),
      });
      success('Opportunity created!');
      print(result, getFormat(opportunityCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

opportunityCmd
  .command('delete <id>')
  .description('Delete an opportunity')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.opportunities.delete(parseInt(id));
      success('Opportunity deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// List Commands
// ============================================
const listCmd = program
  .command('list')
  .description('Manage lists');

listCmd
  .command('all')
  .description('List all lists')
  .option('--page-size <size>', 'Page size')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.pageSize) params.page_size = parseInt(opts.pageSize);
      if (opts.pageToken) params.page_token = opts.pageToken;
      const result = await client.lists.list(params);
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('get <id>')
  .description('Get a list by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.lists.get(parseInt(id));
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('fields <listId>')
  .description('Get fields for a list')
  .action(async (listId: string) => {
    try {
      const client = getClient();
      const result = await client.lists.getFields(parseInt(listId));
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('entries <listId>')
  .description('List entries for a list')
  .option('--page-size <size>', 'Page size')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.pageSize) params.page_size = parseInt(opts.pageSize);
      if (opts.pageToken) params.page_token = opts.pageToken;
      const result = await client.lists.listEntries(parseInt(listId), params);
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('get-entry <listId> <entryId>')
  .description('Get a specific list entry')
  .action(async (listId: string, entryId: string) => {
    try {
      const client = getClient();
      const result = await client.lists.getEntry(parseInt(listId), parseInt(entryId));
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('add-entry <listId>')
  .description('Add an entry to a list')
  .requiredOption('--entity-id <id>', 'Entity ID')
  .option('--entity-type <type>', 'Entity type')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = {
        entity_id: parseInt(opts.entityId),
      };
      if (opts.entityType) data.entity_type = parseInt(opts.entityType);
      const result = await client.lists.createEntry(parseInt(listId), data as any);
      success('Entry added!');
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('delete-entry <listId> <entryId>')
  .description('Delete a list entry')
  .action(async (listId: string, entryId: string) => {
    try {
      const client = getClient();
      await client.lists.deleteEntry(parseInt(listId), parseInt(entryId));
      success('Entry deleted');
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
  .command('list')
  .description('List notes')
  .option('--person-id <id>', 'Filter by person ID')
  .option('--organization-id <id>', 'Filter by organization ID')
  .option('--opportunity-id <id>', 'Filter by opportunity ID')
  .option('--page-size <size>', 'Page size')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.pageSize) params.page_size = parseInt(opts.pageSize);
      if (opts.pageToken) params.page_token = opts.pageToken;
      if (opts.personId) params.person_id = parseInt(opts.personId);
      if (opts.organizationId) params.organization_id = parseInt(opts.organizationId);
      if (opts.opportunityId) params.opportunity_id = parseInt(opts.opportunityId);
      const result = await client.notes.list(params);
      print(result, getFormat(noteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

noteCmd
  .command('get <id>')
  .description('Get a note by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.notes.get(parseInt(id));
      print(result, getFormat(noteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

noteCmd
  .command('create')
  .description('Create a note')
  .requiredOption('--content <content>', 'Note content')
  .option('--person-ids <ids>', 'Comma-separated person IDs')
  .option('--organization-ids <ids>', 'Comma-separated organization IDs')
  .option('--opportunity-ids <ids>', 'Comma-separated opportunity IDs')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = { content: opts.content };
      if (opts.personIds) data.person_ids = opts.personIds.split(',').map(Number);
      if (opts.organizationIds) data.organization_ids = opts.organizationIds.split(',').map(Number);
      if (opts.opportunityIds) data.opportunity_ids = opts.opportunityIds.split(',').map(Number);
      const result = await client.notes.create(data as any);
      success('Note created!');
      print(result, getFormat(noteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

noteCmd
  .command('delete <id>')
  .description('Delete a note')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.notes.delete(parseInt(id));
      success('Note deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
