#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Maropost } from '../api';
import {
  getApiKey,
  setApiKey,
  getAccountId,
  setAccountId,
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

const CONNECTOR_NAME = 'connect-maropost';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Maropost Marketing Cloud API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-a, --account-id <id>', 'Account ID (overrides config)')
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
      process.env.MAROPOST_API_KEY = opts.apiKey;
    }
    // Set Account ID from flag if provided
    if (opts.accountId) {
      process.env.MAROPOST_ACCOUNT_ID = opts.accountId;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Maropost {
  const apiKey = getApiKey();
  const accountId = getAccountId();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set MAROPOST_API_KEY environment variable.`);
    process.exit(1);
  }
  if (!accountId) {
    error(`No account ID configured. Run "${CONNECTOR_NAME} config set-account <id>" or set MAROPOST_ACCOUNT_ID environment variable.`);
    process.exit(1);
  }

  return new Maropost({ apiKey, accountId });
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
  .option('--account-id <id>', 'Account ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      accountId: opts.accountId ? parseInt(opts.accountId, 10) : undefined,
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
    info(`Account ID: ${config.accountId || chalk.gray('not set')}`);
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
  .command('set-account <accountId>')
  .description('Set account ID')
  .action((accountId: string) => {
    const id = parseInt(accountId, 10);
    if (isNaN(id)) {
      error('Account ID must be a number');
      process.exit(1);
    }
    setAccountId(id);
    success(`Account ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const accountId = getAccountId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Account ID: ${accountId || chalk.gray('not set')}`);
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
  .command('list <listId>')
  .description('List contacts in a list')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.listInList(parseInt(listId, 10), {
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
      });
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('get <email>')
  .description('Get contact by email')
  .action(async (email: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.getByEmail(email);
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
  .option('--list-ids <ids>', 'Comma-separated list IDs to subscribe')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {
        email: opts.email,
      };
      if (opts.firstName) params.first_name = opts.firstName;
      if (opts.lastName) params.last_name = opts.lastName;
      if (opts.phone) params.phone = opts.phone;
      if (opts.listIds) params.list_ids = opts.listIds;

      const result = await client.contacts.create(params as any);
      success('Contact created!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('update <contactId>')
  .description('Update a contact')
  .option('--email <email>', 'Email address')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .option('--phone <phone>', 'Phone number')
  .action(async (contactId: string, opts) => {
    try {
      const client = getClient();
      const updates: Record<string, unknown> = {};
      if (opts.email) updates.email = opts.email;
      if (opts.firstName) updates.first_name = opts.firstName;
      if (opts.lastName) updates.last_name = opts.lastName;
      if (opts.phone) updates.phone = opts.phone;

      const result = await client.contacts.update(parseInt(contactId, 10), updates);
      success('Contact updated!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('delete <contactId>')
  .description('Delete a contact')
  .action(async (contactId: string) => {
    try {
      const client = getClient();
      await client.contacts.delete(parseInt(contactId, 10));
      success('Contact deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('add-to-list <listId> <email>')
  .description('Add contact to a list')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .action(async (listId: string, email: string, opts) => {
    try {
      const client = getClient();
      const result = await client.lists.addContact(parseInt(listId, 10), {
        email,
        first_name: opts.firstName,
        last_name: opts.lastName,
      });
      success('Contact added to list!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('remove-from-list <listId> <contactId>')
  .description('Remove contact from a list')
  .action(async (listId: string, contactId: string) => {
    try {
      const client = getClient();
      await client.lists.removeContact(
        parseInt(listId, 10),
        parseInt(contactId, 10)
      );
      success('Contact removed from list!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('add-tag <email> <tag>')
  .description('Add tag to contact by email')
  .action(async (email: string, tag: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.addTags(email, [tag]);
      success('Tag added!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('remove-tag <email> <tag>')
  .description('Remove tag from contact by email')
  .action(async (email: string, tag: string) => {
    try {
      const client = getClient();
      const result = await client.contacts.removeTags(email, [tag]);
      success('Tag removed!');
      print(result, getFormat(contactsCmd));
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
  .description('Manage lists');

listsCmd
  .command('list')
  .description('List all lists')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.lists.list({
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
      });
      print(result, getFormat(listsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('get <listId>')
  .description('Get list by ID')
  .action(async (listId: string) => {
    try {
      const client = getClient();
      const result = await client.lists.get(parseInt(listId, 10));
      print(result, getFormat(listsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('create')
  .description('Create a new list')
  .requiredOption('-n, --name <name>', 'List name')
  .option('--subscribe-email <email>', 'Subscribe notification email')
  .option('--unsubscribe-email <email>', 'Unsubscribe notification email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.lists.create({
        name: opts.name,
        subscribe_email: opts.subscribeEmail,
        unsubscribe_email: opts.unsubscribeEmail,
      });
      success('List created!');
      print(result, getFormat(listsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('update <listId>')
  .description('Update a list')
  .option('-n, --name <name>', 'List name')
  .option('--subscribe-email <email>', 'Subscribe notification email')
  .option('--unsubscribe-email <email>', 'Unsubscribe notification email')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const updates: Record<string, string> = {};
      if (opts.name) updates.name = opts.name;
      if (opts.subscribeEmail) updates.subscribe_email = opts.subscribeEmail;
      if (opts.unsubscribeEmail) updates.unsubscribe_email = opts.unsubscribeEmail;

      const result = await client.lists.update(parseInt(listId, 10), updates as any);
      success('List updated!');
      print(result, getFormat(listsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('delete <listId>')
  .description('Delete a list')
  .action(async (listId: string) => {
    try {
      const client = getClient();
      await client.lists.delete(parseInt(listId, 10));
      success('List deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listsCmd
  .command('contacts <listId>')
  .description('List contacts in a list (alias for contacts list)')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.listInList(parseInt(listId, 10), {
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
      });
      print(result, getFormat(listsCmd));
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
  .description('Manage campaigns');

campaignsCmd
  .command('list')
  .description('List all campaigns')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.list({
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
      });
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('get <campaignId>')
  .description('Get campaign by ID')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.campaigns.get(parseInt(campaignId, 10));
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('opens <campaignId>')
  .description('Get campaign opens')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .option('--unique', 'Unique opens only')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.getOpenReport(parseInt(campaignId, 10), {
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
        unique: opts.unique,
      });
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('clicks <campaignId>')
  .description('Get campaign clicks')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .option('--unique', 'Unique clicks only')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.getClickReport(parseInt(campaignId, 10), {
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
        unique: opts.unique,
      });
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('bounces <campaignId>')
  .description('Get campaign bounces')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .option('--hard', 'Hard bounces only')
  .option('--soft', 'Soft bounces only')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      let result;
      if (opts.hard) {
        result = await client.campaigns.getHardBounceReport(parseInt(campaignId, 10), {
          page: parseInt(opts.page, 10),
          per: parseInt(opts.per, 10),
        });
      } else if (opts.soft) {
        result = await client.campaigns.getSoftBounceReport(parseInt(campaignId, 10), {
          page: parseInt(opts.page, 10),
          per: parseInt(opts.per, 10),
        });
      } else {
        result = await client.campaigns.getBounceReport(parseInt(campaignId, 10), {
          page: parseInt(opts.page, 10),
          per: parseInt(opts.per, 10),
        });
      }
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('unsubscribes <campaignId>')
  .description('Get campaign unsubscribes')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.getUnsubscribeReport(parseInt(campaignId, 10), {
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
      });
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('complaints <campaignId>')
  .description('Get campaign spam complaints')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.getComplaintReport(parseInt(campaignId, 10), {
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
      });
      print(result, getFormat(campaignsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignsCmd
  .command('deliveries <campaignId>')
  .description('Get campaign deliveries')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.campaigns.getDeliveredReport(parseInt(campaignId, 10), {
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
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
  .description('View reports and analytics');

reportsCmd
  .command('opens')
  .description('Get account-wide opens')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getOpens({
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
        from: opts.from,
        to: opts.to,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('clicks')
  .description('Get account-wide clicks')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getClicks({
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
        from: opts.from,
        to: opts.to,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('bounces')
  .description('Get account-wide bounces')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getBounces({
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
        from: opts.from,
        to: opts.to,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('unsubscribes')
  .description('Get account-wide unsubscribes')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getUnsubscribes({
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
        from: opts.from,
        to: opts.to,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('complaints')
  .description('Get account-wide spam complaints')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getComplaints({
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
        from: opts.from,
        to: opts.to,
      });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Journeys Commands
// ============================================
const journeysCmd = program
  .command('journeys')
  .description('Manage automated journeys');

journeysCmd
  .command('list')
  .description('List all journeys')
  .option('--page <number>', 'Page number', '1')
  .option('--per <number>', 'Items per page', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.journeys.list({
        page: parseInt(opts.page, 10),
        per: parseInt(opts.per, 10),
      });
      print(result, getFormat(journeysCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

journeysCmd
  .command('get <journeyId>')
  .description('Get journey by ID')
  .action(async (journeyId: string) => {
    try {
      const client = getClient();
      const result = await client.journeys.get(parseInt(journeyId, 10));
      print(result, getFormat(journeysCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

journeysCmd
  .command('pause <journeyId> <contactId>')
  .description('Pause journey for a contact')
  .action(async (journeyId: string, contactId: string) => {
    try {
      const client = getClient();
      const result = await client.journeys.pauseForContact(
        parseInt(journeyId, 10),
        parseInt(contactId, 10)
      );
      success('Journey paused for contact!');
      print(result, getFormat(journeysCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

journeysCmd
  .command('resume <journeyId> <contactId>')
  .description('Resume journey for a contact')
  .action(async (journeyId: string, contactId: string) => {
    try {
      const client = getClient();
      const result = await client.journeys.resumeForContact(
        parseInt(journeyId, 10),
        parseInt(contactId, 10)
      );
      success('Journey resumed for contact!');
      print(result, getFormat(journeysCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

journeysCmd
  .command('reset <journeyId> <contactId>')
  .description('Reset journey for a contact')
  .action(async (journeyId: string, contactId: string) => {
    try {
      const client = getClient();
      const result = await client.journeys.resetForContact(
        parseInt(journeyId, 10),
        parseInt(contactId, 10)
      );
      success('Journey reset for contact!');
      print(result, getFormat(journeysCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

journeysCmd
  .command('add-contact <journeyId> <email>')
  .description('Add contact to journey by email')
  .action(async (journeyId: string, email: string) => {
    try {
      const client = getClient();
      const result = await client.journeys.addContact(parseInt(journeyId, 10), email);
      success('Contact added to journey!');
      print(result, getFormat(journeysCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Transactional Email Commands
// ============================================
const transactionalCmd = program
  .command('transactional')
  .alias('tx')
  .description('Send transactional emails via JetSend');

transactionalCmd
  .command('send')
  .description('Send a transactional email')
  .requiredOption('--to <email>', 'Recipient email')
  .requiredOption('--subject <subject>', 'Email subject')
  .option('--to-name <name>', 'Recipient name')
  .option('--html <html>', 'HTML content')
  .option('--text <text>', 'Text content')
  .option('--from-email <email>', 'From email')
  .option('--from-name <name>', 'From name')
  .option('--reply-to <email>', 'Reply-to email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.transactional.sendSimple({
        to: opts.to,
        toName: opts.toName,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        from: opts.fromEmail ? { email: opts.fromEmail, name: opts.fromName } : undefined,
        replyTo: opts.replyTo,
      });
      success('Transactional email sent!');
      print(result, getFormat(transactionalCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
