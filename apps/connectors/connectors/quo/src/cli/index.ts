#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Quo } from '../api';
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

const CONNECTOR_NAME = 'connect-quo';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Quo (OpenPhone) API connector CLI - Send messages, manage contacts, and access call data')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set API key from flag if provided
    if (opts.apiKey) {
      process.env.QUO_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Quo {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set QUO_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Quo({ apiKey });
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
// Messages Commands
// ============================================
const messagesCmd = program
  .command('messages')
  .description('Send and list messages');

messagesCmd
  .command('list')
  .description('List messages')
  .option('-n, --max <number>', 'Maximum results', '20')
  .option('--phone-number-id <id>', 'Filter by phone number ID')
  .option('--conversation-id <id>', 'Filter by conversation ID')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.messages.list({
        maxResults: parseInt(opts.max),
        phoneNumberId: opts.phoneNumberId,
        conversationId: opts.conversationId,
        pageToken: opts.pageToken,
      });
      print(result.data, getFormat(messagesCmd));
      if (result.nextPageToken) {
        info(`Next page token: ${result.nextPageToken}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('get <id>')
  .description('Get a message by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.messages.get(id);
      print(result.data, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('send')
  .description('Send a text message (SMS only, MMS not supported)')
  .requiredOption('--from <phoneNumberId>', 'Phone number ID to send from')
  .requiredOption('--to <numbers>', 'Recipient phone numbers (comma-separated)')
  .requiredOption('--text <message>', 'Message text')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.messages.send({
        from: opts.from,
        to: opts.to.split(',').map((n: string) => n.trim()),
        text: opts.text,
      });
      success('Message sent!');
      print(result.data, getFormat(messagesCmd));
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
  .option('-n, --max <number>', 'Maximum results', '20')
  .option('--phone-number <number>', 'Filter by phone number')
  .option('--email <email>', 'Filter by email')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.list({
        maxResults: parseInt(opts.max),
        phoneNumber: opts.phoneNumber,
        email: opts.email,
        pageToken: opts.pageToken,
      });
      print(result.data, getFormat(contactsCmd));
      if (result.nextPageToken) {
        info(`Next page token: ${result.nextPageToken}`);
      }
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
      print(result.data, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('create')
  .description('Create a new contact')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--company <company>', 'Company name')
  .option('--role <role>', 'Role/title')
  .option('--phone <number>', 'Phone number')
  .option('--email <email>', 'Email address')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.create({
        defaultFields: {
          firstName: opts.firstName,
          lastName: opts.lastName,
          company: opts.company,
          role: opts.role,
          phoneNumbers: opts.phone ? [{ value: opts.phone }] : undefined,
          emails: opts.email ? [{ value: opts.email }] : undefined,
        },
      });
      success('Contact created!');
      print(result.data, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('update <id>')
  .description('Update a contact')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--company <company>', 'Company name')
  .option('--role <role>', 'Role/title')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.update(id, {
        defaultFields: {
          firstName: opts.firstName,
          lastName: opts.lastName,
          company: opts.company,
          role: opts.role,
        },
      });
      success('Contact updated!');
      print(result.data, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('delete <id>')
  .description('Delete a contact')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.contacts.delete(id);
      success('Contact deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Conversations Commands
// ============================================
const conversationsCmd = program
  .command('conversations')
  .description('List and view conversations');

conversationsCmd
  .command('list')
  .description('List conversations')
  .option('-n, --max <number>', 'Maximum results', '20')
  .option('--phone-number-id <id>', 'Filter by phone number ID')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.conversations.list({
        maxResults: parseInt(opts.max),
        phoneNumberId: opts.phoneNumberId,
        pageToken: opts.pageToken,
      });
      print(result.data, getFormat(conversationsCmd));
      if (result.nextPageToken) {
        info(`Next page token: ${result.nextPageToken}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationsCmd
  .command('get <id>')
  .description('Get a conversation by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.conversations.get(id);
      print(result.data, getFormat(conversationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationsCmd
  .command('messages <id>')
  .description('Get messages for a conversation')
  .option('-n, --max <number>', 'Maximum results', '20')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.conversations.getMessages(id, {
        maxResults: parseInt(opts.max),
        pageToken: opts.pageToken,
      });
      print(result.data, getFormat(conversationsCmd));
      if (result.nextPageToken) {
        info(`Next page token: ${result.nextPageToken}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Calls Commands
// ============================================
const callsCmd = program
  .command('calls')
  .description('List and view call details');

callsCmd
  .command('list')
  .description('List calls')
  .option('-n, --max <number>', 'Maximum results', '20')
  .option('--phone-number-id <id>', 'Filter by phone number ID')
  .option('--user-id <id>', 'Filter by user ID')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.calls.list({
        maxResults: parseInt(opts.max),
        phoneNumberId: opts.phoneNumberId,
        userId: opts.userId,
        pageToken: opts.pageToken,
      });
      print(result.data, getFormat(callsCmd));
      if (result.nextPageToken) {
        info(`Next page token: ${result.nextPageToken}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd
  .command('get <id>')
  .description('Get a call by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.calls.get(id);
      print(result.data, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd
  .command('recordings <id>')
  .description('Get recordings for a call')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.calls.getRecordings(id);
      print(result.data, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd
  .command('summary <id>')
  .description('Get summary for a call')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.calls.getSummary(id);
      print(result.data, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd
  .command('transcription <id>')
  .description('Get transcription for a call')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.calls.getTranscription(id);
      print(result.data, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd
  .command('voicemail <id>')
  .description('Get voicemail for a call')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.calls.getVoicemail(id);
      print(result.data, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Phone Numbers Commands
// ============================================
const numbersCmd = program
  .command('numbers')
  .description('List and view phone numbers');

numbersCmd
  .command('list')
  .description('List all phone numbers')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.phoneNumbers.list();
      print(result.data, getFormat(numbersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

numbersCmd
  .command('get <id>')
  .description('Get a phone number by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.phoneNumbers.get(id);
      print(result.data, getFormat(numbersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Users Commands
// ============================================
const usersCmd = program
  .command('users')
  .description('List and view users');

usersCmd
  .command('list')
  .description('List all users')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.users.list();
      print(result.data, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('get <id>')
  .description('Get a user by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.users.get(id);
      print(result.data, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Webhooks Commands
// ============================================
const webhooksCmd = program
  .command('webhooks')
  .description('Manage webhook subscriptions');

webhooksCmd
  .command('list')
  .description('List all webhooks')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.webhooks.list();
      print(result.data, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('get <id>')
  .description('Get a webhook by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.webhooks.get(id);
      print(result.data, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a new webhook')
  .requiredOption('--url <url>', 'Webhook endpoint URL')
  .requiredOption('--events <events>', 'Events to subscribe to (comma-separated)')
  .option('--label <label>', 'Webhook label')
  .option('--status <status>', 'Status (enabled, disabled)', 'enabled')
  .option('--resource-ids <ids>', 'Phone number IDs (comma-separated)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const events = opts.events.split(',').map((e: string) => e.trim());
      const result = await client.webhooks.create({
        url: opts.url,
        events,
        label: opts.label,
        status: opts.status as 'enabled' | 'disabled',
        resourceIds: opts.resourceIds ? opts.resourceIds.split(',').map((id: string) => id.trim()) : undefined,
      });
      success('Webhook created!');
      print(result.data, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <id>')
  .description('Delete a webhook')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.webhooks.delete(id);
      success('Webhook deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Custom Fields Commands
// ============================================
const customFieldsCmd = program
  .command('custom-fields')
  .description('List contact custom field definitions');

customFieldsCmd
  .command('list')
  .description('List all custom field definitions')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.customFields.list();
      print(result.data, getFormat(customFieldsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
