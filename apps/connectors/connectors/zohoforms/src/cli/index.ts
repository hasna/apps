#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoForms } from '../api';
import {
  getToken,
  setToken,
  getDataCenter,
  setDataCenter,
  getBaseUrl,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-zohoforms';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Forms API connector — forms, entries, webhooks, and approvals')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
  .option('--data-center <dc>', 'Zoho data center (com, eu, in, com.au, jp, ca, sa)')
  .option('--base-url <url>', 'Override Zoho Forms API base URL')
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
    }
    if (opts.token) {
      process.env.ZOHOFORMS_TOKEN = opts.token;
    }
    if (opts.dataCenter) {
      process.env.ZOHOFORMS_DATA_CENTER = opts.dataCenter;
    }
    if (opts.baseUrl) {
      process.env.ZOHOFORMS_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoForms {
  const token = getToken();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHOFORMS_TOKEN.`);
    process.exit(1);
  }
  return new ZohoForms({ token, dataCenter: getDataCenter(), baseUrl: getBaseUrl() });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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
  .option('--token <token>', 'OAuth access token')
  .option('--data-center <dc>', 'Zoho data center')
  .option('--base-url <url>', 'Override Zoho Forms API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { token: opts.token, dataCenter: opts.dataCenter, baseUrl: opts.baseUrl });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Data center: ${config.dataCenter || chalk.gray('com (default)')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('derived from data center')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').description('Set OAuth access token').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-data-center <dc>').description('Set Zoho data center').action((dc: string) => {
  setDataCenter(dc);
  success(`Data center saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set custom Zoho Forms API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const token = getToken();
  const baseUrl = getBaseUrl();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Data center: ${getDataCenter() || chalk.gray('com (default)')}`);
  info(`Base URL: ${baseUrl || chalk.gray('derived from data center')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const formsCmd = program.command('forms').description('Form operations');

formsCmd
  .command('list')
  .description('List forms')
  .option('--workspace-id <id>', 'Filter by workspace')
  .option('--from <n>', 'Pagination offset', '0')
  .option('--limit <n>', 'Page size', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listForms({
        workspaceId: opts.workspaceId,
        from: parseInt(opts.from, 10),
        limit: parseInt(opts.limit, 10),
      });
      print(result, getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('get <formLinkName>')
  .description('Get a form by link name')
  .action(async (formLinkName: string) => {
    try {
      const client = getClient();
      print(await client.getForm(formLinkName), getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('fields <formLinkName>')
  .description('List form fields')
  .action(async (formLinkName: string) => {
    try {
      const client = getClient();
      print(await client.listFormFields(formLinkName), getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

formsCmd
  .command('reports <formLinkName>')
  .description('List form reports')
  .action(async (formLinkName: string) => {
    try {
      const client = getClient();
      print(await client.listFormReports(formLinkName), getFormat(formsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const entriesCmd = program.command('entries').description('Form entry operations');

entriesCmd
  .command('list <formLinkName>')
  .description('List entries')
  .option('--report <name>', 'Report link name')
  .option('--from <n>', 'Pagination offset', '0')
  .option('--limit <n>', 'Page size', '50')
  .option('--criteria <expr>', 'Filter criteria')
  .action(async (formLinkName: string, opts) => {
    try {
      const client = getClient();
      print(
        await client.listEntries(formLinkName, {
          reportLinkName: opts.report,
          from: parseInt(opts.from, 10),
          limit: parseInt(opts.limit, 10),
          criteria: opts.criteria,
        }),
        getFormat(entriesCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

entriesCmd
  .command('get <formLinkName> <entryId>')
  .description('Get an entry')
  .action(async (formLinkName: string, entryId: string) => {
    try {
      const client = getClient();
      print(await client.getEntry(formLinkName, entryId), getFormat(entriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

entriesCmd
  .command('create <formLinkName>')
  .description('Create an entry')
  .requiredOption('-d, --data <json>', 'Entry field data as JSON object')
  .action(async (formLinkName: string, opts) => {
    try {
      const client = getClient();
      const data = JSON.parse(opts.data) as Record<string, unknown>;
      print(await client.createEntry(formLinkName, data), getFormat(entriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

entriesCmd
  .command('delete <formLinkName> <entryId>')
  .description('Delete an entry')
  .action(async (formLinkName: string, entryId: string) => {
    try {
      const client = getClient();
      await client.deleteEntry(formLinkName, entryId);
      success('Entry deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const webhooksCmd = program.command('webhooks').description('Webhook operations');

webhooksCmd
  .command('list <formLinkName>')
  .description('List webhooks')
  .action(async (formLinkName: string) => {
    try {
      const client = getClient();
      print(await client.listWebhooks(formLinkName), getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create <formLinkName>')
  .description('Create a webhook')
  .requiredOption('-u, --url <url>', 'Webhook URL')
  .option('--event <trigger>', 'Event trigger (onsubmit, onapprove, onreject)')
  .action(async (formLinkName: string, opts) => {
    try {
      const client = getClient();
      print(
        await client.createWebhook(formLinkName, {
          url: opts.url,
          eventTrigger: opts.event,
        }),
        getFormat(webhooksCmd),
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <formLinkName> <webhookId>')
  .description('Delete a webhook')
  .action(async (formLinkName: string, webhookId: string) => {
    try {
      const client = getClient();
      await client.deleteWebhook(formLinkName, webhookId);
      success('Webhook deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const tasksCmd = program.command('tasks').description('Approval task operations');

tasksCmd
  .command('list')
  .description('List approval tasks')
  .option('--status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      print(await client.listTasks({ status: opts.status }), getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('approve <taskId>')
  .description('Approve an entry')
  .option('-c, --comment <text>', 'Approval comment')
  .action(async (taskId: string, opts) => {
    try {
      const client = getClient();
      print(await client.approveEntry(taskId, opts.comment), getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('reject <taskId>')
  .description('Reject an entry')
  .option('-c, --comment <text>', 'Rejection comment')
  .action(async (taskId: string, opts) => {
    try {
      const client = getClient();
      print(await client.rejectEntry(taskId, opts.comment), getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
