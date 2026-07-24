#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Wufoo } from '../api';
import {
  getWufooConfig,
  setApiKey,
  setSubdomain,
  setBaseUrl,
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

const CONNECTOR_NAME = 'connect-wufoo';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Wufoo connector CLI - forms, entries, reports, webhooks, and users')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Wufoo API key (overrides profile)')
  .option('-s, --subdomain <subdomain>', 'Wufoo account subdomain (overrides profile)')
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
      process.env.WUFOO_API_KEY = opts.apiKey;
    }
    if (opts.subdomain) {
      process.env.WUFOO_SUBDOMAIN = opts.subdomain;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Wufoo {
  const config = getWufooConfig();
  if (!config) {
    error(
      `Missing credentials. Run "${CONNECTOR_NAME} config set --api-key <key> --subdomain <subdomain>" or set WUFOO_API_KEY and WUFOO_SUBDOMAIN.`,
    );
    process.exit(1);
  }
  return new Wufoo(config);
}

function parseFieldPairs(pairs: string[] | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const pair of pairs || []) {
    const idx = pair.indexOf('=');
    if (idx === -1) {
      throw new Error(`Invalid field pair "${pair}". Use Field1=value format.`);
    }
    fields[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return fields;
}

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
      error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'Wufoo API key')
  .option('--subdomain <subdomain>', 'Wufoo subdomain')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, subdomain: opts.subdomain });
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
    info(`Subdomain: ${config.subdomain || chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set')
  .description('Set API key and subdomain for active profile')
  .requiredOption('--api-key <key>', 'Wufoo API key')
  .requiredOption('--subdomain <subdomain>', 'Wufoo account subdomain')
  .option('--base-url <url>', 'Override API base URL')
  .action((opts) => {
    setApiKey(opts.apiKey);
    setSubdomain(opts.subdomain);
    if (opts.baseUrl) {
      setBaseUrl(opts.baseUrl);
    }
    success(`Configuration saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = getWufooConfig();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${config?.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Subdomain: ${config?.subdomain || chalk.gray('not set')}`);
    info(`Base URL: ${config?.baseUrl || chalk.gray('default')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const formsCmd = program.command('forms').description('Manage Wufoo forms');

formsCmd
  .command('list')
  .description('List all forms')
  .option('--page <n>', 'Page number', parseInt)
  .option('--limit <n>', 'Results per page', parseInt)
  .option('--include-today-count', 'Include today entry counts')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.forms.list({
        page: opts.page,
        limit: opts.limit,
        includeTodayCount: opts.includeTodayCount,
      });
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('get <formId>')
  .description('Get a form by hash or title')
  .action(async (formId: string) => {
    try {
      const client = getClient();
      const result = await client.forms.get(formId);
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('fields <formId>')
  .description('List fields for a form')
  .action(async (formId: string) => {
    try {
      const client = getClient();
      const result = await client.forms.listFields(formId);
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('comments <formId>')
  .description('List comments for a form')
  .option('--page <n>', 'Page number', parseInt)
  .option('--limit <n>', 'Results per page', parseInt)
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.forms.listComments(formId, { page: opts.page, limit: opts.limit });
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('comments-count <formId>')
  .description('Get comment count for a form')
  .action(async (formId: string) => {
    try {
      const client = getClient();
      const result = await client.forms.getCommentsCount(formId);
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const entriesCmd = program.command('entries').description('Manage form entries');

entriesCmd
  .command('list <formId>')
  .description('List entries for a form')
  .option('--page <n>', 'Page number', parseInt)
  .option('--limit <n>', 'Results per page', parseInt)
  .option('--sort <field>', 'Sort field (e.g. EntryId)')
  .option('--sort-direction <dir>', 'ASC or DESC')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.entries.list(formId, {
        page: opts.page,
        limit: opts.limit,
        sort: opts.sort,
        sortDirection: opts.sortDirection,
      });
      print(result, getFormat(entriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

entriesCmd
  .command('count <formId>')
  .description('Count entries for a form')
  .action(async (formId: string) => {
    try {
      const client = getClient();
      const result = await client.entries.count(formId);
      print(result, getFormat(entriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

entriesCmd
  .command('submit <formId>')
  .description('Submit a new entry (FieldN=value pairs)')
  .option('-F, --field <pair>', 'Field pair (Field1=value), repeatable', collect, [])
  .action(async (formId: string, opts: { field: string[] }) => {
    try {
      const fields = parseFieldPairs(opts.field);
      if (Object.keys(fields).length === 0) {
        error('At least one --field FieldN=value is required');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.entries.submit(formId, fields);
      success('Entry submitted');
      print(result, getFormat(entriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const reportsCmd = program.command('reports').description('Manage Wufoo reports');

reportsCmd
  .command('list')
  .description('List all reports')
  .option('--page <n>', 'Page number', parseInt)
  .option('--limit <n>', 'Results per page', parseInt)
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.reports.list({ page: opts.page, limit: opts.limit });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('get <reportId>')
  .description('Get a report by hash or title')
  .action(async (reportId: string) => {
    try {
      const client = getClient();
      const result = await client.reports.get(reportId);
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('entries <reportId>')
  .description('List entries for a report')
  .option('--page <n>', 'Page number', parseInt)
  .option('--limit <n>', 'Results per page', parseInt)
  .action(async (reportId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.reports.listEntries(reportId, { page: opts.page, limit: opts.limit });
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('entries-count <reportId>')
  .description('Count entries for a report')
  .action(async (reportId: string) => {
    try {
      const client = getClient();
      const result = await client.reports.countEntries(reportId);
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('fields <reportId>')
  .description('List fields for a report')
  .action(async (reportId: string) => {
    try {
      const client = getClient();
      const result = await client.reports.listFields(reportId);
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('widgets <reportId>')
  .description('List widgets for a report')
  .action(async (reportId: string) => {
    try {
      const client = getClient();
      const result = await client.reports.listWidgets(reportId);
      print(result, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const webhooksCmd = program.command('webhooks').description('Manage form webhooks');

webhooksCmd
  .command('add <formId>')
  .description('Add or update a webhook on a form')
  .requiredOption('--url <url>', 'Webhook callback URL')
  .option('--handshake-key <key>', 'Optional handshake key')
  .option('--metadata', 'Include form metadata in webhook POSTs')
  .action(async (formId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.webhooks.add(formId, {
        url: opts.url,
        handshakeKey: opts.handshakeKey,
        metadata: opts.metadata,
      });
      success('Webhook saved');
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <formId> <webhookHash>')
  .description('Delete a webhook from a form')
  .action(async (formId: string, webhookHash: string) => {
    try {
      const client = getClient();
      const result = await client.webhooks.delete(formId, webhookHash);
      success('Webhook deleted');
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const usersCmd = program.command('users').description('Manage Wufoo account users');

usersCmd
  .command('list')
  .description('List account users')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.users.list();
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

program.parse();
