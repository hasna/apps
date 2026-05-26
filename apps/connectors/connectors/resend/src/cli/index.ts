#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Resend } from '../api';
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
import type { WebhookEvent } from '../types';

const CONNECTOR_NAME = 'connect-resend';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Resend Email API connector CLI - Send emails, manage templates, domains, audiences, contacts, webhooks, and broadcasts')
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
      process.env.RESEND_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Resend {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set RESEND_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Resend({ apiKey });
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
// Emails Commands
// ============================================
const emailsCmd = program
  .command('emails')
  .description('Send and manage emails');

emailsCmd
  .command('send')
  .description('Send an email')
  .requiredOption('--from <address>', 'Sender email address')
  .requiredOption('--to <addresses>', 'Recipient email addresses (comma-separated)')
  .requiredOption('--subject <subject>', 'Email subject')
  .option('--html <html>', 'HTML body')
  .option('--text <text>', 'Plain text body')
  .option('--cc <addresses>', 'CC addresses (comma-separated)')
  .option('--bcc <addresses>', 'BCC addresses (comma-separated)')
  .option('--reply-to <addresses>', 'Reply-to addresses (comma-separated)')
  .option('--schedule <datetime>', 'Schedule for later (ISO 8601 format)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.emails.send({
        from: opts.from,
        to: opts.to.split(',').map((e: string) => e.trim()),
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        cc: opts.cc ? opts.cc.split(',').map((e: string) => e.trim()) : undefined,
        bcc: opts.bcc ? opts.bcc.split(',').map((e: string) => e.trim()) : undefined,
        reply_to: opts.replyTo ? opts.replyTo.split(',').map((e: string) => e.trim()) : undefined,
        scheduled_at: opts.schedule,
      });
      success('Email sent!');
      print(result, getFormat(emailsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

emailsCmd
  .command('list')
  .description('List all emails')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.emails.list();
      print(result.data, getFormat(emailsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

emailsCmd
  .command('get <id>')
  .description('Get an email by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.emails.get(id);
      print(result, getFormat(emailsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

emailsCmd
  .command('update <id>')
  .description('Update a scheduled email')
  .option('--schedule <datetime>', 'New scheduled time (ISO 8601 format)')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.emails.update(id, {
        scheduled_at: opts.schedule,
      });
      success('Email updated!');
      print(result, getFormat(emailsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

emailsCmd
  .command('cancel <id>')
  .description('Cancel a scheduled email')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.emails.cancel(id);
      if (result.canceled) {
        success('Email canceled!');
      } else {
        warn('Email could not be canceled');
      }
      print(result, getFormat(emailsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Templates Commands
// ============================================
const templatesCmd = program
  .command('templates')
  .description('Manage email templates');

templatesCmd
  .command('list')
  .description('List all templates')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.templates.list();
      print(result.data, getFormat(templatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templatesCmd
  .command('get <id>')
  .description('Get a template by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.templates.get(id);
      print(result, getFormat(templatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templatesCmd
  .command('create')
  .description('Create a new template')
  .requiredOption('--name <name>', 'Template name')
  .requiredOption('--subject <subject>', 'Email subject')
  .requiredOption('--html <html>', 'HTML content')
  .option('--text <text>', 'Plain text content')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.templates.create({
        name: opts.name,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      success('Template created!');
      print(result, getFormat(templatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templatesCmd
  .command('update <id>')
  .description('Update a template')
  .option('--name <name>', 'Template name')
  .option('--subject <subject>', 'Email subject')
  .option('--html <html>', 'HTML content')
  .option('--text <text>', 'Plain text content')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.templates.update(id, {
        name: opts.name,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      success('Template updated!');
      print(result, getFormat(templatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templatesCmd
  .command('delete <id>')
  .description('Delete a template')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.templates.delete(id);
      if (result.deleted) {
        success('Template deleted!');
      }
      print(result, getFormat(templatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templatesCmd
  .command('duplicate <id>')
  .description('Duplicate a template')
  .option('--name <name>', 'New template name')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.templates.duplicate(id, {
        name: opts.name,
      });
      success('Template duplicated!');
      print(result, getFormat(templatesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Domains Commands
// ============================================
const domainsCmd = program
  .command('domains')
  .description('Manage sending domains');

domainsCmd
  .command('list')
  .description('List all domains')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.domains.list();
      print(result.data, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('get <id>')
  .description('Get a domain by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.domains.get(id);
      print(result, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('create')
  .description('Add a new domain')
  .requiredOption('--name <name>', 'Domain name (e.g., example.com)')
  .option('--region <region>', 'Region (us-east-1, eu-west-1, sa-east-1)', 'us-east-1')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.domains.create({
        name: opts.name,
        region: opts.region,
      });
      success('Domain added!');
      print(result, getFormat(domainsCmd));
      info('Add the DNS records shown above to verify your domain.');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('update <id>')
  .description('Update domain settings')
  .option('--click-tracking <enabled>', 'Enable click tracking (true/false)')
  .option('--open-tracking <enabled>', 'Enable open tracking (true/false)')
  .option('--tls <mode>', 'TLS mode (enforced, opportunistic)')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.domains.update(id, {
        click_tracking: opts.clickTracking === 'true' ? true : opts.clickTracking === 'false' ? false : undefined,
        open_tracking: opts.openTracking === 'true' ? true : opts.openTracking === 'false' ? false : undefined,
        tls: opts.tls,
      });
      success('Domain updated!');
      print(result, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('delete <id>')
  .description('Delete a domain')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.domains.delete(id);
      if (result.deleted) {
        success('Domain deleted!');
      }
      print(result, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('verify <id>')
  .description('Verify a domain\'s DNS records')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.domains.verify(id);
      success('Domain verification initiated!');
      print(result, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// API Keys Commands
// ============================================
const apiKeysCmd = program
  .command('api-keys')
  .description('Manage API keys');

apiKeysCmd
  .command('list')
  .description('List all API keys')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.apiKeys.list();
      print(result.data, getFormat(apiKeysCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

apiKeysCmd
  .command('create')
  .description('Create a new API key')
  .requiredOption('--name <name>', 'API key name')
  .option('--permission <permission>', 'Permission level (full_access, sending_access)', 'full_access')
  .option('--domain-id <domainId>', 'Restrict to a specific domain')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.apiKeys.create({
        name: opts.name,
        permission: opts.permission,
        domain_id: opts.domainId,
      });
      success('API key created!');
      warn('Save the token below - it will not be shown again!');
      print(result, getFormat(apiKeysCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

apiKeysCmd
  .command('delete <id>')
  .description('Delete an API key')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.apiKeys.delete(id);
      success('API key deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Audiences Commands
// ============================================
const audiencesCmd = program
  .command('audiences')
  .description('Manage audiences');

audiencesCmd
  .command('list')
  .description('List all audiences')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.audiences.list();
      print(result.data, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('get <id>')
  .description('Get an audience by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.audiences.get(id);
      print(result, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('create')
  .description('Create a new audience')
  .requiredOption('--name <name>', 'Audience name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.audiences.create({
        name: opts.name,
      });
      success('Audience created!');
      print(result, getFormat(audiencesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

audiencesCmd
  .command('delete <id>')
  .description('Delete an audience')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.audiences.delete(id);
      if (result.deleted) {
        success('Audience deleted!');
      }
      print(result, getFormat(audiencesCmd));
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
  .description('Manage contacts within audiences');

contactsCmd
  .command('list <audienceId>')
  .description('List all contacts in an audience')
  .action(async (audienceId: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.list(audienceId);
      print(result.data, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('get <audienceId> <contactId>')
  .description('Get a contact by ID')
  .action(async (audienceId: string, contactId: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.get(audienceId, contactId);
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('create')
  .description('Create a new contact')
  .requiredOption('--audience-id <audienceId>', 'Audience ID')
  .requiredOption('--email <email>', 'Contact email address')
  .option('--first-name <firstName>', 'First name')
  .option('--last-name <lastName>', 'Last name')
  .option('--unsubscribed', 'Mark as unsubscribed')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.create({
        audience_id: opts.audienceId,
        email: opts.email,
        first_name: opts.firstName,
        last_name: opts.lastName,
        unsubscribed: opts.unsubscribed || false,
      });
      success('Contact created!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('update <audienceId> <contactId>')
  .description('Update a contact')
  .option('--first-name <firstName>', 'First name')
  .option('--last-name <lastName>', 'Last name')
  .option('--unsubscribed <unsubscribed>', 'Unsubscribed status (true/false)')
  .action(async (audienceId: string, contactId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.update(audienceId, contactId, {
        first_name: opts.firstName,
        last_name: opts.lastName,
        unsubscribed: opts.unsubscribed === 'true' ? true : opts.unsubscribed === 'false' ? false : undefined,
      });
      success('Contact updated!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('delete <audienceId> <contactId>')
  .description('Delete a contact')
  .action(async (audienceId: string, contactId: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.delete(audienceId, contactId);
      if (result.deleted) {
        success('Contact deleted!');
      }
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('delete-by-email <audienceId> <email>')
  .description('Delete a contact by email address')
  .action(async (audienceId: string, email: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.deleteByEmail(audienceId, email);
      if (result.deleted) {
        success('Contact deleted!');
      }
      print(result, getFormat(contactsCmd));
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

const WEBHOOK_EVENTS: WebhookEvent[] = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.complained',
  'email.bounced',
  'email.opened',
  'email.clicked',
];

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
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a new webhook')
  .requiredOption('--url <url>', 'Endpoint URL')
  .requiredOption('--events <events>', `Events to subscribe to (comma-separated): ${WEBHOOK_EVENTS.join(', ')}`)
  .action(async (opts) => {
    try {
      const events = opts.events.split(',').map((e: string) => e.trim()) as WebhookEvent[];
      const invalidEvents = events.filter(e => !WEBHOOK_EVENTS.includes(e));
      if (invalidEvents.length > 0) {
        error(`Invalid events: ${invalidEvents.join(', ')}`);
        info(`Valid events: ${WEBHOOK_EVENTS.join(', ')}`);
        process.exit(1);
      }

      const client = getClient();
      const result = await client.webhooks.create({
        endpoint_url: opts.url,
        events,
      });
      success('Webhook created!');
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('update <id>')
  .description('Update a webhook')
  .option('--url <url>', 'Endpoint URL')
  .option('--events <events>', `Events to subscribe to (comma-separated): ${WEBHOOK_EVENTS.join(', ')}`)
  .action(async (id: string, opts) => {
    try {
      let events: WebhookEvent[] | undefined;
      if (opts.events) {
        events = opts.events.split(',').map((e: string) => e.trim()) as WebhookEvent[];
        const invalidEvents = events.filter(e => !WEBHOOK_EVENTS.includes(e));
        if (invalidEvents.length > 0) {
          error(`Invalid events: ${invalidEvents.join(', ')}`);
          info(`Valid events: ${WEBHOOK_EVENTS.join(', ')}`);
          process.exit(1);
        }
      }

      const client = getClient();
      const result = await client.webhooks.update(id, {
        endpoint_url: opts.url,
        events,
      });
      success('Webhook updated!');
      print(result, getFormat(webhooksCmd));
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
      const result = await client.webhooks.delete(id);
      if (result.deleted) {
        success('Webhook deleted!');
      }
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Broadcasts Commands
// ============================================
const broadcastsCmd = program
  .command('broadcasts')
  .description('Manage email broadcasts/campaigns');

broadcastsCmd
  .command('list')
  .description('List all broadcasts')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.broadcasts.list();
      print(result.data, getFormat(broadcastsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

broadcastsCmd
  .command('get <id>')
  .description('Get a broadcast by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.broadcasts.get(id);
      print(result, getFormat(broadcastsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

broadcastsCmd
  .command('create')
  .description('Create a new broadcast')
  .requiredOption('--name <name>', 'Broadcast name')
  .requiredOption('--audience-id <audienceId>', 'Target audience ID')
  .requiredOption('--from <from>', 'Sender email address')
  .requiredOption('--subject <subject>', 'Email subject')
  .option('--reply-to <addresses>', 'Reply-to addresses (comma-separated)')
  .option('--preview-text <text>', 'Preview text')
  .option('--html <html>', 'HTML content')
  .option('--text <text>', 'Plain text content')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.broadcasts.create({
        name: opts.name,
        audience_id: opts.audienceId,
        from: opts.from,
        subject: opts.subject,
        reply_to: opts.replyTo ? opts.replyTo.split(',').map((e: string) => e.trim()) : undefined,
        preview_text: opts.previewText,
        html: opts.html,
        text: opts.text,
      });
      success('Broadcast created!');
      print(result, getFormat(broadcastsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

broadcastsCmd
  .command('update <id>')
  .description('Update a broadcast (drafts only)')
  .option('--name <name>', 'Broadcast name')
  .option('--audience-id <audienceId>', 'Target audience ID')
  .option('--from <from>', 'Sender email address')
  .option('--subject <subject>', 'Email subject')
  .option('--reply-to <addresses>', 'Reply-to addresses (comma-separated)')
  .option('--preview-text <text>', 'Preview text')
  .option('--html <html>', 'HTML content')
  .option('--text <text>', 'Plain text content')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.broadcasts.update(id, {
        name: opts.name,
        audience_id: opts.audienceId,
        from: opts.from,
        subject: opts.subject,
        reply_to: opts.replyTo ? opts.replyTo.split(',').map((e: string) => e.trim()) : undefined,
        preview_text: opts.previewText,
        html: opts.html,
        text: opts.text,
      });
      success('Broadcast updated!');
      print(result, getFormat(broadcastsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

broadcastsCmd
  .command('delete <id>')
  .description('Delete a broadcast (drafts only)')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.broadcasts.delete(id);
      if (result.deleted) {
        success('Broadcast deleted!');
      }
      print(result, getFormat(broadcastsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

broadcastsCmd
  .command('send <id>')
  .description('Send a broadcast immediately or schedule it')
  .option('--schedule <datetime>', 'Schedule for later (ISO 8601 format)')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.broadcasts.send(id, {
        scheduled_at: opts.schedule,
      });
      if (opts.schedule) {
        success('Broadcast scheduled!');
      } else {
        success('Broadcast sent!');
      }
      print(result, getFormat(broadcastsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
