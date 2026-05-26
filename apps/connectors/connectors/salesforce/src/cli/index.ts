#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Salesforce } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getInstanceUrl,
  setInstanceUrl,
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

const CONNECTOR_NAME = 'connect-salesforce';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Salesforce connector - CRM accounts, contacts, leads, and opportunities')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
  .option('-i, --instance <url>', 'Instance URL (overrides config)')
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
    if (opts.token) {
      process.env.SALESFORCE_ACCESS_TOKEN = opts.token;
    }
    if (opts.instance) {
      process.env.SALESFORCE_INSTANCE_URL = opts.instance;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Salesforce {
  const accessToken = getAccessToken();
  const instanceUrl = getInstanceUrl();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set SALESFORCE_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  if (!instanceUrl) {
    error(`No instance URL configured. Run "${CONNECTOR_NAME} config set-instance <url>" or set SALESFORCE_INSTANCE_URL environment variable.`);
    process.exit(1);
  }
  return new Salesforce({ accessToken, instanceUrl });
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
  .option('--token <token>', 'Access token')
  .option('--instance <url>', 'Instance URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
      instanceUrl: opts.instance,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Instance URL: ${config.instanceUrl || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-instance <url>')
  .description('Set instance URL')
  .action((url: string) => {
    setInstanceUrl(url);
    success(`Instance URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const instanceUrl = getInstanceUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Instance URL: ${instanceUrl || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Account Commands
// ============================================
const accountCmd = program
  .command('account')
  .description('Account management');

accountCmd
  .command('list')
  .description('List all accounts')
  .option('--limit <number>', 'Maximum results', '25')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listAccounts({
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('get <id>')
  .description('Get an account by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getAccount(id);
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('create')
  .description('Create a new account')
  .requiredOption('--name <name>', 'Account name')
  .option('--type <type>', 'Account type')
  .option('--industry <industry>', 'Industry')
  .option('--website <website>', 'Website')
  .option('--phone <phone>', 'Phone')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createAccount({
        Name: opts.name,
        Type: opts.type,
        Industry: opts.industry,
        Website: opts.website,
        Phone: opts.phone,
      });
      success('Account created!');
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('delete <id>')
  .description('Delete an account')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteAccount(id);
      success(`Account ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
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
  .option('--limit <number>', 'Maximum results', '25')
  .option('--account-id <id>', 'Filter by account ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listContacts({
        limit: parseInt(opts.limit),
        accountId: opts.accountId,
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
      const result = await client.getContact(id);
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('create')
  .description('Create a new contact')
  .requiredOption('--last-name <name>', 'Last name')
  .option('--first-name <name>', 'First name')
  .option('--email <email>', 'Email')
  .option('--phone <phone>', 'Phone')
  .option('--account-id <id>', 'Account ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createContact({
        LastName: opts.lastName,
        FirstName: opts.firstName,
        Email: opts.email,
        Phone: opts.phone,
        AccountId: opts.accountId,
      });
      success('Contact created!');
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
// Lead Commands
// ============================================
const leadCmd = program
  .command('lead')
  .description('Lead management');

leadCmd
  .command('list')
  .description('List all leads')
  .option('--limit <number>', 'Maximum results', '25')
  .option('--status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listLeads({
        limit: parseInt(opts.limit),
        status: opts.status,
      });
      print(result, getFormat(leadCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadCmd
  .command('get <id>')
  .description('Get a lead by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getLead(id);
      print(result, getFormat(leadCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadCmd
  .command('create')
  .description('Create a new lead')
  .requiredOption('--last-name <name>', 'Last name')
  .requiredOption('--company <company>', 'Company name')
  .option('--first-name <name>', 'First name')
  .option('--email <email>', 'Email')
  .option('--phone <phone>', 'Phone')
  .option('--status <status>', 'Lead status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createLead({
        LastName: opts.lastName,
        Company: opts.company,
        FirstName: opts.firstName,
        Email: opts.email,
        Phone: opts.phone,
        Status: opts.status,
      });
      success('Lead created!');
      print(result, getFormat(leadCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

leadCmd
  .command('delete <id>')
  .description('Delete a lead')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteLead(id);
      success(`Lead ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Opportunity Commands
// ============================================
const oppCmd = program
  .command('opportunity')
  .alias('opp')
  .description('Opportunity management');

oppCmd
  .command('list')
  .description('List all opportunities')
  .option('--limit <number>', 'Maximum results', '25')
  .option('--account-id <id>', 'Filter by account ID')
  .option('--stage <stage>', 'Filter by stage')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listOpportunities({
        limit: parseInt(opts.limit),
        accountId: opts.accountId,
        stageName: opts.stage,
      });
      print(result, getFormat(oppCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

oppCmd
  .command('get <id>')
  .description('Get an opportunity by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getOpportunity(id);
      print(result, getFormat(oppCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

oppCmd
  .command('create')
  .description('Create a new opportunity')
  .requiredOption('--name <name>', 'Opportunity name')
  .requiredOption('--stage <stage>', 'Stage name')
  .requiredOption('--close-date <date>', 'Close date (YYYY-MM-DD)')
  .option('--account-id <id>', 'Account ID')
  .option('--amount <amount>', 'Amount')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createOpportunity({
        Name: opts.name,
        StageName: opts.stage,
        CloseDate: opts.closeDate,
        AccountId: opts.accountId,
        Amount: opts.amount ? parseFloat(opts.amount) : undefined,
      });
      success('Opportunity created!');
      print(result, getFormat(oppCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

oppCmd
  .command('delete <id>')
  .description('Delete an opportunity')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteOpportunity(id);
      success(`Opportunity ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Query Commands
// ============================================
const queryCmd = program
  .command('query')
  .description('Execute SOQL queries');

queryCmd
  .command('run <soql>')
  .description('Execute a SOQL query')
  .action(async (soql: string) => {
    try {
      const client = getClient();
      const result = await client.query(soql);
      print(result, getFormat(queryCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .description('User management');

userCmd
  .command('list')
  .description('List all users')
  .option('--limit <number>', 'Maximum results', '25')
  .option('--active', 'Only active users')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listUsers({
        limit: parseInt(opts.limit),
        isActive: opts.active ? true : undefined,
      });
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('get <id>')
  .description('Get a user by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getUser(id);
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
