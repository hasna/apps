#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Zendesk } from '../api';
import {
  getEmail,
  getApiToken,
  getBaseUrl,
  setEmail,
  setApiToken,
  setBaseUrl,
  setDefaultAccount,
  getDefaultAccount,
  clearConfig,
  initConfigDir,
  getConfigDir,
  getBaseConfigDir,
  getExportsDir,
  findRemoteApiUrl,
  setRemoteApiUrl,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  isAuthenticated,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';
import { logger } from '../utils/logger';
import {
  exportData,
  exportTicketsToCSV,
  exportUsersToCSV,
  exportOrganizationsToCSV,
  exportGroupsToCSV,
  exportViewsToCSV,
  exportTriggersToCSV,
  exportAutomationsToCSV,
  exportMacrosToCSV,
  exportWebhooksToCSV,
  exportBrandsToCSV,
} from '../utils/export';

const program = new Command();

program
  .name('connect-zendesk')
  .description('Zendesk API connector CLI')
  .version('1.0.0')
  .option('-p, --profile <name>', 'Use specific profile')
  .option('-e, --email <email>', 'Zendesk email address')
  .option('-t, --api-token <token>', 'Zendesk API token')
  .option('-u, --base-url <url>', 'Zendesk base URL (e.g., https://your-subdomain.zendesk.com/api/v2)')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
    if (opts.email) {
      process.env.ZENDESK_EMAIL = opts.email;
    }
    if (opts.apiToken) {
      process.env.ZENDESK_API_TOKEN = opts.apiToken;
    }
    if (opts.baseUrl) {
      process.env.ZENDESK_BASE_URL = opts.baseUrl;
    }
  });

// ============================================
// Init Command
// ============================================
program
  .command('init')
  .description('Initialize the connect-zendesk configuration directory')
  .action(() => {
    logger.command('init');
    const result = initConfigDir();

    if (result.created.length > 0) {
      success('Created the following:');
      result.created.forEach(path => info(`  ${chalk.green('+')} ${path}`));
    }

    if (result.existing.length > 0) {
      info('Already exists:');
      result.existing.forEach(path => info(`  ${chalk.gray('-')} ${path}`));
    }

    info(`\nConfiguration directory: ${getBaseConfigDir()}`);
    info(`Current profile: ${getCurrentProfile()}`);
    info(`Profile config: ${getConfigDir()}`);
    info(`Exports directory: ${getExportsDir()}`);
    success('\nRun "connect-zendesk config set-email <email>" and "connect-zendesk config set-token <token>" to configure your credentials.');
  });

// Helper to get Zendesk client
function getClient(): Zendesk {
  const email = getEmail();
  const apiToken = getApiToken();
  const baseUrl = getBaseUrl();

  if (!email || !apiToken) {
    error('Email and API token are required. Run "connect-zendesk config set-email <email>" and "connect-zendesk config set-token <token>" or set ZENDESK_EMAIL and ZENDESK_API_TOKEN environment variables.');
    process.exit(1);
  }

  return new Zendesk({ email, apiToken, baseUrl });
}

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// ============================================
// Profile Commands
// ============================================
const profileCmd = program
  .command('profile')
  .description('Manage profiles for multiple Zendesk accounts');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      info('No profiles found. Using default.');
      return;
    }

    info('Profiles:');
    profiles.forEach(p => {
      const marker = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${marker}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile "${name}"`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      createProfile(name);
      success(`Profile "${name}" created`);
      info(`Switch to it with: connect-zendesk profile use ${name}`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    try {
      deleteProfile(name);
      success(`Profile "${name}" deleted`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('show')
  .description('Show current profile name and info')
  .action(() => {
    const profile = getCurrentProfile();
    const email = getEmail();
    const baseUrl = getBaseUrl();

    info(`Current profile: ${chalk.cyan(profile)}`);
    info(`Email: ${email || chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('not set')}`);
    info(`Authenticated: ${isAuthenticated() ? chalk.green('yes') : chalk.red('no')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-email <email>')
  .description('Set Zendesk email address')
  .action((email: string) => {
    setEmail(email);
    success(`Email saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-token <apiToken>')
  .description('Set Zendesk API token')
  .action((apiToken: string) => {
    setApiToken(apiToken);
    success(`API token saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-base-url <baseUrl>')
  .description('Set Zendesk base URL (e.g., https://your-subdomain.zendesk.com/api/v2)')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-account <account>')
  .description('Set default account')
  .action((account: string) => {
    setDefaultAccount(account);
    success(`Default account set to: ${account}`);
  });

configCmd
  .command('set-remote-url <url>')
  .description('Set remote API URL (no default; also settable via ZENDESK_REMOTE_API_URL)')
  .action((url: string) => {
    setRemoteApiUrl(url);
    success(`Remote API URL set to: ${url}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const email = getEmail();
    const apiToken = getApiToken();
    const baseUrl = getBaseUrl();
    const account = getDefaultAccount();
    const remoteUrl = findRemoteApiUrl();
    info(`Profile: ${chalk.cyan(profile)}`);
    info(`Email: ${email || chalk.gray('not set')}`);
    info(`API Token: ${apiToken ? `${apiToken.substring(0, 6)}...${apiToken.substring(apiToken.length - 4)}` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('not set')}`);
    info(`Default Account: ${account || chalk.gray('not set')}`);
    info(`Remote API URL: ${remoteUrl || chalk.gray('not set')}`);
    info(`Config Directory: ${getBaseConfigDir()}`);
    info(`Profile Config: ${getConfigDir()}`);
    info(`Exports Directory: ${getExportsDir()}`);
  });

configCmd
  .command('clear')
  .description('Clear all configuration for current profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile "${getCurrentProfile()}"`);
  });

// ============================================
// Remote API Commands (host comes from ZENDESK_REMOTE_API_URL / config)
// ============================================
const remoteCmd = program
  .command('remote')
  .description('Interact with the remote Zendesk connector API');

// The remote host has no shipped default. Commands that need it exit with the
// connector's usual error convention rather than an uncaught throw.
function requireRemoteApiUrl(): string {
  const remoteUrl = findRemoteApiUrl();
  if (!remoteUrl) {
    error('Remote API URL is not configured. Set ZENDESK_REMOTE_API_URL or run: connect-zendesk config set-remote-url <url>');
    process.exit(1);
  }
  return remoteUrl;
}

remoteCmd
  .command('status')
  .description('Check remote API status')
  .action(async () => {
    const remoteUrl = requireRemoteApiUrl();
    logger.command('remote status', { remoteUrl });
    try {
      const response = await fetch(`${remoteUrl}/status`);
      const data = await response.json();
      print(data, getFormat(remoteCmd));
    } catch (err) {
      error(`Failed to connect to remote API at ${remoteUrl}: ${String(err)}`);
      logger.error('Remote status check failed', { remoteUrl, error: String(err) });
      process.exit(1);
    }
  });

remoteCmd
  .command('health')
  .description('Check remote API health')
  .action(async () => {
    const remoteUrl = requireRemoteApiUrl();
    logger.command('remote health', { remoteUrl });
    try {
      const response = await fetch(`${remoteUrl}/health`);
      if (response.ok) {
        success(`Remote API at ${remoteUrl} is healthy`);
      } else {
        error(`Remote API returned status: ${response.status}`);
      }
    } catch (err) {
      error(`Failed to connect to remote API at ${remoteUrl}: ${String(err)}`);
      logger.error('Remote health check failed', { remoteUrl, error: String(err) });
      process.exit(1);
    }
  });

remoteCmd
  .command('url')
  .description('Show current remote API URL')
  .action(() => {
    info(`Remote API URL: ${findRemoteApiUrl() || chalk.gray('not set')}`);
  });

// ============================================
// Tickets Commands
// ============================================
const ticketsCmd = program
  .command('tickets')
  .description('Manage Zendesk tickets');

ticketsCmd
  .command('list')
  .description('List tickets')
  .option('-p, --page <page>', 'Page number')
  .option('-l, --per-page <perPage>', 'Items per page')
  .option('-s, --sort-by <sortBy>', 'Sort by field (created_at, updated_at, priority, status, ticket_type)')
  .option('-o, --sort-order <sortOrder>', 'Sort order (asc, desc)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const tickets = await client.tickets.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
        sort_by: opts.sortBy,
        sort_order: opts.sortOrder,
      });
      print(tickets, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('get <id>')
  .description('Get ticket by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const ticket = await client.tickets.get(parseInt(id));
      print(ticket, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('create')
  .description('Create a new ticket')
  .requiredOption('-s, --subject <subject>', 'Ticket subject')
  .requiredOption('-b, --body <body>', 'Ticket description')
  .option('-p, --priority <priority>', 'Priority (urgent, high, normal, low)')
  .option('-t, --type <type>', 'Type (problem, incident, question, task)')
  .option('--requester-id <requesterId>', 'Requester user ID')
  .option('--assignee-id <assigneeId>', 'Assignee user ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const ticket = await client.tickets.create({
        ticket: {
          subject: opts.subject,
          comment: { body: opts.body },
          priority: opts.priority,
          type: opts.type,
          requester_id: opts.requesterId ? parseInt(opts.requesterId) : undefined,
          assignee_id: opts.assigneeId ? parseInt(opts.assigneeId) : undefined,
        },
      });
      success('Ticket created successfully');
      print(ticket, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('update <id>')
  .description('Update a ticket')
  .option('-s, --subject <subject>', 'Ticket subject')
  .option('-p, --priority <priority>', 'Priority (urgent, high, normal, low)')
  .option('--status <status>', 'Status (new, open, pending, hold, solved, closed)')
  .option('-c, --comment <comment>', 'Add a comment')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const updateData: any = { ticket: {} };

      if (opts.subject) updateData.ticket.subject = opts.subject;
      if (opts.priority) updateData.ticket.priority = opts.priority;
      if (opts.status) updateData.ticket.status = opts.status;
      if (opts.comment) updateData.ticket.comment = { body: opts.comment };

      const ticket = await client.tickets.update(parseInt(id), updateData);
      success('Ticket updated successfully');
      print(ticket, getFormat(ticketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('delete <id>')
  .description('Delete a ticket')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.tickets.delete(parseInt(id));
      success(`Ticket ${id} deleted successfully`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ticketsCmd
  .command('export')
  .description('Export tickets to CSV or JSON')
  .option('-f, --format <format>', 'Export format (csv, json)', 'csv')
  .option('-o, --output <filename>', 'Output filename', 'tickets')
  .option('-l, --limit <limit>', 'Maximum number of tickets to export')
  .action(async (opts) => {
    try {
      const client = getClient();
      logger.command('tickets export', { format: opts.format, output: opts.output });
      info('Fetching tickets...');

      const allTickets: unknown[] = [];
      let page = 1;
      const limit = opts.limit ? parseInt(opts.limit) : undefined;

      while (true) {
        const response = await client.tickets.list({ page, per_page: 100 });
        allTickets.push(...response.tickets);

        if (limit && allTickets.length >= limit) {
          allTickets.splice(limit);
          break;
        }

        if (!response.next_page) break;
        page++;
      }

      const filepath = exportData(allTickets, opts.output, opts.format);
      logger.export('tickets', opts.format, filepath, allTickets.length);
      success(`Exported ${allTickets.length} tickets to ${filepath}`);
    } catch (err) {
      error(String(err));
      logger.error('Tickets export failed', { error: String(err) });
      process.exit(1);
    }
  });

// ============================================
// Users Commands
// ============================================
const usersCmd = program
  .command('users')
  .description('Manage Zendesk users');

usersCmd
  .command('list')
  .description('List users')
  .option('-p, --page <page>', 'Page number')
  .option('-l, --per-page <perPage>', 'Items per page')
  .option('-r, --role <role>', 'Filter by role (end-user, agent, admin)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const users = await client.users.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
        role: opts.role,
      });
      print(users, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('get <id>')
  .description('Get user by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const user = await client.users.get(parseInt(id));
      print(user, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('me')
  .description('Get current authenticated user')
  .action(async () => {
    try {
      const client = getClient();
      const user = await client.users.me();
      print(user, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('create')
  .description('Create a new user')
  .requiredOption('-n, --name <name>', 'User name')
  .option('-e, --email <email>', 'User email')
  .option('-r, --role <role>', 'User role (end-user, agent, admin)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const user = await client.users.create({
        user: {
          name: opts.name,
          email: opts.email,
          role: opts.role,
        },
      });
      success('User created successfully');
      print(user, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('search')
  .description('Search users by email or name')
  .requiredOption('-q, --query <query>', 'Search query (email or name)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const users = await client.users.searchByEmail(opts.query);
      print(users, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('export')
  .description('Export users to CSV or JSON')
  .option('-f, --format <format>', 'Export format (csv, json)', 'csv')
  .option('-o, --output <filename>', 'Output filename', 'users')
  .option('-l, --limit <limit>', 'Maximum number of users to export')
  .option('-r, --role <role>', 'Filter by role (end-user, agent, admin)')
  .action(async (opts) => {
    try {
      const client = getClient();
      logger.command('users export', { format: opts.format, output: opts.output, role: opts.role });
      info('Fetching users...');

      const allUsers: unknown[] = [];
      let page = 1;
      const limit = opts.limit ? parseInt(opts.limit) : undefined;

      while (true) {
        const response = await client.users.list({ page, per_page: 100, role: opts.role });
        allUsers.push(...response.users);

        if (limit && allUsers.length >= limit) {
          allUsers.splice(limit);
          break;
        }

        if (!response.next_page) break;
        page++;
      }

      const filepath = exportData(allUsers, opts.output, opts.format);
      logger.export('users', opts.format, filepath, allUsers.length);
      success(`Exported ${allUsers.length} users to ${filepath}`);
    } catch (err) {
      error(String(err));
      logger.error('Users export failed', { error: String(err) });
      process.exit(1);
    }
  });

// ============================================
// Organizations Commands
// ============================================
const organizationsCmd = program
  .command('organizations')
  .alias('orgs')
  .description('Manage Zendesk organizations');

organizationsCmd
  .command('list')
  .description('List organizations')
  .option('-p, --page <page>', 'Page number')
  .option('-l, --per-page <perPage>', 'Items per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const organizations = await client.organizations.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(organizations, getFormat(organizationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

organizationsCmd
  .command('get <id>')
  .description('Get organization by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const organization = await client.organizations.get(parseInt(id));
      print(organization, getFormat(organizationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

organizationsCmd
  .command('create')
  .description('Create a new organization')
  .requiredOption('-n, --name <name>', 'Organization name')
  .option('-d, --details <details>', 'Organization details')
  .action(async (opts) => {
    try {
      const client = getClient();
      const organization = await client.organizations.create({
        organization: {
          name: opts.name,
          details: opts.details,
        },
      });
      success('Organization created successfully');
      print(organization, getFormat(organizationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

organizationsCmd
  .command('search')
  .description('Search organizations by name')
  .requiredOption('-q, --query <query>', 'Search query (organization name)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const organizations = await client.organizations.search(opts.query);
      print(organizations, getFormat(organizationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

organizationsCmd
  .command('export')
  .description('Export organizations to CSV or JSON')
  .option('-f, --format <format>', 'Export format (csv, json)', 'csv')
  .option('-o, --output <filename>', 'Output filename', 'organizations')
  .option('-l, --limit <limit>', 'Maximum number of organizations to export')
  .action(async (opts) => {
    try {
      const client = getClient();
      logger.command('organizations export', { format: opts.format, output: opts.output });
      info('Fetching organizations...');

      const allOrgs: unknown[] = [];
      let page = 1;
      const limit = opts.limit ? parseInt(opts.limit) : undefined;

      while (true) {
        const response = await client.organizations.list({ page, per_page: 100 });
        allOrgs.push(...response.organizations);

        if (limit && allOrgs.length >= limit) {
          allOrgs.splice(limit);
          break;
        }

        if (!response.next_page) break;
        page++;
      }

      const filepath = exportData(allOrgs, opts.output, opts.format);
      logger.export('organizations', opts.format, filepath, allOrgs.length);
      success(`Exported ${allOrgs.length} organizations to ${filepath}`);
    } catch (err) {
      error(String(err));
      logger.error('Organizations export failed', { error: String(err) });
      process.exit(1);
    }
  });

// ============================================
// Groups Commands
// ============================================
const groupsCmd = program
  .command('groups')
  .description('Manage Zendesk groups');

groupsCmd
  .command('list')
  .description('List groups')
  .option('-p, --page <page>', 'Page number')
  .option('-l, --per-page <perPage>', 'Items per page')
  .action(async (opts) => {
    try {
      const client = getClient();
      const groups = await client.groups.list({
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(groups, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('get <id>')
  .description('Get group by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const group = await client.groups.get(parseInt(id));
      print(group, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('export')
  .description('Export groups to CSV or JSON')
  .option('-f, --format <format>', 'Export format (csv, json)', 'csv')
  .option('-o, --output <filename>', 'Output filename', 'groups')
  .action(async (opts) => {
    try {
      const client = getClient();
      logger.command('groups export', { format: opts.format, output: opts.output });
      info('Fetching groups...');

      const allGroups: unknown[] = [];
      let page = 1;

      while (true) {
        const response = await client.groups.list({ page, per_page: 100 });
        allGroups.push(...response.groups);

        if (!response.next_page) break;
        page++;
      }

      const filepath = exportData(allGroups, opts.output, opts.format);
      logger.export('groups', opts.format, filepath, allGroups.length);
      success(`Exported ${allGroups.length} groups to ${filepath}`);
    } catch (err) {
      error(String(err));
      logger.error('Groups export failed', { error: String(err) });
      process.exit(1);
    }
  });

// ============================================
// Views Commands
// ============================================
const viewsCmd = program
  .command('views')
  .description('Manage Zendesk views');

viewsCmd
  .command('list')
  .description('List views')
  .option('-a, --active', 'Only show active views')
  .action(async (opts) => {
    try {
      const client = getClient();
      const views = opts.active
        ? await client.views.listActive()
        : await client.views.list();
      print(views, getFormat(viewsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

viewsCmd
  .command('get <id>')
  .description('Get view by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const view = await client.views.get(parseInt(id));
      print(view, getFormat(viewsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

viewsCmd
  .command('export')
  .description('Export views to CSV or JSON')
  .option('-f, --format <format>', 'Export format (csv, json)', 'csv')
  .option('-o, --output <filename>', 'Output filename', 'views')
  .action(async (opts) => {
    try {
      const client = getClient();
      logger.command('views export', { format: opts.format, output: opts.output });
      info('Fetching views...');

      const response = await client.views.list();
      const filepath = exportData(response.views, opts.output, opts.format);
      logger.export('views', opts.format, filepath, response.views.length);
      success(`Exported ${response.views.length} views to ${filepath}`);
    } catch (err) {
      error(String(err));
      logger.error('Views export failed', { error: String(err) });
      process.exit(1);
    }
  });

// ============================================
// Triggers Commands
// ============================================
const triggersCmd = program
  .command('triggers')
  .description('Manage Zendesk triggers');

triggersCmd
  .command('list')
  .description('List triggers')
  .option('-a, --active', 'Only show active triggers')
  .action(async (opts) => {
    try {
      const client = getClient();
      const triggers = opts.active
        ? await client.triggers.listActive()
        : await client.triggers.list();
      print(triggers, getFormat(triggersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

triggersCmd
  .command('get <id>')
  .description('Get trigger by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const trigger = await client.triggers.get(parseInt(id));
      print(trigger, getFormat(triggersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

triggersCmd
  .command('export')
  .description('Export triggers to CSV or JSON')
  .option('-f, --format <format>', 'Export format (csv, json)', 'csv')
  .option('-o, --output <filename>', 'Output filename', 'triggers')
  .action(async (opts) => {
    try {
      const client = getClient();
      logger.command('triggers export', { format: opts.format, output: opts.output });
      info('Fetching triggers...');

      const response = await client.triggers.list();
      const filepath = exportData(response.triggers, opts.output, opts.format);
      logger.export('triggers', opts.format, filepath, response.triggers.length);
      success(`Exported ${response.triggers.length} triggers to ${filepath}`);
    } catch (err) {
      error(String(err));
      logger.error('Triggers export failed', { error: String(err) });
      process.exit(1);
    }
  });

// ============================================
// Automations Commands
// ============================================
const automationsCmd = program
  .command('automations')
  .description('Manage Zendesk automations');

automationsCmd
  .command('list')
  .description('List automations')
  .option('-a, --active', 'Only show active automations')
  .action(async (opts) => {
    try {
      const client = getClient();
      const automations = opts.active
        ? await client.automations.listActive()
        : await client.automations.list();
      print(automations, getFormat(automationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

automationsCmd
  .command('get <id>')
  .description('Get automation by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const automation = await client.automations.get(parseInt(id));
      print(automation, getFormat(automationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

automationsCmd
  .command('export')
  .description('Export automations to CSV or JSON')
  .option('-f, --format <format>', 'Export format (csv, json)', 'csv')
  .option('-o, --output <filename>', 'Output filename', 'automations')
  .action(async (opts) => {
    try {
      const client = getClient();
      logger.command('automations export', { format: opts.format, output: opts.output });
      info('Fetching automations...');

      const response = await client.automations.list();
      const filepath = exportData(response.automations, opts.output, opts.format);
      logger.export('automations', opts.format, filepath, response.automations.length);
      success(`Exported ${response.automations.length} automations to ${filepath}`);
    } catch (err) {
      error(String(err));
      logger.error('Automations export failed', { error: String(err) });
      process.exit(1);
    }
  });

// ============================================
// Macros Commands
// ============================================
const macrosCmd = program
  .command('macros')
  .description('Manage Zendesk macros');

macrosCmd
  .command('list')
  .description('List macros')
  .option('-a, --active', 'Only show active macros')
  .action(async (opts) => {
    try {
      const client = getClient();
      const macros = opts.active
        ? await client.macros.listActive()
        : await client.macros.list();
      print(macros, getFormat(macrosCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

macrosCmd
  .command('get <id>')
  .description('Get macro by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const macro = await client.macros.get(parseInt(id));
      print(macro, getFormat(macrosCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

macrosCmd
  .command('export')
  .description('Export macros to CSV or JSON')
  .option('-f, --format <format>', 'Export format (csv, json)', 'csv')
  .option('-o, --output <filename>', 'Output filename', 'macros')
  .action(async (opts) => {
    try {
      const client = getClient();
      logger.command('macros export', { format: opts.format, output: opts.output });
      info('Fetching macros...');

      const response = await client.macros.list();
      const filepath = exportData(response.macros, opts.output, opts.format);
      logger.export('macros', opts.format, filepath, response.macros.length);
      success(`Exported ${response.macros.length} macros to ${filepath}`);
    } catch (err) {
      error(String(err));
      logger.error('Macros export failed', { error: String(err) });
      process.exit(1);
    }
  });

// ============================================
// Webhooks Commands
// ============================================
const webhooksCmd = program
  .command('webhooks')
  .description('Manage Zendesk webhooks');

webhooksCmd
  .command('list')
  .description('List webhooks')
  .action(async () => {
    try {
      const client = getClient();
      const webhooks = await client.webhooks.list();
      print(webhooks, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('get <id>')
  .description('Get webhook by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const webhook = await client.webhooks.get(id);
      print(webhook, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('export')
  .description('Export webhooks to CSV or JSON')
  .option('-f, --format <format>', 'Export format (csv, json)', 'csv')
  .option('-o, --output <filename>', 'Output filename', 'webhooks')
  .action(async (opts) => {
    try {
      const client = getClient();
      logger.command('webhooks export', { format: opts.format, output: opts.output });
      info('Fetching webhooks...');

      const response = await client.webhooks.list();
      const filepath = exportData(response.webhooks, opts.output, opts.format);
      logger.export('webhooks', opts.format, filepath, response.webhooks.length);
      success(`Exported ${response.webhooks.length} webhooks to ${filepath}`);
    } catch (err) {
      error(String(err));
      logger.error('Webhooks export failed', { error: String(err) });
      process.exit(1);
    }
  });

// ============================================
// Brands Commands
// ============================================
const brandsCmd = program
  .command('brands')
  .description('Manage Zendesk brands');

brandsCmd
  .command('list')
  .description('List brands')
  .action(async () => {
    try {
      const client = getClient();
      const brands = await client.brands.list();
      print(brands, getFormat(brandsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

brandsCmd
  .command('get <id>')
  .description('Get brand by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const brand = await client.brands.get(parseInt(id));
      print(brand, getFormat(brandsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

brandsCmd
  .command('export')
  .description('Export brands to CSV or JSON')
  .option('-f, --format <format>', 'Export format (csv, json)', 'csv')
  .option('-o, --output <filename>', 'Output filename', 'brands')
  .action(async (opts) => {
    try {
      const client = getClient();
      logger.command('brands export', { format: opts.format, output: opts.output });
      info('Fetching brands...');

      const response = await client.brands.list();
      const filepath = exportData(response.brands, opts.output, opts.format);
      logger.export('brands', opts.format, filepath, response.brands.length);
      success(`Exported ${response.brands.length} brands to ${filepath}`);
    } catch (err) {
      error(String(err));
      logger.error('Brands export failed', { error: String(err) });
      process.exit(1);
    }
  });

// ============================================
// Bulk Operations Commands
// ============================================
const bulkCmd = program
  .command('bulk')
  .description('Bulk operations for tickets and users');

bulkCmd
  .command('update <resource>')
  .description('Bulk update tickets or users')
  .requiredOption('-w, --where <filter>', 'Filter expression (e.g., "status=open", "priority=high")')
  .requiredOption('-s, --set <updates...>', 'Updates to apply (e.g., "status=solved" "priority=low")')
  .option('--ids <ids>', 'Comma-separated IDs to update (alternative to --where)')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--concurrency <number>', 'Number of concurrent operations', '3')
  .option('--wait', 'Wait for bulk job to complete and show results')
  .action(async (resource: string, opts) => {
    try {
      const client = getClient();
      const resourceType = resource.toLowerCase() as 'tickets' | 'users';

      if (!['tickets', 'users'].includes(resourceType)) {
        error(`Invalid resource type: ${resource}. Must be "tickets" or "users".`);
        process.exit(1);
      }

      // Parse IDs if provided
      const ids = opts.ids ? opts.ids.split(',').map((id: string) => parseInt(id.trim(), 10)) : undefined;

      // Parse updates
      const { FilterParser } = await import('../api/bulk');
      const updates = (opts.set as string[]).map(s => FilterParser.parseUpdate(s));

      logger.command('bulk update', {
        resource: resourceType,
        where: opts.where,
        ids,
        updates,
        dryRun: opts.dryRun,
      });

      if (opts.dryRun) {
        info(`[DRY RUN] Would update ${resourceType} matching: ${opts.where || `IDs: ${ids?.join(', ')}`}`);
        info('Updates to apply:');
        updates.forEach(u => info(`  ${u.field} = ${u.value}`));
      }

      info(`Searching for ${resourceType}...`);

      const result = await client.bulk.update({
        resourceType,
        where: opts.where,
        ids,
        updates,
        dryRun: opts.dryRun,
        concurrency: parseInt(opts.concurrency, 10),
        onProgress: (current, total) => {
          process.stdout.write(`\rProgress: ${current}/${total}`);
        },
      });

      console.log(''); // New line after progress

      if (opts.dryRun) {
        success(`[DRY RUN] Would update ${result.total} ${resourceType}`);
        if (result.updatedItems.length > 0) {
          info('\nSample items that would be updated:');
          result.updatedItems.slice(0, 5).forEach(item => {
            const title = resourceType === 'tickets'
              ? (item as any).subject || `Ticket #${item.id}`
              : (item as any).name || `User #${item.id}`;
            info(`  - ${title} (ID: ${item.id})`);
          });
          if (result.updatedItems.length > 5) {
            info(`  ... and ${result.updatedItems.length - 5} more`);
          }
        }
      } else {
        success(`Bulk update completed:`);
        info(`  Total: ${result.total}`);
        info(`  Success: ${chalk.green(result.success)}`);
        info(`  Failed: ${result.failed > 0 ? chalk.red(result.failed) : result.failed}`);

        if (result.jobStatus) {
          info(`\nJob Status:`);
          info(`  ID: ${result.jobStatus.id}`);
          info(`  Status: ${result.jobStatus.status}`);
          if (result.jobStatus.message) {
            info(`  Message: ${result.jobStatus.message}`);
          }

          // Wait for job completion if requested
          if (opts.wait && result.jobStatus.status !== 'completed') {
            info('\nWaiting for job to complete...');
            const finalStatus = await client.bulk.waitForJob(result.jobStatus.id, {
              onProgress: (progress, total) => {
                process.stdout.write(`\rJob progress: ${progress}/${total}`);
              },
            });
            console.log(''); // New line after progress
            info(`Final status: ${finalStatus.status}`);
            if (finalStatus.results) {
              const successes = finalStatus.results.filter(r => r.success).length;
              const failures = finalStatus.results.filter(r => !r.success).length;
              info(`  Successes: ${chalk.green(successes)}`);
              info(`  Failures: ${failures > 0 ? chalk.red(failures) : failures}`);
            }
          }
        }

        if (result.errors.length > 0) {
          error('\nErrors:');
          result.errors.slice(0, 10).forEach(e => {
            error(`  - ID ${e.id}: ${e.error}`);
          });
          if (result.errors.length > 10) {
            error(`  ... and ${result.errors.length - 10} more errors`);
          }
        }
      }
    } catch (err) {
      error(String(err));
      logger.error('Bulk update failed', { error: String(err) });
      process.exit(1);
    }
  });

bulkCmd
  .command('preview <resource>')
  .description('Preview items that would be affected by a bulk operation')
  .requiredOption('-w, --where <filter>', 'Filter expression (e.g., "status=open", "priority=high")')
  .option('-s, --set <updates...>', 'Updates to preview (shows current values for these fields)')
  .option('--ids <ids>', 'Comma-separated IDs to preview (alternative to --where)')
  .option('-l, --limit <limit>', 'Maximum number of items to show', '20')
  .action(async (resource: string, opts) => {
    try {
      const client = getClient();
      const resourceType = resource.toLowerCase() as 'tickets' | 'users';

      if (!['tickets', 'users'].includes(resourceType)) {
        error(`Invalid resource type: ${resource}. Must be "tickets" or "users".`);
        process.exit(1);
      }

      // Parse IDs if provided
      const ids = opts.ids ? opts.ids.split(',').map((id: string) => parseInt(id.trim(), 10)) : undefined;

      // Parse updates if provided
      const { FilterParser } = await import('../api/bulk');
      const updates = opts.set ? (opts.set as string[]).map(s => FilterParser.parseUpdate(s)) : [];

      logger.command('bulk preview', { resource: resourceType, where: opts.where, ids });

      info(`Searching for ${resourceType} matching: ${opts.where || `IDs: ${ids?.join(', ')}`}`);

      const result = await client.bulk.preview({
        resourceType,
        where: opts.where,
        ids,
        updates,
      });

      success(`Found ${result.count} ${resourceType}`);

      if (result.items.length === 0) {
        info('No items match the filter.');
        return;
      }

      info('\nItems:');
      const limit = parseInt(opts.limit, 10);
      result.items.slice(0, limit).forEach(item => {
        info(`\n  ${chalk.cyan(item.title)} (ID: ${item.id})`);
        if (Object.keys(item.currentValues).length > 0) {
          info('    Current values:');
          Object.entries(item.currentValues).forEach(([key, value]) => {
            info(`      ${key}: ${chalk.yellow(String(value ?? 'null'))}`);
          });
        }
      });

      if (result.items.length > limit) {
        info(`\n  ... and ${result.items.length - limit} more`);
      }

      if (updates.length > 0) {
        info('\nProposed updates:');
        updates.forEach(u => {
          info(`  ${u.field} -> ${chalk.green(u.value)}`);
        });
      }
    } catch (err) {
      error(String(err));
      logger.error('Bulk preview failed', { error: String(err) });
      process.exit(1);
    }
  });

bulkCmd
  .command('schema [resource]')
  .description('Show available fields and values for bulk operations')
  .option('--field <field>', 'Show details for a specific field')
  .action(async (resource: string | undefined, opts) => {
    try {
      const client = getClient();
      logger.command('bulk schema', { resource, field: opts.field });

      info('Fetching schema...');
      const schema = await client.bulk.getSchema();

      if (resource === 'tickets' || !resource) {
        info(chalk.bold('\nTickets Schema'));
        info(chalk.bold('=============='));

        info('\nStatuses:');
        schema.tickets.statuses.forEach(s => info(`  - ${s}`));

        info('\nPriorities:');
        schema.tickets.priorities.forEach(p => info(`  - ${p}`));

        info('\nTypes:');
        schema.tickets.types.forEach(t => info(`  - ${t}`));

        info('\nFields:');
        schema.tickets.fields.forEach(field => {
          if (opts.field && field.name !== opts.field) return;

          info(`\n  ${chalk.cyan(field.name)} (${field.type})`);
          if (field.description) {
            info(`    ${chalk.gray(field.description)}`);
          }
          if (field.options && field.options.length > 0) {
            info('    Options:');
            field.options.forEach(opt => {
              info(`      - ${opt.name}: ${chalk.yellow(opt.value)}`);
            });
          }
        });
      }

      if (resource === 'users' || !resource) {
        info(chalk.bold('\nUsers Schema'));
        info(chalk.bold('============'));

        info('\nRoles:');
        schema.users.roles.forEach(r => info(`  - ${r}`));

        info('\nFields:');
        schema.users.fields.forEach(field => {
          if (opts.field && field.name !== opts.field) return;

          info(`\n  ${chalk.cyan(field.name)} (${field.type})`);
          if (field.description) {
            info(`    ${chalk.gray(field.description)}`);
          }
          if (field.options && field.options.length > 0) {
            info('    Options:');
            field.options.forEach(opt => {
              info(`      - ${opt.name}: ${chalk.yellow(opt.value)}`);
            });
          }
        });
      }

      info('\n' + chalk.bold('Usage Examples:'));
      info('  # Update all open tickets to pending');
      info('  connect-zendesk bulk update tickets --where "status=open" --set "status=pending"');
      info('');
      info('  # Update priority for high-priority open tickets');
      info('  connect-zendesk bulk update tickets --where "status=open&priority=high" --set "priority=urgent"');
      info('');
      info('  # Update multiple fields at once');
      info('  connect-zendesk bulk update tickets --where "status=new" --set "status=open" "priority=normal"');
      info('');
      info('  # Preview changes before applying');
      info('  connect-zendesk bulk update tickets --where "status=pending" --set "status=solved" --dry-run');
      info('');
      info('  # Update specific tickets by ID');
      info('  connect-zendesk bulk update tickets --ids "123,456,789" --set "status=closed"');
      info('');
      info('  # Suspend users matching a filter');
      info('  connect-zendesk bulk update users --where "suspended=false" --set "suspended=true"');

    } catch (err) {
      error(String(err));
      logger.error('Bulk schema failed', { error: String(err) });
      process.exit(1);
    }
  });

bulkCmd
  .command('job <jobId>')
  .description('Check the status of a bulk operation job')
  .option('--wait', 'Wait for job to complete')
  .action(async (jobId: string, opts) => {
    try {
      const client = getClient();
      logger.command('bulk job', { jobId, wait: opts.wait });

      if (opts.wait) {
        info(`Waiting for job ${jobId} to complete...`);
        const status = await client.bulk.waitForJob(jobId, {
          onProgress: (progress, total) => {
            process.stdout.write(`\rProgress: ${progress}/${total}`);
          },
        });
        console.log(''); // New line after progress
        print(status, getFormat(bulkCmd));
      } else {
        const status = await client.bulk.getJobStatus(jobId);
        print(status, getFormat(bulkCmd));
      }
    } catch (err) {
      error(String(err));
      logger.error('Bulk job check failed', { error: String(err) });
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
