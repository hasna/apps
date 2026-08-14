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

const CONNECTOR_NAME = 'connect-acquire';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Acquire.io API connector - customer support platform (live chat, email, VoIP, SMS)')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-a, --account-id <id>', 'Account ID (subdomain)')
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
      process.env.ACQUIRE_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ACQUIRE_API_KEY environment variable.`);
    process.exit(1);
  }
  const opts = program.opts();
  return new Connector({ apiKey, accountId: opts.accountId });
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
  .option('-l, --limit <number>', 'Maximum results')
  .option('-w, --where <filter>', 'Filter expression (e.g. "email|=|user@example.com")')
  .option('-r, --relations <relations>', 'Include relations (pipe-separated)')
  .option('-s, --select <fields>', 'Select fields (pipe-separated)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        where: opts.where,
        relations: opts.relations,
        select: opts.select,
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
  .option('-r, --relations <relations>', 'Include relations')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.get(parseInt(id), {
        relations: opts.relations,
      });
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('create')
  .description('Create a new contact')
  .option('-n, --name <name>', 'Contact name')
  .option('-e, --email <email>', 'Contact email')
  .option('--phone <phone>', 'Contact phone')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.create({
        name: opts.name,
        email: opts.email,
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
  .option('-n, --name <name>', 'Contact name')
  .option('-e, --email <email>', 'Contact email')
  .option('--phone <phone>', 'Contact phone')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.name) params.name = opts.name;
      if (opts.email) params.email = opts.email;
      if (opts.phone) params.phone = opts.phone;
      const result = await client.contacts.update(parseInt(id), params);
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
      await client.contacts.delete(parseInt(id));
      success('Contact deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('search')
  .description('Search contacts')
  .option('-q, --query <query>', 'Search query')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.contacts.search({
        search: opts.query,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('merge <primaryId> <sourceIds...>')
  .description('Merge contacts into a primary contact')
  .action(async (primaryId: string, sourceIds: string[]) => {
    try {
      const client = getClient();
      const result = await client.contacts.merge(
        parseInt(primaryId),
        sourceIds.map(id => parseInt(id)),
      );
      success('Contacts merged!');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Cases Commands
// ============================================
const casesCmd = program
  .command('cases')
  .description('Manage cases/conversations');

casesCmd
  .command('list')
  .description('List cases')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-w, --where <filter>', 'Filter expression')
  .option('-r, --relations <relations>', 'Include relations')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.cases.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        where: opts.where,
        relations: opts.relations,
      });
      print(result, getFormat(casesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

casesCmd
  .command('create <contactId>')
  .description('Create a new case for a contact')
  .action(async (contactId: string) => {
    try {
      const client = getClient();
      const result = await client.cases.create({
        contactId: parseInt(contactId),
      });
      success('Case created!');
      print(result, getFormat(casesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

casesCmd
  .command('reopen')
  .description('Reopen a closed case')
  .requiredOption('--contact-id <id>', 'Contact ID')
  .requiredOption('--session-id <id>', 'Session ID')
  .requiredOption('--thread-id <id>', 'Thread ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.cases.reopen({
        contactId: parseInt(opts.contactId),
        sessionId: opts.sessionId,
        threadId: opts.threadId,
      });
      success('Case reopened!');
      print(result, getFormat(casesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

casesCmd
  .command('send-message')
  .description('Send a chat message')
  .requiredOption('-m, --message <message>', 'Message content')
  .option('--thread-id <id>', 'Thread ID')
  .option('--session-id <id>', 'Session ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.cases.sendMessage({
        message: opts.message,
        threadId: opts.threadId,
        sessionId: opts.sessionId,
      });
      success('Message sent!');
      print(result, getFormat(casesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

casesCmd
  .command('send-email')
  .description('Send an email message')
  .requiredOption('--to <email>', 'Recipient email')
  .requiredOption('--from <email>', 'Sender email')
  .requiredOption('--subject <subject>', 'Email subject')
  .requiredOption('--body <html>', 'Email HTML body')
  .option('--cc <email>', 'CC email')
  .option('--bcc <email>', 'BCC email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.cases.sendEmail({
        to: opts.to,
        from: opts.from,
        subject: opts.subject,
        htmlBody: opts.body,
        cc: opts.cc,
        bcc: opts.bcc,
      });
      success('Email sent!');
      print(result, getFormat(casesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

casesCmd
  .command('send-sms')
  .description('Send an SMS message')
  .requiredOption('--from <number>', 'Sender phone number')
  .requiredOption('--to <number>', 'Recipient phone number')
  .requiredOption('--body <text>', 'SMS body')
  .option('--contact-id <id>', 'Contact ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.cases.sendSms({
        From: opts.from,
        To: opts.to,
        Body: opts.body,
        contactId: opts.contactId ? parseInt(opts.contactId) : undefined,
      });
      success('SMS sent!');
      print(result, getFormat(casesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

casesCmd
  .command('delete-message <messageId>')
  .description('Delete a case message')
  .action(async (messageId: string) => {
    try {
      const client = getClient();
      await client.cases.deleteMessage(parseInt(messageId));
      success('Message deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Companies Commands
// ============================================
const companiesCmd = program
  .command('companies')
  .description('Manage companies');

companiesCmd
  .command('list')
  .description('List companies')
  .option('-l, --limit <number>', 'Maximum results')
  .option('-w, --where <filter>', 'Filter expression')
  .option('-r, --relations <relations>', 'Include relations')
  .option('-s, --select <fields>', 'Select fields')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.companies.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        where: opts.where,
        relations: opts.relations,
        select: opts.select,
      });
      print(result, getFormat(companiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companiesCmd
  .command('get <id>')
  .description('Get a company by ID')
  .option('-r, --relations <relations>', 'Include relations')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.companies.get(parseInt(id), {
        relations: opts.relations,
      });
      print(result, getFormat(companiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companiesCmd
  .command('create')
  .description('Create a new company')
  .requiredOption('-n, --name <name>', 'Company name')
  .option('-w, --website <url>', 'Company website')
  .option('-i, --industry <industry>', 'Company industry')
  .action(async (opts) => {
    try {
      const client = getClient();
      const fields: { name: string; website?: string; industry?: string } = { name: opts.name };
      if (opts.website) fields.website = opts.website;
      if (opts.industry) fields.industry = opts.industry;
      const result = await client.companies.create({ fields });
      success('Company created!');
      print(result, getFormat(companiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companiesCmd
  .command('update <id>')
  .description('Update a company')
  .option('-n, --name <name>', 'Company name')
  .option('-w, --website <url>', 'Company website')
  .option('-i, --industry <industry>', 'Company industry')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const fields: Record<string, unknown> = {};
      if (opts.name) fields.name = opts.name;
      if (opts.website) fields.website = opts.website;
      if (opts.industry) fields.industry = opts.industry;
      const result = await client.companies.update(parseInt(id), { fields });
      success('Company updated!');
      print(result, getFormat(companiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companiesCmd
  .command('delete <id>')
  .description('Delete a company')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.companies.delete(parseInt(id));
      success('Company deleted!');
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
  .command('list')
  .description('List notes')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.notes.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      print(result, getFormat(notesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

notesCmd
  .command('create')
  .description('Create a new note')
  .requiredOption('--contact-id <id>', 'Contact ID')
  .requiredOption('-t, --title <title>', 'Note title')
  .option('-d, --description <text>', 'Note description')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.notes.create({
        contactId: parseInt(opts.contactId),
        title: opts.title,
        description: opts.description,
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
  .option('-t, --title <title>', 'Note title')
  .option('-d, --description <text>', 'Note description')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.title) params.title = opts.title;
      if (opts.description) params.description = opts.description;
      const result = await client.notes.update(parseInt(id), params);
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
      await client.notes.delete(parseInt(id));
      success('Note deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Knowledge Base Commands
// ============================================
const kbCmd = program
  .command('kb')
  .description('Manage knowledge base');

kbCmd
  .command('create-group')
  .description('Create a knowledge base group')
  .requiredOption('-n, --name <name>', 'Group name')
  .option('--domain <domain>', 'Custom domain')
  .option('--language <lang>', 'Language code')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.knowledgeBase.createGroup({
        name: opts.name,
        customDomain: opts.domain,
        language: opts.language,
      });
      success('Knowledge base group created!');
      print(result, getFormat(kbCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

kbCmd
  .command('update-article <articleId>')
  .description('Update a knowledge base article')
  .option('-t, --title <title>', 'Article title')
  .option('-d, --description <text>', 'Article description')
  .option('--status <status>', 'Article status')
  .option('--seo-title <title>', 'SEO title')
  .option('--seo-description <text>', 'SEO description')
  .action(async (articleId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, unknown> = {};
      if (opts.title) params.title = opts.title;
      if (opts.description) params.description = opts.description;
      if (opts.status) params.status = opts.status;
      if (opts.seoTitle) params.seoTitle = opts.seoTitle;
      if (opts.seoDescription) params.seoDescription = opts.seoDescription;
      const result = await client.knowledgeBase.updateArticle(parseInt(articleId), params);
      success('Article updated!');
      print(result, getFormat(kbCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Analytics Commands
// ============================================
const analyticsCmd = program
  .command('analytics')
  .description('View analytics and metrics');

analyticsCmd
  .command('calls')
  .description('Get VoIP calls overview')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--output <format>', 'Output format (json, csv)', 'json')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.analytics.callsOverview({
        start_date: opts.start,
        end_date: opts.end,
        output: opts.output,
      });
      print(result, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('sms')
  .description('Get SMS metrics')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--output <format>', 'Output format (json, csv)', 'json')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.analytics.smsMetrics({
        start_date: opts.start,
        end_date: opts.end,
        output: opts.output,
      });
      print(result, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('call-analysis')
  .description('Get call analysis data')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--output <format>', 'Output format (json, csv)', 'json')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.analytics.callAnalysis({
        start_date: opts.start,
        end_date: opts.end,
        output: opts.output,
      });
      print(result, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
