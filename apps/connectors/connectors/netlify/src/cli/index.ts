#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Netlify } from '../api';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-netlify';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Netlify connector - Manage sites, deploys, forms, DNS, and functions')
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
      process.env.NETLIFY_AUTH_TOKEN = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Netlify {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set NETLIFY_AUTH_TOKEN environment variable.`);
    process.exit(1);
  }
  return new Netlify({ apiKey });
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
// User Commands
// ============================================
program
  .command('user')
  .description('Get current user info')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const user = await client.getCurrentUser();
      print(user, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Account Commands
// ============================================
const accountCmd = program
  .command('account')
  .description('Account operations');

accountCmd
  .command('list')
  .description('List accounts')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const accounts = await client.listAccounts();
      print(accounts, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('get <accountId>')
  .description('Get account details')
  .action(async function(this: Command, accountId: string) {
    try {
      const client = getClient();
      const account = await client.getAccount(accountId);
      print(account, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Site Commands
// ============================================
const siteCmd = program
  .command('site')
  .description('Site operations');

siteCmd
  .command('list')
  .description('List sites')
  .option('--filter <filter>', 'Filter sites (all, owner, guest)', 'all')
  .option('--page <page>', 'Page number')
  .option('--per-page <count>', 'Items per page')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const sites = await client.listSites({
        filter: opts.filter,
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(sites, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

siteCmd
  .command('get <siteId>')
  .description('Get site details')
  .action(async function(this: Command, siteId: string) {
    try {
      const client = getClient();
      const site = await client.getSite(siteId);
      print(site, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

siteCmd
  .command('create')
  .description('Create a site')
  .option('-n, --name <name>', 'Site name')
  .option('--domain <domain>', 'Custom domain')
  .option('--account-slug <slug>', 'Account slug')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const site = await client.createSite({
        name: opts.name,
        custom_domain: opts.domain,
        account_slug: opts.accountSlug,
      });
      success('Site created!');
      print(site, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

siteCmd
  .command('update <siteId>')
  .description('Update a site')
  .option('-n, --name <name>', 'Site name')
  .option('--domain <domain>', 'Custom domain')
  .action(async function(this: Command, siteId: string, opts) {
    try {
      const client = getClient();
      const site = await client.updateSite(siteId, {
        name: opts.name,
        custom_domain: opts.domain,
      });
      success('Site updated!');
      print(site, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

siteCmd
  .command('delete <siteId>')
  .description('Delete a site')
  .action(async function(this: Command, siteId: string) {
    try {
      const client = getClient();
      await client.deleteSite(siteId);
      success('Site deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Deploy Commands
// ============================================
const deployCmd = program
  .command('deploy')
  .description('Deploy operations');

deployCmd
  .command('list <siteId>')
  .description('List deploys for a site')
  .option('--page <page>', 'Page number')
  .option('--per-page <count>', 'Items per page')
  .option('--state <state>', 'Filter by state')
  .option('--branch <branch>', 'Filter by branch')
  .action(async function(this: Command, siteId: string, opts) {
    try {
      const client = getClient();
      const deploys = await client.listDeploys(siteId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
        state: opts.state,
        branch: opts.branch,
      });
      print(deploys, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deployCmd
  .command('get <deployId>')
  .description('Get deploy details')
  .action(async function(this: Command, deployId: string) {
    try {
      const client = getClient();
      const deploy = await client.getDeploy(deployId);
      print(deploy, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deployCmd
  .command('create <siteId>')
  .description('Create a deploy')
  .option('--title <title>', 'Deploy title')
  .option('--branch <branch>', 'Branch name')
  .option('--draft', 'Create as draft')
  .action(async function(this: Command, siteId: string, opts) {
    try {
      const client = getClient();
      const deploy = await client.createDeploy(siteId, {
        title: opts.title,
        branch: opts.branch,
        draft: opts.draft,
      });
      success('Deploy created!');
      print(deploy, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deployCmd
  .command('lock <deployId>')
  .description('Lock a deploy')
  .action(async function(this: Command, deployId: string) {
    try {
      const client = getClient();
      const deploy = await client.lockDeploy(deployId);
      success('Deploy locked!');
      print(deploy, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deployCmd
  .command('unlock <deployId>')
  .description('Unlock a deploy')
  .action(async function(this: Command, deployId: string) {
    try {
      const client = getClient();
      const deploy = await client.unlockDeploy(deployId);
      success('Deploy unlocked!');
      print(deploy, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deployCmd
  .command('publish <siteId> <deployId>')
  .description('Publish a deploy (make it production)')
  .action(async function(this: Command, siteId: string, deployId: string) {
    try {
      const client = getClient();
      const deploy = await client.publishDeploy(siteId, deployId);
      success('Deploy published!');
      print(deploy, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deployCmd
  .command('cancel <deployId>')
  .description('Cancel a deploy')
  .action(async function(this: Command, deployId: string) {
    try {
      const client = getClient();
      const deploy = await client.cancelDeploy(deployId);
      success('Deploy cancelled!');
      print(deploy, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Build Commands
// ============================================
const buildCmd = program
  .command('build')
  .description('Build operations');

buildCmd
  .command('list <siteId>')
  .description('List builds for a site')
  .option('--page <page>', 'Page number')
  .option('--per-page <count>', 'Items per page')
  .action(async function(this: Command, siteId: string, opts) {
    try {
      const client = getClient();
      const builds = await client.listBuilds(siteId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(builds, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

buildCmd
  .command('get <buildId>')
  .description('Get build details')
  .action(async function(this: Command, buildId: string) {
    try {
      const client = getClient();
      const build = await client.getBuild(buildId);
      print(build, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

buildCmd
  .command('trigger <siteId>')
  .description('Trigger a new build')
  .option('--clear-cache', 'Clear cache before build')
  .action(async function(this: Command, siteId: string, opts) {
    try {
      const client = getClient();
      const build = await client.triggerBuild(siteId, {
        clear_cache: opts.clearCache,
      });
      success('Build triggered!');
      print(build, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Form Commands
// ============================================
const formCmd = program
  .command('form')
  .description('Form operations');

formCmd
  .command('list <siteId>')
  .description('List forms for a site')
  .action(async function(this: Command, siteId: string) {
    try {
      const client = getClient();
      const forms = await client.listForms(siteId);
      print(forms, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formCmd
  .command('submissions <formId>')
  .description('List form submissions')
  .option('--page <page>', 'Page number')
  .option('--per-page <count>', 'Items per page')
  .action(async function(this: Command, formId: string, opts) {
    try {
      const client = getClient();
      const submissions = await client.listFormSubmissions(formId, {
        page: opts.page ? parseInt(opts.page) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage) : undefined,
      });
      print(submissions, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formCmd
  .command('delete <siteId> <formId>')
  .description('Delete a form')
  .action(async function(this: Command, siteId: string, formId: string) {
    try {
      const client = getClient();
      await client.deleteForm(siteId, formId);
      success('Form deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// DNS Commands
// ============================================
const dnsCmd = program
  .command('dns')
  .description('DNS operations');

dnsCmd
  .command('zones')
  .description('List DNS zones')
  .option('--account-slug <slug>', 'Account slug')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const zones = await client.listDnsZones({
        account_slug: opts.accountSlug,
      });
      print(zones, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('zone <zoneId>')
  .description('Get DNS zone details')
  .action(async function(this: Command, zoneId: string) {
    try {
      const client = getClient();
      const zone = await client.getDnsZone(zoneId);
      print(zone, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('zone-create')
  .description('Create a DNS zone')
  .requiredOption('-n, --name <name>', 'Zone name')
  .option('--account-slug <slug>', 'Account slug')
  .option('--site-id <siteId>', 'Site ID')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const zone = await client.createDnsZone({
        name: opts.name,
        account_slug: opts.accountSlug,
        site_id: opts.siteId,
      });
      success('DNS zone created!');
      print(zone, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('zone-delete <zoneId>')
  .description('Delete a DNS zone')
  .action(async function(this: Command, zoneId: string) {
    try {
      const client = getClient();
      await client.deleteDnsZone(zoneId);
      success('DNS zone deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('records <zoneId>')
  .description('List DNS records for a zone')
  .action(async function(this: Command, zoneId: string) {
    try {
      const client = getClient();
      const records = await client.listDnsRecords(zoneId);
      print(records, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('record-create <zoneId>')
  .description('Create a DNS record')
  .requiredOption('-t, --type <type>', 'Record type (A, AAAA, CNAME, TXT, MX, etc.)')
  .requiredOption('-h, --hostname <hostname>', 'Hostname')
  .requiredOption('-v, --value <value>', 'Record value')
  .option('--ttl <ttl>', 'TTL in seconds')
  .option('--priority <priority>', 'Priority (for MX records)')
  .action(async function(this: Command, zoneId: string, opts) {
    try {
      const client = getClient();
      const record = await client.createDnsRecord(zoneId, {
        type: opts.type,
        hostname: opts.hostname,
        value: opts.value,
        ttl: opts.ttl ? parseInt(opts.ttl) : undefined,
        priority: opts.priority ? parseInt(opts.priority) : undefined,
      });
      success('DNS record created!');
      print(record, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dnsCmd
  .command('record-delete <zoneId> <recordId>')
  .description('Delete a DNS record')
  .action(async function(this: Command, zoneId: string, recordId: string) {
    try {
      const client = getClient();
      await client.deleteDnsRecord(zoneId, recordId);
      success('DNS record deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Hook Commands
// ============================================
const hookCmd = program
  .command('hook')
  .description('Hook operations');

hookCmd
  .command('list <siteId>')
  .description('List hooks for a site')
  .action(async function(this: Command, siteId: string) {
    try {
      const client = getClient();
      const hooks = await client.listHooks(siteId);
      print(hooks, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

hookCmd
  .command('get <hookId>')
  .description('Get hook details')
  .action(async function(this: Command, hookId: string) {
    try {
      const client = getClient();
      const hook = await client.getHook(hookId);
      print(hook, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

hookCmd
  .command('delete <hookId>')
  .description('Delete a hook')
  .action(async function(this: Command, hookId: string) {
    try {
      const client = getClient();
      await client.deleteHook(hookId);
      success('Hook deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

hookCmd
  .command('enable <hookId>')
  .description('Enable a hook')
  .action(async function(this: Command, hookId: string) {
    try {
      const client = getClient();
      const hook = await client.enableHook(hookId);
      success('Hook enabled!');
      print(hook, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Function Commands
// ============================================
const functionCmd = program
  .command('function')
  .description('Function operations');

functionCmd
  .command('list <siteId>')
  .description('List functions for a site')
  .action(async function(this: Command, siteId: string) {
    try {
      const client = getClient();
      const functions = await client.listFunctions(siteId);
      print(functions, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Deploy Key Commands
// ============================================
const deployKeyCmd = program
  .command('deploy-key')
  .description('Deploy key operations');

deployKeyCmd
  .command('list')
  .description('List deploy keys')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const keys = await client.listDeployKeys();
      print(keys, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deployKeyCmd
  .command('get <keyId>')
  .description('Get deploy key details')
  .action(async function(this: Command, keyId: string) {
    try {
      const client = getClient();
      const key = await client.getDeployKey(keyId);
      print(key, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deployKeyCmd
  .command('create')
  .description('Create a deploy key')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const key = await client.createDeployKey();
      success('Deploy key created!');
      print(key, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deployKeyCmd
  .command('delete <keyId>')
  .description('Delete a deploy key')
  .action(async function(this: Command, keyId: string) {
    try {
      const client = getClient();
      await client.deleteDeployKey(keyId);
      success('Deploy key deleted!');
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
  .description('Snippet operations');

snippetCmd
  .command('list <siteId>')
  .description('List snippets for a site')
  .action(async function(this: Command, siteId: string) {
    try {
      const client = getClient();
      const snippets = await client.listSnippets(siteId);
      print(snippets, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

snippetCmd
  .command('get <siteId> <snippetId>')
  .description('Get snippet details')
  .action(async function(this: Command, siteId: string, snippetId: string) {
    try {
      const client = getClient();
      const snippet = await client.getSnippet(siteId, parseInt(snippetId));
      print(snippet, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

snippetCmd
  .command('create <siteId>')
  .description('Create a snippet')
  .requiredOption('-t, --title <title>', 'Snippet title')
  .option('--general <code>', 'General snippet code')
  .option('--general-position <position>', 'Position (head, body)')
  .action(async function(this: Command, siteId: string, opts) {
    try {
      const client = getClient();
      const snippet = await client.createSnippet(siteId, {
        title: opts.title,
        general: opts.general,
        general_position: opts.generalPosition,
      });
      success('Snippet created!');
      print(snippet, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

snippetCmd
  .command('delete <siteId> <snippetId>')
  .description('Delete a snippet')
  .action(async function(this: Command, siteId: string, snippetId: string) {
    try {
      const client = getClient();
      await client.deleteSnippet(siteId, parseInt(snippetId));
      success('Snippet deleted!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Split Test Commands
// ============================================
const splitTestCmd = program
  .command('split-test')
  .description('Split test operations');

splitTestCmd
  .command('list <siteId>')
  .description('List split tests for a site')
  .action(async function(this: Command, siteId: string) {
    try {
      const client = getClient();
      const tests = await client.listSplitTests(siteId);
      print(tests, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitTestCmd
  .command('get <siteId> <splitTestId>')
  .description('Get split test details')
  .action(async function(this: Command, siteId: string, splitTestId: string) {
    try {
      const client = getClient();
      const test = await client.getSplitTest(siteId, splitTestId);
      print(test, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitTestCmd
  .command('enable <siteId> <splitTestId>')
  .description('Enable a split test')
  .action(async function(this: Command, siteId: string, splitTestId: string) {
    try {
      const client = getClient();
      await client.enableSplitTest(siteId, splitTestId);
      success('Split test enabled!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

splitTestCmd
  .command('disable <siteId> <splitTestId>')
  .description('Disable a split test')
  .action(async function(this: Command, siteId: string, splitTestId: string) {
    try {
      const client = getClient();
      await client.disableSplitTest(siteId, splitTestId);
      success('Split test disabled!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
