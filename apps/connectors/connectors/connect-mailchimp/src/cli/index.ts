#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Mailchimp } from '../api';
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
  getServerPrefix,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-mailchimp';
const VERSION = '0.0.2';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Mailchimp connector - Manage audiences, campaigns, templates, and email marketing')
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
      process.env.MAILCHIMP_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Mailchimp {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set MAILCHIMP_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Mailchimp({ apiKey, serverPrefix: getServerPrefix() });
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
// Account Commands
// ============================================
const accountCmd = program
  .command('account')
  .description('Account operations');

accountCmd
  .command('info')
  .description('Get account information')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getAccountInfo();
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('ping')
  .description('Test API connection')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.ping();
      success(`API is healthy: ${result.health_status}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// List/Audience Commands
// ============================================
const listCmd = program
  .command('list')
  .description('Audience/list operations');

listCmd
  .command('ls')
  .description('List all audiences')
  .option('-c, --count <number>', 'Number of results', '10')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listLists({
        count: parseInt(opts.count),
        offset: parseInt(opts.offset),
      });
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('get <listId>')
  .description('Get an audience by ID')
  .action(async (listId: string) => {
    try {
      const client = getClient();
      const result = await client.getList(listId);
      print(result, getFormat(listCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

listCmd
  .command('delete <listId>')
  .description('Delete an audience')
  .action(async (listId: string) => {
    try {
      const client = getClient();
      await client.deleteList(listId);
      success(`Audience ${listId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Member Commands
// ============================================
const memberCmd = program
  .command('member')
  .description('Member/subscriber operations');

memberCmd
  .command('ls <listId>')
  .description('List members in an audience')
  .option('-c, --count <number>', 'Number of results', '10')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listMembers(listId, {
        count: parseInt(opts.count),
        offset: parseInt(opts.offset),
        status: opts.status,
      });
      print(result, getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd
  .command('get <listId> <email>')
  .description('Get a member by email')
  .action(async (listId: string, email: string) => {
    try {
      const client = getClient();
      const result = await client.getMember(listId, email);
      print(result, getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd
  .command('add <listId>')
  .description('Add a member to an audience')
  .requiredOption('-e, --email <email>', 'Email address')
  .option('-s, --status <status>', 'Subscription status', 'subscribed')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const mergeFields: Record<string, unknown> = {};
      if (opts.firstName) mergeFields.FNAME = opts.firstName;
      if (opts.lastName) mergeFields.LNAME = opts.lastName;

      const result = await client.addMember(listId, {
        email_address: opts.email,
        status: opts.status,
        merge_fields: Object.keys(mergeFields).length > 0 ? mergeFields : undefined,
      });
      success('Member added!');
      print(result, getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd
  .command('update <listId> <email>')
  .description('Update a member')
  .option('-s, --status <status>', 'Subscription status')
  .option('--first-name <name>', 'First name')
  .option('--last-name <name>', 'Last name')
  .action(async (listId: string, email: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.status) params.status = opts.status;

      const mergeFields: Record<string, unknown> = {};
      if (opts.firstName) mergeFields.FNAME = opts.firstName;
      if (opts.lastName) mergeFields.LNAME = opts.lastName;
      if (Object.keys(mergeFields).length > 0) params.merge_fields = mergeFields;

      const result = await client.updateMember(listId, email, params);
      success('Member updated!');
      print(result, getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd
  .command('archive <listId> <email>')
  .description('Archive a member')
  .action(async (listId: string, email: string) => {
    try {
      const client = getClient();
      await client.archiveMember(listId, email);
      success(`Member ${email} archived`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd
  .command('tags <listId> <email>')
  .description('Get tags for a member')
  .action(async (listId: string, email: string) => {
    try {
      const client = getClient();
      const result = await client.getMemberTags(listId, email);
      print(result, getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Campaign Commands
// ============================================
const campaignCmd = program
  .command('campaign')
  .description('Campaign operations');

campaignCmd
  .command('ls')
  .description('List campaigns')
  .option('-c, --count <number>', 'Number of results', '10')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('-s, --status <status>', 'Filter by status')
  .option('-t, --type <type>', 'Filter by type')
  .option('--list-id <id>', 'Filter by list ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listCampaigns({
        count: parseInt(opts.count),
        offset: parseInt(opts.offset),
        status: opts.status,
        type: opts.type,
        list_id: opts.listId,
      });
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('get <campaignId>')
  .description('Get a campaign by ID')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.getCampaign(campaignId);
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('create')
  .description('Create a campaign')
  .requiredOption('-t, --type <type>', 'Campaign type (regular, plaintext, absplit, rss, variate)')
  .option('--list-id <id>', 'List ID to send to')
  .option('--subject <subject>', 'Email subject line')
  .option('--from-name <name>', 'From name')
  .option('--reply-to <email>', 'Reply-to email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createCampaign({
        type: opts.type,
        recipients: opts.listId ? { list_id: opts.listId } : undefined,
        settings: {
          subject_line: opts.subject,
          from_name: opts.fromName,
          reply_to: opts.replyTo,
        },
      });
      success('Campaign created!');
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('send <campaignId>')
  .description('Send a campaign')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      await client.sendCampaign(campaignId);
      success(`Campaign ${campaignId} sent!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('schedule <campaignId>')
  .description('Schedule a campaign')
  .requiredOption('--time <datetime>', 'Schedule time (ISO 8601 format)')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      await client.scheduleCampaign(campaignId, opts.time);
      success(`Campaign ${campaignId} scheduled for ${opts.time}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('unschedule <campaignId>')
  .description('Unschedule a campaign')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      await client.unscheduleCampaign(campaignId);
      success(`Campaign ${campaignId} unscheduled`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('replicate <campaignId>')
  .description('Replicate a campaign')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.replicateCampaign(campaignId);
      success('Campaign replicated!');
      print(result, getFormat(campaignCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('delete <campaignId>')
  .description('Delete a campaign')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      await client.deleteCampaign(campaignId);
      success(`Campaign ${campaignId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

campaignCmd
  .command('content <campaignId>')
  .description('Get campaign content')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.getCampaignContent(campaignId);
      print(result, getFormat(campaignCmd));
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
  .description('List templates')
  .option('-c, --count <number>', 'Number of results', '10')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .option('-t, --type <type>', 'Filter by type (user, base, gallery)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTemplates({
        count: parseInt(opts.count),
        offset: parseInt(opts.offset),
        type: opts.type,
      });
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
      const result = await client.getTemplate(parseInt(templateId));
      print(result, getFormat(templateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

templateCmd
  .command('create')
  .description('Create a template')
  .requiredOption('-n, --name <name>', 'Template name')
  .requiredOption('--html <html>', 'HTML content')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createTemplate({
        name: opts.name,
        html: opts.html,
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
      await client.deleteTemplate(parseInt(templateId));
      success(`Template ${templateId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Tag Commands
// ============================================
const tagCmd = program
  .command('tag')
  .description('Tag operations');

tagCmd
  .command('ls <listId>')
  .description('List tags for an audience')
  .option('-c, --count <number>', 'Number of results', '10')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listTags(listId, {
        count: parseInt(opts.count),
      });
      print(result, getFormat(tagCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Segment Commands
// ============================================
const segmentCmd = program
  .command('segment')
  .description('Segment operations');

segmentCmd
  .command('ls <listId>')
  .description('List segments for an audience')
  .option('-c, --count <number>', 'Number of results', '10')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listSegments(listId, {
        count: parseInt(opts.count),
        offset: parseInt(opts.offset),
      });
      print(result, getFormat(segmentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

segmentCmd
  .command('get <listId> <segmentId>')
  .description('Get a segment by ID')
  .action(async (listId: string, segmentId: string) => {
    try {
      const client = getClient();
      const result = await client.getSegment(listId, parseInt(segmentId));
      print(result, getFormat(segmentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

segmentCmd
  .command('create <listId>')
  .description('Create a segment')
  .requiredOption('-n, --name <name>', 'Segment name')
  .action(async (listId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createSegment(listId, {
        name: opts.name,
      });
      success('Segment created!');
      print(result, getFormat(segmentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

segmentCmd
  .command('delete <listId> <segmentId>')
  .description('Delete a segment')
  .action(async (listId: string, segmentId: string) => {
    try {
      const client = getClient();
      await client.deleteSegment(listId, parseInt(segmentId));
      success(`Segment ${segmentId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Report Commands
// ============================================
const reportCmd = program
  .command('report')
  .description('Campaign report operations');

reportCmd
  .command('ls')
  .description('List campaign reports')
  .option('-c, --count <number>', 'Number of results', '10')
  .option('-o, --offset <number>', 'Offset for pagination', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listReports({
        count: parseInt(opts.count),
        offset: parseInt(opts.offset),
      });
      print(result, getFormat(reportCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportCmd
  .command('get <campaignId>')
  .description('Get a campaign report')
  .action(async (campaignId: string) => {
    try {
      const client = getClient();
      const result = await client.getReport(campaignId);
      print(result, getFormat(reportCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportCmd
  .command('clicks <campaignId>')
  .description('Get click details for a campaign')
  .option('-c, --count <number>', 'Number of results', '10')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getClickDetails(campaignId, {
        count: parseInt(opts.count),
      });
      print(result, getFormat(reportCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportCmd
  .command('opens <campaignId>')
  .description('Get open details for a campaign')
  .option('-c, --count <number>', 'Number of results', '10')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getOpenDetails(campaignId, {
        count: parseInt(opts.count),
      });
      print(result, getFormat(reportCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportCmd
  .command('unsubscribes <campaignId>')
  .description('Get unsubscribe details for a campaign')
  .option('-c, --count <number>', 'Number of results', '10')
  .action(async (campaignId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getUnsubscribes(campaignId, {
        count: parseInt(opts.count),
      });
      print(result, getFormat(reportCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
