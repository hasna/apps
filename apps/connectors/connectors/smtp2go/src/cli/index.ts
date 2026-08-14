#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Smtp2go } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
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

const CONNECTOR_NAME = 'connect-smtp2go';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('SMTP2GO connector - send email and manage delivery, stats, suppressions, domains, senders, and SMTP users')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
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
      process.env.SMTP2GO_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let node: Command | null = cmd;
  while (node) {
    const fmt = node.opts().format;
    if (fmt) return fmt as OutputFormat;
    node = node.parent;
  }
  return 'pretty';
}

function getClient(): Smtp2go {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SMTP2GO_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Smtp2go({ apiKey, baseUrl: getBaseUrl() });
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

async function run(cmd: Command, fn: (client: Smtp2go) => Promise<unknown>, successMessage?: string): Promise<void> {
  try {
    const client = getClient();
    const result = await fn(client);
    if (successMessage) {
      success(successMessage);
    }
    if (result !== undefined) {
      print(result, getFormat(cmd));
    }
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

// ============================================
// Profile commands
// ============================================
const profileCmd = program.command('profile').description('Manage configuration profiles');

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
    success('Profiles:');
    profiles.forEach((p) => {
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
    createProfile(name, { apiKey: opts.apiKey });
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
// Config commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key for the active profile')
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
  .description('Clear configuration for the active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Email commands
// ============================================
const emailCmd = program.command('email').description('Send and search emails');

emailCmd
  .command('send')
  .description('Send an email')
  .requiredOption('--sender <sender>', 'Sender, e.g. "Name <you@example.com>"')
  .requiredOption('--to <emails>', 'Recipient email(s), comma-separated')
  .requiredOption('--subject <subject>', 'Email subject')
  .option('--text <text>', 'Plain text body')
  .option('--html <html>', 'HTML body')
  .option('--cc <emails>', 'CC email(s), comma-separated')
  .option('--bcc <emails>', 'BCC email(s), comma-separated')
  .action(async (opts, cmd: Command) => {
    if (!opts.text && !opts.html) {
      error('Provide at least one of --text or --html');
      process.exit(1);
    }
    await run(cmd, (client) =>
      client.sendSimpleEmail({
        sender: opts.sender,
        to: splitList(opts.to),
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        cc: opts.cc ? splitList(opts.cc) : undefined,
        bcc: opts.bcc ? splitList(opts.bcc) : undefined,
      }),
    );
  });

emailCmd
  .command('search')
  .description('Search sent emails')
  .option('--sender <sender>', 'Filter by sender')
  .option('--recipient <recipient>', 'Filter by recipient')
  .option('--subject <subject>', 'Filter by subject')
  .option('--start-date <date>', 'Start date (ISO)')
  .option('--end-date <date>', 'End date (ISO)')
  .option('--limit <n>', 'Max results', (v) => parseInt(v, 10))
  .action(async (opts, cmd: Command) => {
    await run(cmd, (client) =>
      client.searchEmails({
        sender: opts.sender,
        recipient: opts.recipient,
        subject: opts.subject,
        start_date: opts.startDate,
        end_date: opts.endDate,
        limit: opts.limit,
      }),
    );
  });

// ============================================
// Activity commands
// ============================================
const activityCmd = program.command('activity').description('Activity stream operations');

activityCmd
  .command('search')
  .description('Search the activity stream for events')
  .option('--events <events>', 'Event types, comma-separated (e.g. opened,clicked)')
  .option('--email-id <id>', 'Filter by email id')
  .option('--search <text>', 'Free-text search')
  .option('--start-date <date>', 'Start date (ISO)')
  .option('--end-date <date>', 'End date (ISO)')
  .option('--limit <n>', 'Max results', (v) => parseInt(v, 10))
  .action(async (opts, cmd: Command) => {
    await run(cmd, (client) =>
      client.searchActivity({
        events: opts.events ? splitList(opts.events) : undefined,
        email_id: opts.emailId,
        search: opts.search,
        start_date: opts.startDate,
        end_date: opts.endDate,
        limit: opts.limit,
      }),
    );
  });

// ============================================
// Stats commands
// ============================================
const statsCmd = program.command('stats').description('Delivery statistics');

const statsMethods = {
  summary: (c: Smtp2go, range: { start_date?: string; end_date?: string }) => c.statsSummary(range),
  bounces: (c: Smtp2go, range: { start_date?: string; end_date?: string }) => c.statsBounces(range),
  cycle: (c: Smtp2go, range: { start_date?: string; end_date?: string }) => c.statsCycle(range),
  history: (c: Smtp2go, range: { start_date?: string; end_date?: string }) => c.statsHistory(range),
  spam: (c: Smtp2go, range: { start_date?: string; end_date?: string }) => c.statsSpam(range),
  unsubscribes: (c: Smtp2go, range: { start_date?: string; end_date?: string }) => c.statsUnsubscribes(range),
} as const;

for (const [name, method] of Object.entries(statsMethods)) {
  statsCmd
    .command(name)
    .description(`Get email ${name} statistics`)
    .option('--start-date <date>', 'Start date (ISO)')
    .option('--end-date <date>', 'End date (ISO)')
    .action(async (opts, cmd: Command) => {
      await run(cmd, (client) => method(client, { start_date: opts.startDate, end_date: opts.endDate }));
    });
}

// ============================================
// Suppression commands
// ============================================
const suppressionCmd = program.command('suppression').description('Manage suppressed recipients');

suppressionCmd
  .command('list')
  .description('View suppressed recipients')
  .action(async (_opts, cmd: Command) => {
    await run(cmd, (client) => client.listSuppressions());
  });

suppressionCmd
  .command('add <emails>')
  .description('Add suppressed recipients (comma-separated)')
  .action(async (emails: string, _opts, cmd: Command) => {
    await run(cmd, (client) => client.addSuppressions(splitList(emails)), 'Suppressions added');
  });

suppressionCmd
  .command('remove <emails>')
  .description('Remove suppressed recipients (comma-separated)')
  .action(async (emails: string, _opts, cmd: Command) => {
    await run(cmd, (client) => client.removeSuppressions(splitList(emails)), 'Suppressions removed');
  });

// ============================================
// Domain commands
// ============================================
const domainCmd = program.command('domain').description('Manage sender domains');

domainCmd
  .command('list')
  .description('List sender domains')
  .action(async (_opts, cmd: Command) => {
    await run(cmd, (client) => client.listDomains());
  });

domainCmd
  .command('add <domain>')
  .description('Add a sender domain')
  .action(async (domain: string, _opts, cmd: Command) => {
    await run(cmd, (client) => client.addDomain(domain), 'Domain added');
  });

domainCmd
  .command('verify <domain>')
  .description('Verify a sender domain')
  .action(async (domain: string, _opts, cmd: Command) => {
    await run(cmd, (client) => client.verifyDomain(domain));
  });

domainCmd
  .command('remove <domain>')
  .description('Remove a sender domain')
  .action(async (domain: string, _opts, cmd: Command) => {
    await run(cmd, (client) => client.removeDomain(domain), 'Domain removed');
  });

// ============================================
// Single sender commands
// ============================================
const senderCmd = program.command('sender').description('Manage single (verified) senders');

senderCmd
  .command('list')
  .description('List single senders')
  .action(async (_opts, cmd: Command) => {
    await run(cmd, (client) => client.listSingleSenders());
  });

senderCmd
  .command('add <email>')
  .description('Add a single sender')
  .action(async (email: string, _opts, cmd: Command) => {
    await run(cmd, (client) => client.addSingleSender(email), 'Single sender added');
  });

senderCmd
  .command('remove <email>')
  .description('Remove a single sender')
  .action(async (email: string, _opts, cmd: Command) => {
    await run(cmd, (client) => client.removeSingleSender(email), 'Single sender removed');
  });

// ============================================
// SMTP user commands
// ============================================
const smtpUserCmd = program.command('smtp-user').description('Manage SMTP credentials');

smtpUserCmd
  .command('list')
  .description('List SMTP users')
  .action(async (_opts, cmd: Command) => {
    await run(cmd, (client) => client.listSmtpUsers());
  });

smtpUserCmd
  .command('add')
  .description('Add an SMTP user')
  .requiredOption('--username <username>', 'SMTP username')
  .requiredOption('--password <password>', 'SMTP password')
  .option('--full-name <name>', 'Full name')
  .action(async (opts, cmd: Command) => {
    await run(
      cmd,
      (client) => client.addSmtpUser({ username: opts.username, email_password: opts.password, full_name: opts.fullName }),
      'SMTP user added',
    );
  });

smtpUserCmd
  .command('remove <username>')
  .description('Remove an SMTP user')
  .action(async (username: string, _opts, cmd: Command) => {
    await run(cmd, (client) => client.removeSmtpUser(username), 'SMTP user removed');
  });

program.parse();
