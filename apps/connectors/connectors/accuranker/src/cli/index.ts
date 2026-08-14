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

const CONNECTOR_NAME = 'connect-accuranker';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('AccuRanker connector CLI - SEO rank tracking and keyword monitoring')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API token (overrides config)')
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
      process.env.ACCURANKER_API_KEY = opts.apiKey;
      debug('API token set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-key <token>" or set ACCURANKER_API_KEY environment variable.`);
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
  .option('--api-key <key>', 'API token')
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
    info(`API Token: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <token>')
  .description('Set API token')
  .action((token: string) => {
    setApiKey(token);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Token: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Accounts Commands
// ============================================
const accountsCmd = program
  .command('accounts')
  .description('Manage AccuRanker accounts');

accountsCmd
  .command('list')
  .description('List all accounts')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.accounts.list();
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
      const result = await client.accounts.get(parseInt(id));
      print(result, getFormat(accountsCmd));
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
  .description('Manage tracked domains');

domainsCmd
  .command('list')
  .description('List all domains')
  .option('--fields <fields>', 'Comma-separated fields to include')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.fields) params.fields = opts.fields;
      const result = await client.domains.list(params as any);
      print(result, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('get <id>')
  .description('Get a domain by ID')
  .option('--fields <fields>', 'Comma-separated fields to include')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, string> = {};
      if (opts.fields) params.fields = opts.fields;
      const result = await client.domains.get(parseInt(id), params);
      print(result, getFormat(domainsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainsCmd
  .command('create')
  .description('Create a new domain')
  .requiredOption('--domain <domain>', 'Domain name (e.g., example.com)')
  .requiredOption('--group-id <id>', 'Group ID')
  .option('--display-name <name>', 'Display name')
  .option('--include-subdomains', 'Include subdomains')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.domains.create({
        domain: opts.domain,
        group_id: parseInt(opts.groupId),
        display_name: opts.displayName,
        include_subdomains: opts.includeSubdomains,
      });
      success('Domain created!');
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
      await client.domains.delete(parseInt(id));
      success(`Domain ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Keywords Commands
// ============================================
const keywordsCmd = program
  .command('keywords')
  .description('Manage tracked keywords');

keywordsCmd
  .command('list')
  .description('List keywords for a domain')
  .requiredOption('--domain-id <id>', 'Domain ID')
  .option('--fields <fields>', 'Comma-separated fields to include')
  .option('--limit <number>', 'Results limit')
  .option('--offset <number>', 'Results offset')
  .option('--period-from <date>', 'Start date (YYYY-MM-DD)')
  .option('--period-to <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string | number | boolean | undefined> = {};
      if (opts.fields) params.fields = opts.fields;
      if (opts.limit) params.limit = parseInt(opts.limit);
      if (opts.offset) params.offset = parseInt(opts.offset);
      if (opts.periodFrom) params.period_from = opts.periodFrom;
      if (opts.periodTo) params.period_to = opts.periodTo;
      const result = await client.keywords.list(parseInt(opts.domainId), params as any);
      print(result, getFormat(keywordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

keywordsCmd
  .command('get <keywordId>')
  .description('Get a keyword by ID')
  .requiredOption('--domain-id <id>', 'Domain ID')
  .option('--fields <fields>', 'Comma-separated fields to include')
  .action(async (keywordId: string, opts) => {
    try {
      const client = getClient();
      const params: Record<string, string> = {};
      if (opts.fields) params.fields = opts.fields;
      const result = await client.keywords.get(parseInt(opts.domainId), parseInt(keywordId), params);
      print(result, getFormat(keywordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

keywordsCmd
  .command('create')
  .description('Add keywords to a domain')
  .requiredOption('--domain-id <id>', 'Domain ID')
  .requiredOption('--keywords <keywords>', 'Comma-separated keywords')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--starred', 'Star the keywords')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.keywords.create({
        domain_id: parseInt(opts.domainId),
        keywords: opts.keywords.split(',').map((k: string) => k.trim()),
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined,
        starred: opts.starred,
      });
      success('Keywords created!');
      print(result, getFormat(keywordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

keywordsCmd
  .command('delete')
  .description('Delete keywords')
  .requiredOption('--keyword-ids <ids>', 'Comma-separated keyword IDs')
  .action(async (opts) => {
    try {
      const client = getClient();
      const keywordIds = opts.keywordIds.split(',').map((id: string) => parseInt(id.trim()));
      await client.keywords.delete({ keyword_ids: keywordIds });
      success('Keywords deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

keywordsCmd
  .command('job-status <jobId>')
  .description('Check keyword import job status')
  .action(async (jobId: string) => {
    try {
      const client = getClient();
      const result = await client.keywords.getJobStatus(jobId);
      print(result, getFormat(keywordsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Landing Pages Commands
// ============================================
const landingPagesCmd = program
  .command('landing-pages')
  .description('View landing pages for domains');

landingPagesCmd
  .command('list')
  .description('List landing pages for a domain')
  .requiredOption('--domain-id <id>', 'Domain ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.landingPages.list(parseInt(opts.domainId));
      print(result, getFormat(landingPagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

landingPagesCmd
  .command('get <pageId>')
  .description('Get a landing page by ID')
  .requiredOption('--domain-id <id>', 'Domain ID')
  .action(async (pageId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.landingPages.get(parseInt(opts.domainId), parseInt(pageId));
      print(result, getFormat(landingPagesCmd));
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
  .description('View tags for domains');

tagsCmd
  .command('list')
  .description('List tags for a domain')
  .requiredOption('--domain-id <id>', 'Domain ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tags.list(parseInt(opts.domainId));
      print(result, getFormat(tagsCmd));
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
  .description('Manage domain groups');

groupsCmd
  .command('list')
  .description('List all groups with domains')
  .option('--include-subaccounts', 'Include subaccounts')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, boolean> = {};
      if (opts.includeSubaccounts) params.include_subaccounts = true;
      const result = await client.groups.listWithDomains(params);
      print(result, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('create')
  .description('Create a new group')
  .requiredOption('--account-id <id>', 'Account ID')
  .requiredOption('--name <name>', 'Group name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.groups.create({
        account_id: parseInt(opts.accountId),
        name: opts.name,
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
  .option('--name <name>', 'New group name')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.groups.update(parseInt(id), {
        name: opts.name,
      });
      success('Group updated!');
      print(result, getFormat(groupsCmd));
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
      success(`Group ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
