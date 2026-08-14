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

const CONNECTOR_NAME = 'connect-activecampaign';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('ActiveCampaign API connector - CRM, marketing automation, contacts, deals, campaigns')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'Account URL (e.g. https://youraccountname.api-us1.com)')
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
      process.env.ACTIVECAMPAIGN_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }

    if (opts.baseUrl) {
      process.env.ACTIVECAMPAIGN_BASE_URL = opts.baseUrl;
      debug('Base URL set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ACTIVECAMPAIGN_API_KEY environment variable.`);
    process.exit(1);
  }
  const baseUrl = process.env.ACTIVECAMPAIGN_BASE_URL || loadProfile().apiSecret;
  if (!baseUrl) {
    error(`No base URL configured. Use --base-url flag or set ACTIVECAMPAIGN_BASE_URL environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl });
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
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('--email <email>', 'Filter by email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const filters: Record<string, string | number> = {};
      if (opts.email) filters['filters[email]'] = opts.email;
      const result = await client.contacts.list({ limit: parseInt(opts.limit), offset: parseInt(opts.offset), filters });
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

contactsCmd
  .command('create')
  .description('Create a new contact')
  .requiredOption('-e, --email <email>', 'Email address')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.create({
        email: opts.email,
        firstName: opts.firstName,
        lastName: opts.lastName,
        phone: opts.phone,
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
  .option('-e, --email <email>', 'Email address')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, string> = {};
      if (opts.email) params.email = opts.email;
      if (opts.firstName) params.firstName = opts.firstName;
      if (opts.lastName) params.lastName = opts.lastName;
      if (opts.phone) params.phone = opts.phone;
      const result = await client.contacts.update(id, params as never);
      success('Contact updated!');
      print(result, getFormat(contactsCmd));
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

contactsCmd
  .command('sync')
  .description('Sync (upsert) a contact by email')
  .requiredOption('-e, --email <email>', 'Email address')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.sync({
        email: opts.email,
        firstName: opts.firstName,
        lastName: opts.lastName,
        phone: opts.phone,
      });
      success('Contact synced!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('tags <contactId>')
  .description('List tags for a contact')
  .action(async (contactId: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.listTags(contactId);
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('add-tag')
  .description('Add a tag to a contact')
  .requiredOption('-c, --contact <id>', 'Contact ID')
  .requiredOption('-t, --tag <id>', 'Tag ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.addTag(opts.contact, opts.tag);
      success('Tag added to contact!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('remove-tag <contactTagId>')
  .description('Remove a tag from a contact')
  .action(async (contactTagId: string) => {
    try {
      const client = getClient();
      await client.contacts.removeTag(contactTagId);
      success('Tag removed from contact!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Deals Commands
// ============================================
const dealsCmd = program
  .command('deals')
  .description('Manage deals (CRM)');

dealsCmd
  .command('list')
  .description('List deals')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.deals.list({ limit: parseInt(opts.limit), offset: parseInt(opts.offset) });
      print(result, getFormat(dealsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealsCmd
  .command('get <id>')
  .description('Get a deal by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.deals.get(id);
      print(result, getFormat(dealsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealsCmd
  .command('create')
  .description('Create a new deal')
  .requiredOption('-t, --title <title>', 'Deal title')
  .requiredOption('--value <value>', 'Deal value')
  .requiredOption('--currency <currency>', 'Currency code (e.g. usd)')
  .option('--stage <id>', 'Stage ID')
  .option('--owner <id>', 'Owner ID')
  .option('--contact <id>', 'Contact ID')
  .option('--description <desc>', 'Deal description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.deals.create({
        title: opts.title,
        value: parseInt(opts.value),
        currency: opts.currency,
        stage: opts.stage,
        owner: opts.owner,
        contact: opts.contact,
        description: opts.description,
      } as never);
      success('Deal created!');
      print(result, getFormat(dealsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealsCmd
  .command('update <id>')
  .description('Update a deal')
  .option('-t, --title <title>', 'Deal title')
  .option('--value <value>', 'Deal value')
  .option('--currency <currency>', 'Currency code')
  .option('--stage <id>', 'Stage ID')
  .option('--owner <id>', 'Owner ID')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number> = {};
      if (opts.title) params.title = opts.title;
      if (opts.value) params.value = parseInt(opts.value);
      if (opts.currency) params.currency = opts.currency;
      if (opts.stage) params.stage = opts.stage;
      if (opts.owner) params.owner = opts.owner;
      const result = await client.deals.update(id, params as never);
      success('Deal updated!');
      print(result, getFormat(dealsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealsCmd
  .command('delete <id>')
  .description('Delete a deal')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deals.delete(id);
      success('Deal deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealsCmd
  .command('stages')
  .description('List deal stages')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.deals.listStages();
      print(result, getFormat(dealsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dealsCmd
  .command('pipelines')
  .description('List deal pipelines')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.deals.listPipelines();
      print(result, getFormat(dealsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Accounts Commands
// ============================================
const accountsCmd = program
  .command('accounts')
  .description('Manage accounts (organizations)');

accountsCmd
  .command('list')
  .description('List accounts')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.list({ limit: parseInt(opts.limit), offset: parseInt(opts.offset) });
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('get <id>')
  .description('Get an account by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.accounts.get(id);
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('create')
  .description('Create a new account')
  .requiredOption('-n, --name <name>', 'Account name')
  .option('--url <url>', 'Account URL')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.create({
        name: opts.name,
        accountUrl: opts.url,
      } as never);
      success('Account created!');
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('update <id>')
  .description('Update an account')
  .option('-n, --name <name>', 'Account name')
  .option('--url <url>', 'Account URL')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, string> = {};
      if (opts.name) params.name = opts.name;
      if (opts.url) params.accountUrl = opts.url;
      const result = await client.accounts.update(id, params as never);
      success('Account updated!');
      print(result, getFormat(accountsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountsCmd
  .command('delete <id>')
  .description('Delete an account')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.accounts.delete(id);
      success('Account deleted!');
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
  .description('View campaigns (read-only)');

campaignsCmd
  .command('list')
  .description('List campaigns')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.list({ limit: parseInt(opts.limit), offset: parseInt(opts.offset) });
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
      const result = await client.campaigns.get(id);
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Tags Commands
// ============================================
const tagsCmd = program
  .command('tags')
  .description('Manage tags');

tagsCmd
  .command('list')
  .description('List tags')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tags.list({ limit: parseInt(opts.limit), offset: parseInt(opts.offset) });
      print(result, getFormat(tagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagsCmd
  .command('get <id>')
  .description('Get a tag by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.tags.get(id);
      print(result, getFormat(tagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagsCmd
  .command('create')
  .description('Create a new tag')
  .requiredOption('-n, --name <name>', 'Tag name')
  .requiredOption('--type <type>', 'Tag type (contact, deal)')
  .option('-d, --description <desc>', 'Tag description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tags.create({
        tag: opts.name,
        tagType: opts.type,
        description: opts.description,
      });
      success('Tag created!');
      print(result, getFormat(tagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagsCmd
  .command('update <id>')
  .description('Update a tag')
  .option('-n, --name <name>', 'Tag name')
  .option('--type <type>', 'Tag type')
  .option('-d, --description <desc>', 'Tag description')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, string> = {};
      if (opts.name) params.tag = opts.name;
      if (opts.type) params.tagType = opts.type;
      if (opts.description) params.description = opts.description;
      const result = await client.tags.update(id, params as never);
      success('Tag updated!');
      print(result, getFormat(tagsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagsCmd
  .command('delete <id>')
  .description('Delete a tag')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.tags.delete(id);
      success('Tag deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Lists Commands
// ============================================
const listsCmd = program
  .command('lists')
  .description('Manage mailing lists');

listsCmd
  .command('list')
  .description('List mailing lists')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.lists.list({ limit: parseInt(opts.limit), offset: parseInt(opts.offset) });
      print(result, getFormat(listsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('get <id>')
  .description('Get a mailing list by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.lists.get(id);
      print(result, getFormat(listsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('create')
  .description('Create a new mailing list')
  .requiredOption('-n, --name <name>', 'List name')
  .requiredOption('--string-id <id>', 'URL-safe list ID')
  .requiredOption('--sender-url <url>', 'Sender URL')
  .requiredOption('--sender-reminder <text>', 'Sender reminder text')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.lists.create({
        name: opts.name,
        stringid: opts.stringId,
        sender_url: opts.senderUrl,
        sender_reminder: opts.senderReminder,
      });
      success('List created!');
      print(result, getFormat(listsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('delete <id>')
  .description('Delete a mailing list')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.lists.delete(id);
      success('List deleted!');
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
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.automations.list({ limit: parseInt(opts.limit), offset: parseInt(opts.offset) });
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
      const result = await client.automations.get(id);
      print(result, getFormat(automationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

automationsCmd
  .command('add-contact')
  .description('Add a contact to an automation')
  .requiredOption('-a, --automation <id>', 'Automation ID')
  .requiredOption('-c, --contact <id>', 'Contact ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.automations.addContact(opts.automation, opts.contact);
      success('Contact added to automation!');
      print(result, getFormat(automationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

automationsCmd
  .command('remove-contact <contactAutomationId>')
  .description('Remove a contact from an automation')
  .action(async (contactAutomationId: string) => {
    try {
      const client = getClient();
      await client.automations.removeContact(contactAutomationId);
      success('Contact removed from automation!');
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
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.webhooks.list({ limit: parseInt(opts.limit), offset: parseInt(opts.offset) });
      print(result, getFormat(webhooksCmd));
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
  .requiredOption('-n, --name <name>', 'Webhook name')
  .requiredOption('--url <url>', 'Webhook URL')
  .requiredOption('--events <events>', 'Comma-separated event names')
  .requiredOption('--sources <sources>', 'Comma-separated source names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.webhooks.create({
        name: opts.name,
        url: opts.url,
        events: opts.events.split(','),
        sources: opts.sources.split(','),
      });
      success('Webhook created!');
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
      await client.webhooks.delete(id);
      success('Webhook deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Notes Commands
// ============================================
const notesCmd = program
  .command('notes')
  .description('Manage notes');

notesCmd
  .command('get <id>')
  .description('Get a note by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.notes.get(id);
      print(result, getFormat(notesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

notesCmd
  .command('create')
  .description('Create a new note')
  .requiredOption('--note <text>', 'Note text')
  .requiredOption('--relid <id>', 'Related entity ID')
  .requiredOption('--reltype <type>', 'Related entity type (e.g. Subscriber, Deal)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.notes.create({
        note: opts.note,
        relid: parseInt(opts.relid),
        reltype: opts.reltype,
      });
      success('Note created!');
      print(result, getFormat(notesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

notesCmd
  .command('update <id>')
  .description('Update a note')
  .requiredOption('--note <text>', 'Note text')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.notes.update(id, opts.note);
      success('Note updated!');
      print(result, getFormat(notesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

notesCmd
  .command('delete <id>')
  .description('Delete a note')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.notes.delete(id);
      success('Note deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
