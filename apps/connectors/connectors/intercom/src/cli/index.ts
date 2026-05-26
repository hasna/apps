#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Intercom } from '../api';
import {
  getAccessToken,
  setAccessToken,
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

const CONNECTOR_NAME = 'connect-intercom';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Intercom connector - Manage contacts, conversations, companies, and customer engagement')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
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
      process.env.INTERCOM_ACCESS_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Intercom {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set INTERCOM_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  return new Intercom({ accessToken });
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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
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
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Contact Commands
// ============================================
const contactCmd = program
  .command('contact')
  .description('Manage contacts (users and leads)');

contactCmd
  .command('list')
  .description('List contacts')
  .option('-n, --per-page <number>', 'Results per page', '20')
  .option('--starting-after <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listContacts({
        per_page: parseInt(opts.perPage),
        starting_after: opts.startingAfter,
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
  .option('--email <email>', 'Email address')
  .option('--name <name>', 'Contact name')
  .option('--phone <phone>', 'Phone number')
  .option('--role <role>', 'Role (user or lead)', 'user')
  .option('--external-id <id>', 'External ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createContact({
        email: opts.email,
        name: opts.name,
        phone: opts.phone,
        role: opts.role,
        external_id: opts.externalId,
      });
      success('Contact created!');
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('update <id>')
  .description('Update a contact')
  .option('--email <email>', 'Email address')
  .option('--name <name>', 'Contact name')
  .option('--phone <phone>', 'Phone number')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.updateContact(id, {
        email: opts.email,
        name: opts.name,
        phone: opts.phone,
      });
      success('Contact updated!');
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
      success('Contact deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactCmd
  .command('search')
  .description('Search contacts')
  .requiredOption('--field <field>', 'Field to search (email, name, phone, etc.)')
  .requiredOption('--value <value>', 'Value to search for')
  .option('--operator <op>', 'Search operator (=, !=, ~, etc.)', '=')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.searchContacts({
        query: {
          field: opts.field,
          operator: opts.operator,
          value: opts.value,
        },
      });
      print(result, getFormat(contactCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Conversation Commands
// ============================================
const conversationCmd = program
  .command('conversation')
  .description('Manage conversations');

conversationCmd
  .command('list')
  .description('List conversations')
  .option('-n, --per-page <number>', 'Results per page', '20')
  .option('--starting-after <cursor>', 'Pagination cursor')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listConversations({
        per_page: parseInt(opts.perPage),
        starting_after: opts.startingAfter,
      });
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationCmd
  .command('get <id>')
  .description('Get a conversation by ID')
  .option('--plaintext', 'Return body as plaintext')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getConversation(id, opts.plaintext ? 'plaintext' : undefined);
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationCmd
  .command('reply <id>')
  .description('Reply to a conversation')
  .requiredOption('--body <body>', 'Reply body')
  .requiredOption('--admin-id <id>', 'Admin ID')
  .option('--note', 'Send as internal note instead of reply')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.replyToConversation(id, {
        message_type: opts.note ? 'note' : 'comment',
        type: 'admin',
        body: opts.body,
        admin_id: opts.adminId,
      });
      success('Reply sent!');
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationCmd
  .command('close <id>')
  .description('Close a conversation')
  .requiredOption('--admin-id <id>', 'Admin ID')
  .option('--body <body>', 'Optional closing message')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.closeConversation(id, opts.adminId, opts.body);
      success('Conversation closed!');
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationCmd
  .command('open <id>')
  .description('Reopen a conversation')
  .requiredOption('--admin-id <id>', 'Admin ID')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.openConversation(id, opts.adminId);
      success('Conversation reopened!');
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationCmd
  .command('assign <id>')
  .description('Assign a conversation')
  .requiredOption('--admin-id <id>', 'Admin ID performing the action')
  .option('--assignee-id <id>', 'Admin ID to assign to')
  .option('--team-id <id>', 'Team ID to assign to')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.assignConversation(id, opts.adminId, opts.assigneeId, opts.teamId);
      success('Conversation assigned!');
      print(result, getFormat(conversationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Company Commands
// ============================================
const companyCmd = program
  .command('company')
  .description('Manage companies');

companyCmd
  .command('list')
  .description('List companies')
  .option('-n, --per-page <number>', 'Results per page', '20')
  .option('--page <number>', 'Page number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listCompanies({
        per_page: parseInt(opts.perPage),
        page: opts.page ? parseInt(opts.page) : undefined,
      });
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companyCmd
  .command('get <id>')
  .description('Get a company by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getCompany(id);
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companyCmd
  .command('create')
  .description('Create or update a company')
  .requiredOption('--company-id <id>', 'Company ID (your internal ID)')
  .option('--name <name>', 'Company name')
  .option('--website <url>', 'Website URL')
  .option('--industry <industry>', 'Industry')
  .option('--size <size>', 'Number of employees')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createOrUpdateCompany({
        company_id: opts.companyId,
        name: opts.name,
        website: opts.website,
        industry: opts.industry,
        size: opts.size ? parseInt(opts.size) : undefined,
      });
      success('Company created/updated!');
      print(result, getFormat(companyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companyCmd
  .command('delete <id>')
  .description('Delete a company')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteCompany(id);
      success('Company deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companyCmd
  .command('contacts <id>')
  .description('List contacts for a company')
  .option('-n, --per-page <number>', 'Results per page', '20')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listCompanyContacts(id, {
        per_page: parseInt(opts.perPage),
      });
      print(result, getFormat(companyCmd));
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
  .description('Manage tags');

tagCmd
  .command('list')
  .description('List all tags')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listTags();
      print(result, getFormat(tagCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagCmd
  .command('create <name>')
  .description('Create a new tag')
  .action(async (name: string) => {
    try {
      const client = getClient();
      const result = await client.createTag({ name });
      success('Tag created!');
      print(result, getFormat(tagCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tagCmd
  .command('delete <id>')
  .description('Delete a tag')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteTag(id);
      success('Tag deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Admin Commands
// ============================================
const adminCmd = program
  .command('admin')
  .description('Manage admins');

adminCmd
  .command('list')
  .description('List all admins')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listAdmins();
      print(result, getFormat(adminCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adminCmd
  .command('get <id>')
  .description('Get an admin by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getAdmin(id);
      print(result, getFormat(adminCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

adminCmd
  .command('me')
  .description('Get current admin')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getCurrentAdmin();
      print(result, getFormat(adminCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Team Commands
// ============================================
const teamCmd = program
  .command('team')
  .description('Manage teams');

teamCmd
  .command('list')
  .description('List all teams')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listTeams();
      print(result, getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('get <id>')
  .description('Get a team by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getTeam(id);
      print(result, getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Article Commands
// ============================================
const articleCmd = program
  .command('article')
  .description('Manage help center articles');

articleCmd
  .command('list')
  .description('List articles')
  .option('-n, --per-page <number>', 'Results per page', '20')
  .option('--page <number>', 'Page number')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listArticles({
        per_page: parseInt(opts.perPage),
        page: opts.page ? parseInt(opts.page) : undefined,
      });
      print(result, getFormat(articleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

articleCmd
  .command('get <id>')
  .description('Get an article by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getArticle(id);
      print(result, getFormat(articleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

articleCmd
  .command('create')
  .description('Create a new article')
  .requiredOption('--title <title>', 'Article title')
  .requiredOption('--body <body>', 'Article body (HTML)')
  .requiredOption('--author-id <id>', 'Author admin ID')
  .option('--description <desc>', 'Article description')
  .option('--state <state>', 'State (draft or published)', 'draft')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createArticle({
        title: opts.title,
        body: opts.body,
        author_id: parseInt(opts.authorId),
        description: opts.description,
        state: opts.state,
      });
      success('Article created!');
      print(result, getFormat(articleCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

articleCmd
  .command('delete <id>')
  .description('Delete an article')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteArticle(id);
      success('Article deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Event Commands
// ============================================
const eventCmd = program
  .command('event')
  .description('Track data events');

eventCmd
  .command('track')
  .description('Track a data event')
  .requiredOption('--name <name>', 'Event name')
  .option('--email <email>', 'User email')
  .option('--user-id <id>', 'User ID')
  .option('--metadata <json>', 'Event metadata as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      await client.createDataEvent({
        event_name: opts.name,
        email: opts.email,
        user_id: opts.userId,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      success('Event tracked!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventCmd
  .command('list')
  .description('List events for a user')
  .requiredOption('--type <type>', 'Event type')
  .option('--email <email>', 'User email')
  .option('--user-id <id>', 'User ID')
  .option('--intercom-user-id <id>', 'Intercom user ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listDataEvents({
        type: opts.type,
        email: opts.email,
        user_id: opts.userId,
        intercom_user_id: opts.intercomUserId,
      });
      print(result, getFormat(eventCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Message Commands
// ============================================
const messageCmd = program
  .command('message')
  .description('Send outbound messages');

messageCmd
  .command('send')
  .description('Send an outbound message')
  .requiredOption('--type <type>', 'Message type (email or inapp)')
  .requiredOption('--body <body>', 'Message body')
  .requiredOption('--from-id <id>', 'Admin ID to send from')
  .option('--to-email <email>', 'Recipient email')
  .option('--to-user-id <id>', 'Recipient user ID')
  .option('--subject <subject>', 'Email subject (for email type)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createMessage({
        message_type: opts.type,
        body: opts.body,
        subject: opts.subject,
        from: {
          type: 'admin',
          id: opts.fromId,
        },
        to: {
          type: 'user',
          email: opts.toEmail,
          user_id: opts.toUserId,
        },
      });
      success('Message sent!');
      print(result, getFormat(messageCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
