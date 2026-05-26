#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SendGrid } from '../api';
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

const CONNECTOR_NAME = 'connect-sendgrid';
const VERSION = '0.0.2';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('SendGrid connector - Send emails, manage contacts, templates, and email marketing')
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
      process.env.SENDGRID_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): SendGrid {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SENDGRID_API_KEY environment variable.`);
    process.exit(1);
  }
  return new SendGrid({ apiKey });
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
  .description('Manage CLI configuration');

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
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Mail Send Commands
// ============================================
const mailCmd = program
  .command('mail')
  .description('Send email operations');

mailCmd
  .command('send')
  .description('Send an email')
  .requiredOption('--to <emails>', 'Recipient email(s), comma-separated')
  .requiredOption('--from <email>', 'Sender email')
  .requiredOption('--subject <subject>', 'Email subject')
  .option('--text <text>', 'Plain text content')
  .option('--html <html>', 'HTML content')
  .option('--from-name <name>', 'Sender name')
  .option('--reply-to <email>', 'Reply-to email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const toEmails = opts.to.split(',').map((e: string) => e.trim());

      await client.sendSimpleEmail({
        to: toEmails,
        from: opts.from,
        fromName: opts.fromName,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        replyTo: opts.replyTo,
      });
      success('Email sent successfully!');
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
  .description('Contact operations');

contactCmd
  .command('ls')
  .description('List all contacts')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listContacts();
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('get <contactId>')
  .description('Get a contact by ID')
  .action(async (contactId: string) => {
    try {
      const client = getClient();
      const result = await client.getContact(contactId);
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('search <query>')
  .description('Search contacts by email')
  .action(async (query: string) => {
    try {
      const client = getClient();
      const result = await client.searchContacts(query);
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('add')
  .description('Add a contact')
  .requiredOption('-e, --email <email>', 'Contact email')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--list-id <id>', 'List ID to add contact to')
  .action(async (opts) => {
    try {
      const client = getClient();
      const contact = {
        email: opts.email,
        first_name: opts.firstName,
        last_name: opts.lastName,
      };
      const listIds = opts.listId ? [opts.listId] : undefined;
      const result = await client.upsertContacts([contact], listIds);
      success('Contact added!');
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('count')
  .description('Get contact count')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getContactCount();
      print(result, getFormat(contactCmd));
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
  .description('Contact list operations');

listCmd
  .command('ls')
  .description('List all contact lists')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listContactLists();
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('get <listId>')
  .description('Get a list by ID')
  .action(async (listId: string) => {
    try {
      const client = getClient();
      const result = await client.getContactList(listId);
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('create <name>')
  .description('Create a contact list')
  .action(async (name: string) => {
    try {
      const client = getClient();
      const result = await client.createContactList(name);
      success('List created!');
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('delete <listId>')
  .description('Delete a list')
  .option('--delete-contacts', 'Also delete contacts in the list')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      await client.deleteContactList(listId, opts.deleteContacts);
      success(`List ${listId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Template Commands
// ============================================
const templateCmd = program
  .command('template')
  .description('Template operations');

templateCmd
  .command('ls')
  .description('List all templates')
  .option('-g, --generations <type>', 'Template generations (legacy, dynamic, legacy,dynamic)', 'dynamic')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTemplates(opts.generations);
      print(result, getFormat(templateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templateCmd
  .command('get <templateId>')
  .description('Get a template by ID')
  .action(async (templateId: string) => {
    try {
      const client = getClient();
      const result = await client.getTemplate(templateId);
      print(result, getFormat(templateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templateCmd
  .command('create <name>')
  .description('Create a template')
  .option('-g, --generation <type>', 'Template generation (legacy, dynamic)', 'dynamic')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createTemplate({
        name,
        generation: opts.generation,
      });
      success('Template created!');
      print(result, getFormat(templateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templateCmd
  .command('delete <templateId>')
  .description('Delete a template')
  .action(async (templateId: string) => {
    try {
      const client = getClient();
      await client.deleteTemplate(templateId);
      success(`Template ${templateId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Sender Commands
// ============================================
const senderCmd = program
  .command('sender')
  .description('Sender operations');

senderCmd
  .command('ls')
  .description('List all senders')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listSenders();
      print(result, getFormat(senderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

senderCmd
  .command('get <senderId>')
  .description('Get a sender by ID')
  .action(async (senderId: string) => {
    try {
      const client = getClient();
      const result = await client.getSender(parseInt(senderId));
      print(result, getFormat(senderCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

senderCmd
  .command('delete <senderId>')
  .description('Delete a sender')
  .action(async (senderId: string) => {
    try {
      const client = getClient();
      await client.deleteSender(parseInt(senderId));
      success(`Sender ${senderId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

senderCmd
  .command('verify <senderId>')
  .description('Resend sender verification')
  .action(async (senderId: string) => {
    try {
      const client = getClient();
      await client.resendSenderVerification(parseInt(senderId));
      success(`Verification email sent for sender ${senderId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Stats Commands
// ============================================
const statsCmd = program
  .command('stats')
  .description('Email statistics');

statsCmd
  .command('global')
  .description('Get global email stats')
  .requiredOption('--start-date <date>', 'Start date (YYYY-MM-DD)')
  .option('--end-date <date>', 'End date (YYYY-MM-DD)')
  .option('--aggregated-by <period>', 'Aggregation period (day, week, month)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.getStats({
        start_date: opts.startDate,
        end_date: opts.endDate,
        aggregated_by: opts.aggregatedBy,
      });
      print(result, getFormat(statsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Suppression Commands
// ============================================
const suppressionCmd = program
  .command('suppression')
  .description('Suppression management');

suppressionCmd
  .command('bounces')
  .description('List bounces')
  .option('-l, --limit <number>', 'Limit results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listBounces({
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(suppressionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

suppressionCmd
  .command('blocks')
  .description('List blocks')
  .option('-l, --limit <number>', 'Limit results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listBlocks({
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(suppressionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

suppressionCmd
  .command('spam-reports')
  .description('List spam reports')
  .option('-l, --limit <number>', 'Limit results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSpamReports({
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(suppressionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

suppressionCmd
  .command('invalid-emails')
  .description('List invalid emails')
  .option('-l, --limit <number>', 'Limit results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listInvalidEmails({
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(suppressionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

suppressionCmd
  .command('unsubscribes')
  .description('List global unsubscribes')
  .option('-l, --limit <number>', 'Limit results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listGlobalUnsubscribes({
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(suppressionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Unsubscribe Group Commands
// ============================================
const groupCmd = program
  .command('group')
  .description('Unsubscribe group operations');

groupCmd
  .command('ls')
  .description('List unsubscribe groups')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listUnsubscribeGroups();
      print(result, getFormat(groupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupCmd
  .command('get <groupId>')
  .description('Get an unsubscribe group')
  .action(async (groupId: string) => {
    try {
      const client = getClient();
      const result = await client.getUnsubscribeGroup(parseInt(groupId));
      print(result, getFormat(groupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupCmd
  .command('create')
  .description('Create an unsubscribe group')
  .requiredOption('-n, --name <name>', 'Group name')
  .option('-d, --description <desc>', 'Group description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createUnsubscribeGroup({
        name: opts.name,
        description: opts.description,
      });
      success('Unsubscribe group created!');
      print(result, getFormat(groupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupCmd
  .command('delete <groupId>')
  .description('Delete an unsubscribe group')
  .action(async (groupId: string) => {
    try {
      const client = getClient();
      await client.deleteUnsubscribeGroup(parseInt(groupId));
      success(`Unsubscribe group ${groupId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// API Key Commands
// ============================================
const apiKeyCmd = program
  .command('api-key')
  .description('API key operations');

apiKeyCmd
  .command('ls')
  .description('List API keys')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listApiKeys();
      print(result, getFormat(apiKeyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

apiKeyCmd
  .command('get <keyId>')
  .description('Get an API key')
  .action(async (keyId: string) => {
    try {
      const client = getClient();
      const result = await client.getApiKey(keyId);
      print(result, getFormat(apiKeyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

apiKeyCmd
  .command('create <name>')
  .description('Create an API key')
  .option('-s, --scopes <scopes>', 'Comma-separated scopes')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const scopes = opts.scopes ? opts.scopes.split(',').map((s: string) => s.trim()) : undefined;
      const result = await client.createApiKey({ name, scopes });
      success('API key created!');
      print(result, getFormat(apiKeyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

apiKeyCmd
  .command('delete <keyId>')
  .description('Delete an API key')
  .action(async (keyId: string) => {
    try {
      const client = getClient();
      await client.deleteApiKey(keyId);
      success(`API key ${keyId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
