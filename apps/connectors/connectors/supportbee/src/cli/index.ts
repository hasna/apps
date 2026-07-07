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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-supportbee';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('SupportBee API connector - shared inbox helpdesk, tickets, replies, comments, labels')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Auth token (overrides config)')
  .option('-u, --base-url <url>', 'Company URL (e.g. https://your-company.supportbee.com)')
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
      process.env.SUPPORTBEE_API_KEY = opts.apiKey;
      debug('Auth token set from command line flag');
    }

    if (opts.baseUrl) {
      process.env.SUPPORTBEE_BASE_URL = opts.baseUrl;
      debug('Base URL set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let c: Command | null = cmd;
  while (c) {
    const fmt = c.opts().format;
    if (fmt) return fmt as OutputFormat;
    c = c.parent;
  }
  return 'pretty';
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No auth token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set SUPPORTBEE_API_KEY environment variable.`);
    process.exit(1);
  }
  const baseUrl =
    process.env.SUPPORTBEE_BASE_URL ||
    (process.env.SUPPORTBEE_SUBDOMAIN
      ? `https://${process.env.SUPPORTBEE_SUBDOMAIN}.supportbee.com`
      : undefined) ||
    loadProfile().baseUrl;
  if (!baseUrl) {
    error(`No base URL configured. Use --base-url flag or set SUPPORTBEE_BASE_URL environment variable (e.g. https://your-company.supportbee.com).`);
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
  .option('--api-key <key>', 'Auth token')
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
    info(`Auth Token: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set auth token')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`Auth token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Auth Token: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Ticket Commands
// ============================================
const ticketCmd = program
  .command('ticket')
  .description('Manage tickets');

ticketCmd
  .command('list')
  .description('List tickets')
  .option('--page <number>', 'Page number', '1')
  .option('--per-page <number>', 'Results per page', '25')
  .option('--archived', 'Show archived tickets')
  .option('--spam', 'Show spam tickets')
  .option('--trash', 'Show trashed tickets')
  .option('--assigned-user <id>', 'Filter by assigned user ID')
  .option('--label <name>', 'Filter by label name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tickets.list({
        page: parseInt(opts.page),
        per_page: parseInt(opts.perPage),
        archived: opts.archived,
        spam: opts.spam,
        trash: opts.trash,
        assigned_user: opts.assignedUser,
        label: opts.label,
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
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.tickets.get(id);
      print(result, getFormat(ticketCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketCmd
  .command('create')
  .description('Create a new ticket')
  .requiredOption('-s, --subject <subject>', 'Ticket subject')
  .option('--requester-name <name>', 'Requester name')
  .option('--requester-email <email>', 'Requester email')
  .option('--text <text>', 'Ticket body (plain text)')
  .option('--html <html>', 'Ticket body (HTML)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tickets.create({
        subject: opts.subject,
        requester_name: opts.requesterName,
        requester_email: opts.requesterEmail,
        content: { text: opts.text, html: opts.html },
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
  .description('Move a ticket to trash')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.tickets.delete(id);
      success('Ticket moved to trash!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Reply Commands
// ============================================
const replyCmd = program
  .command('reply')
  .description('Manage ticket replies (customer-facing)');

replyCmd
  .command('list <ticketId>')
  .description('List replies for a ticket')
  .action(async (ticketId: string) => {
    try {
      const client = getClient();
      const result = await client.replies.list(ticketId);
      print(result, getFormat(replyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

replyCmd
  .command('create <ticketId>')
  .description('Add a reply to a ticket')
  .option('--text <text>', 'Reply body (plain text)')
  .option('--html <html>', 'Reply body (HTML)')
  .option('--cc <emails>', 'Comma-separated CC emails')
  .option('--bcc <emails>', 'Comma-separated BCC emails')
  .action(async (ticketId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.replies.create(ticketId, {
        content: { text: opts.text, html: opts.html },
        cc: opts.cc ? opts.cc.split(',') : undefined,
        bcc: opts.bcc ? opts.bcc.split(',') : undefined,
      });
      success('Reply added!');
      print(result, getFormat(replyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Comment Commands
// ============================================
const commentCmd = program
  .command('comment')
  .description('Manage ticket comments (internal notes)');

commentCmd
  .command('list <ticketId>')
  .description('List comments for a ticket')
  .action(async (ticketId: string) => {
    try {
      const client = getClient();
      const result = await client.comments.list(ticketId);
      print(result, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd
  .command('create <ticketId>')
  .description('Add an internal comment to a ticket')
  .option('--text <text>', 'Comment body (plain text)')
  .option('--html <html>', 'Comment body (HTML)')
  .action(async (ticketId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.comments.create(ticketId, {
        content: { text: opts.text, html: opts.html },
      });
      success('Comment added!');
      print(result, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Label Commands
// ============================================
const labelCmd = program
  .command('label')
  .description('Manage labels');

labelCmd
  .command('list')
  .description('List all labels')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.labels.list();
      print(result, getFormat(labelCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

labelCmd
  .command('add <ticketId> <name>')
  .description('Apply a label to a ticket')
  .action(async (ticketId: string, name: string) => {
    try {
      const client = getClient();
      const result = await client.labels.add(ticketId, name);
      success('Label applied!');
      print(result, getFormat(labelCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

labelCmd
  .command('remove <ticketId> <name>')
  .description('Remove a label from a ticket')
  .action(async (ticketId: string, name: string) => {
    try {
      const client = getClient();
      await client.labels.remove(ticketId, name);
      success('Label removed!');
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
  .description('View agents/users');

userCmd
  .command('list')
  .description('List users')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.users.list();
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
      const result = await client.users.get(id);
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Snippet Commands
// ============================================
const snippetCmd = program
  .command('snippet')
  .description('Manage canned reply snippets');

snippetCmd
  .command('list')
  .description('List snippets')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.snippets.list();
      print(result, getFormat(snippetCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

snippetCmd
  .command('get <id>')
  .description('Get a snippet by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.snippets.get(id);
      print(result, getFormat(snippetCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

snippetCmd
  .command('create')
  .description('Create a new snippet')
  .requiredOption('-n, --name <name>', 'Snippet name')
  .option('-s, --subject <subject>', 'Snippet subject')
  .option('--text <text>', 'Snippet body (plain text)')
  .option('--html <html>', 'Snippet body (HTML)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.snippets.create({
        name: opts.name,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
      success('Snippet created!');
      print(result, getFormat(snippetCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

snippetCmd
  .command('update <id>')
  .description('Update a snippet')
  .option('-n, --name <name>', 'Snippet name')
  .option('-s, --subject <subject>', 'Snippet subject')
  .option('--text <text>', 'Snippet body (plain text)')
  .option('--html <html>', 'Snippet body (HTML)')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.snippets.update(id, {
        name: opts.name,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
      success('Snippet updated!');
      print(result, getFormat(snippetCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

snippetCmd
  .command('delete <id>')
  .description('Delete a snippet')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.snippets.delete(id);
      success('Snippet deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
