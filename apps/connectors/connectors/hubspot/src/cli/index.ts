#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { HubSpot } from '../api';
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
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-hubspot';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('HubSpot connector - CRM contacts, companies, deals, and tickets')
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
      process.env.HUBSPOT_ACCESS_TOKEN = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): HubSpot {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set HUBSPOT_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  return new HubSpot({ apiKey });
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
// Contact Commands
// ============================================
const contactCmd = program
  .command('contact')
  .description('Contact management');

contactCmd
  .command('list')
  .description('List all contacts')
  .option('--limit <number>', 'Maximum results', '10')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--properties <properties>', 'Comma-separated property names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listContacts({
        limit: parseInt(opts.limit),
        after: opts.after,
        properties: opts.properties?.split(','),
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
  .option('--properties <properties>', 'Comma-separated property names')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getContact(id, opts.properties?.split(','));
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('create')
  .description('Create a new contact')
  .requiredOption('--email <email>', 'Contact email')
  .option('--firstname <name>', 'First name')
  .option('--lastname <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .option('--company <company>', 'Company name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createContact({
        properties: {
          email: opts.email,
          firstname: opts.firstname,
          lastname: opts.lastname,
          phone: opts.phone,
          company: opts.company,
        },
      });
      success('Contact created!');
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('update <id>')
  .description('Update a contact')
  .option('--email <email>', 'Contact email')
  .option('--firstname <name>', 'First name')
  .option('--lastname <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .action(async (id: string, opts) => {
    try {
      const properties: Record<string, string> = {};
      if (opts.email) properties.email = opts.email;
      if (opts.firstname) properties.firstname = opts.firstname;
      if (opts.lastname) properties.lastname = opts.lastname;
      if (opts.phone) properties.phone = opts.phone;

      const client = getClient();
      const result = await client.updateContact(id, { properties });
      success('Contact updated!');
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
      await client.deleteContact(id);
      success(`Contact ${id} deleted`);
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
  .description('Company management');

companyCmd
  .command('list')
  .description('List all companies')
  .option('--limit <number>', 'Maximum results', '10')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--properties <properties>', 'Comma-separated property names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listCompanies({
        limit: parseInt(opts.limit),
        after: opts.after,
        properties: opts.properties?.split(','),
      });
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companyCmd
  .command('get <id>')
  .description('Get a company by ID')
  .option('--properties <properties>', 'Comma-separated property names')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getCompany(id, opts.properties?.split(','));
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companyCmd
  .command('create')
  .description('Create a new company')
  .requiredOption('--name <name>', 'Company name')
  .option('--domain <domain>', 'Company domain')
  .option('--industry <industry>', 'Industry')
  .option('--phone <phone>', 'Phone number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createCompany({
        properties: {
          name: opts.name,
          domain: opts.domain,
          industry: opts.industry,
          phone: opts.phone,
        },
      });
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
      await client.deleteCompany(id);
      success(`Company ${id} deleted`);
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
  .description('Deal management');

dealCmd
  .command('list')
  .description('List all deals')
  .option('--limit <number>', 'Maximum results', '10')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--properties <properties>', 'Comma-separated property names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listDeals({
        limit: parseInt(opts.limit),
        after: opts.after,
        properties: opts.properties?.split(','),
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
  .option('--properties <properties>', 'Comma-separated property names')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getDeal(id, opts.properties?.split(','));
      print(result, getFormat(dealCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealCmd
  .command('create')
  .description('Create a new deal')
  .requiredOption('--name <name>', 'Deal name')
  .option('--stage <stage>', 'Deal stage')
  .option('--pipeline <pipeline>', 'Pipeline ID')
  .option('--amount <amount>', 'Deal amount')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createDeal({
        properties: {
          dealname: opts.name,
          dealstage: opts.stage,
          pipeline: opts.pipeline,
          amount: opts.amount,
        },
      });
      success('Deal created!');
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
      await client.deleteDeal(id);
      success(`Deal ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Ticket Commands
// ============================================
const ticketCmd = program
  .command('ticket')
  .description('Ticket management');

ticketCmd
  .command('list')
  .description('List all tickets')
  .option('--limit <number>', 'Maximum results', '10')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--properties <properties>', 'Comma-separated property names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTickets({
        limit: parseInt(opts.limit),
        after: opts.after,
        properties: opts.properties?.split(','),
      });
      print(result, getFormat(ticketCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketCmd
  .command('get <id>')
  .description('Get a ticket by ID')
  .option('--properties <properties>', 'Comma-separated property names')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getTicket(id, opts.properties?.split(','));
      print(result, getFormat(ticketCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketCmd
  .command('create')
  .description('Create a new ticket')
  .requiredOption('--subject <subject>', 'Ticket subject')
  .option('--content <content>', 'Ticket content')
  .option('--pipeline <pipeline>', 'Pipeline ID')
  .option('--stage <stage>', 'Pipeline stage')
  .option('--priority <priority>', 'Ticket priority')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createTicket({
        properties: {
          subject: opts.subject,
          content: opts.content,
          hs_pipeline: opts.pipeline,
          hs_pipeline_stage: opts.stage,
          hs_ticket_priority: opts.priority,
        },
      });
      success('Ticket created!');
      print(result, getFormat(ticketCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketCmd
  .command('delete <id>')
  .description('Delete a ticket')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteTicket(id);
      success(`Ticket ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Owner Commands
// ============================================
const ownerCmd = program
  .command('owner')
  .description('Owner management');

ownerCmd
  .command('list')
  .description('List all owners')
  .option('--limit <number>', 'Maximum results', '10')
  .option('--after <cursor>', 'Pagination cursor')
  .option('--email <email>', 'Filter by email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listOwners({
        limit: parseInt(opts.limit),
        after: opts.after,
        email: opts.email,
      });
      print(result, getFormat(ownerCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ownerCmd
  .command('get <id>')
  .description('Get an owner by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getOwner(id);
      print(result, getFormat(ownerCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
