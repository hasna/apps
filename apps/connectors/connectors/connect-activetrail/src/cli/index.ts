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

const CONNECTOR_NAME = 'connect-activetrail';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('ActiveTrail email marketing API connector CLI')
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
      process.env.ACTIVETRAIL_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ACTIVETRAIL_API_KEY environment variable.`);
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
// Contacts Commands
// ============================================
const contactsCmd = program
  .command('contacts')
  .description('Manage contacts');

contactsCmd
  .command('list')
  .description('List contacts')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page (max 100)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.list({
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
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
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.get(parseInt(id));
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('create')
  .description('Create a new contact')
  .requiredOption('--email <email>', 'Contact email')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .option('--company <company>', 'Company name')
  .option('--city <city>', 'City')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.create({
        Email: opts.email,
        FirstName: opts.firstName,
        LastName: opts.lastName,
        Phone1: opts.phone,
        Company: opts.company,
        City: opts.city,
      });
      success('Contact created!');
      print(result, getFormat(contactsCmd));
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
  .option('--phone <phone>', 'Phone number')
  .option('--company <company>', 'Company name')
  .option('--city <city>', 'City')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      await client.contacts.update(parseInt(id), {
        FirstName: opts.firstName,
        LastName: opts.lastName,
        Phone1: opts.phone,
        Company: opts.company,
        City: opts.city,
      });
      success('Contact updated!');
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
      await client.contacts.delete(parseInt(id));
      success('Contact deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('unsubscribers')
  .description('List unsubscribed contacts')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.getUnsubscribers({
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Groups Commands
// ============================================
const groupsCmd = program
  .command('groups')
  .description('Manage contact groups');

groupsCmd
  .command('list')
  .description('List groups')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.groups.list({
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('get <id>')
  .description('Get a group by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.groups.get(parseInt(id));
      print(result, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('create')
  .description('Create a new group')
  .requiredOption('--name <name>', 'Group name')
  .option('--description <desc>', 'Group description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.groups.create({
        Name: opts.name,
        Description: opts.description,
      });
      success('Group created!');
      print(result, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('update <id>')
  .description('Update a group')
  .option('--name <name>', 'Group name')
  .option('--description <desc>', 'Group description')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      await client.groups.update(parseInt(id), {
        Name: opts.name,
        Description: opts.description,
      });
      success('Group updated!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('delete <id>')
  .description('Delete a group')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.groups.delete(parseInt(id));
      success('Group deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('members <id>')
  .description('List group members')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.groups.getMembers(parseInt(id), {
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('add-member <groupId> <contactId>')
  .description('Add a contact to a group')
  .action(async (groupId: string, contactId: string) => {
    try {
      const client = getClient();
      await client.groups.addMember(parseInt(groupId), parseInt(contactId));
      success(`Added contact ${contactId} to group ${groupId}!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('remove-member <groupId> <memberId>')
  .description('Remove a member from a group')
  .action(async (groupId: string, memberId: string) => {
    try {
      const client = getClient();
      await client.groups.removeMember(parseInt(groupId), parseInt(memberId));
      success(`Removed member ${memberId} from group ${groupId}!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Campaigns Commands
// ============================================
const campaignsCmd = program
  .command('campaigns')
  .description('Manage email campaigns');

campaignsCmd
  .command('list')
  .description('List campaigns')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.list({
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('get <id>')
  .description('Get a campaign by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.campaigns.get(parseInt(id));
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('create')
  .description('Create a new campaign')
  .requiredOption('--name <name>', 'Campaign name')
  .requiredOption('--subject <subject>', 'Email subject')
  .requiredOption('--from-name <name>', 'Sender name')
  .requiredOption('--from-address <email>', 'Sender email address')
  .option('--reply-to <email>', 'Reply-to email address')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.create({
        Name: opts.name,
        Subject: opts.subject,
        FromName: opts.fromName,
        FromAddress: opts.fromAddress,
        ReplyTo: opts.replyTo,
      });
      success('Campaign created!');
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('update <id>')
  .description('Update a campaign')
  .option('--name <name>', 'Campaign name')
  .option('--subject <subject>', 'Email subject')
  .option('--from-name <name>', 'Sender name')
  .option('--from-address <email>', 'Sender email address')
  .option('--reply-to <email>', 'Reply-to email address')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      await client.campaigns.update(parseInt(id), {
        Name: opts.name,
        Subject: opts.subject,
        FromName: opts.fromName,
        FromAddress: opts.fromAddress,
        ReplyTo: opts.replyTo,
      });
      success('Campaign updated!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('delete <id>')
  .description('Delete a campaign')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.campaigns.delete(parseInt(id));
      success('Campaign deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('sent')
  .description('List sent campaigns')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.getSentCampaigns({
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Reports Commands
// ============================================
const reportsCmd = program
  .command('reports')
  .description('View campaign reports');

reportsCmd
  .command('list')
  .description('List campaign reports')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.reports.list({
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('get <campaignId>')
  .description('Get report for a campaign')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.reports.get(parseInt(campaignId));
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('opens <campaignId>')
  .description('Get opens for a campaign')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getOpens(parseInt(campaignId), {
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('clicks <campaignId>')
  .description('Get clicks for a campaign')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getClicks(parseInt(campaignId), {
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('bounces <campaignId>')
  .description('Get bounces for a campaign')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getBounces(parseInt(campaignId), {
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('unsubscribed <campaignId>')
  .description('Get unsubscribed contacts for a campaign')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getUnsubscribed(parseInt(campaignId), {
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Automations Commands
// ============================================
const automationsCmd = program
  .command('automations')
  .description('Manage automations');

automationsCmd
  .command('list')
  .description('List automations')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.automations.list({
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(automationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

automationsCmd
  .command('get <id>')
  .description('Get an automation by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.automations.get(parseInt(id));
      print(result, getFormat(automationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

automationsCmd
  .command('delete <id>')
  .description('Delete an automation')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.automations.delete(parseInt(id));
      success('Automation deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

automationsCmd
  .command('details <id>')
  .description('Get automation details')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.automations.getDetails(parseInt(id));
      print(result, getFormat(automationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

automationsCmd
  .command('activate <id>')
  .description('Activate an automation')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.automations.activate(parseInt(id), true);
      success('Automation activated!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

automationsCmd
  .command('deactivate <id>')
  .description('Deactivate an automation')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.automations.activate(parseInt(id), false);
      success('Automation deactivated!');
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
  .description('List templates')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.templates.list({
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(templatesCmd));
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
      const result = await client.templates.get(parseInt(id));
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
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.templates.create({
        Name: opts.name,
        Subject: opts.subject,
        HtmlContent: opts.html,
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
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      await client.templates.update(parseInt(id), {
        Name: opts.name,
        Subject: opts.subject,
        HtmlContent: opts.html,
      });
      success('Template updated!');
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
      await client.templates.delete(parseInt(id));
      success('Template deleted!');
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
  .description('Manage webhooks');

webhooksCmd
  .command('list')
  .description('List webhooks')
  .option('--page <number>', 'Page number')
  .option('--limit <number>', 'Results per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.webhooks.list({
        Page: opts.page ? parseInt(opts.page) : undefined,
        Limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a new webhook')
  .requiredOption('--url <url>', 'Webhook URL')
  .requiredOption('--event <type>', 'Event type')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.webhooks.create({
        Url: opts.url,
        EventType: opts.event,
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
  .option('--url <url>', 'Webhook URL')
  .option('--event <type>', 'Event type')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      await client.webhooks.update(parseInt(id), {
        Url: opts.url,
        EventType: opts.event,
      });
      success('Webhook updated!');
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
      await client.webhooks.delete(parseInt(id));
      success('Webhook deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('test <id>')
  .description('Test a webhook')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.webhooks.test(parseInt(id));
      success('Webhook test sent!');
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
