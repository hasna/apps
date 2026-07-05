#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Zoho } from '../api';
import {
  getAccessToken,
  setAccessToken,
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

const CONNECTOR_NAME = 'connect-zoho';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho CRM connector - contacts, leads, accounts, and deals (v8 API)')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
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
      process.env.ZOHO_ACCESS_TOKEN = opts.token;
    }
  });

export function getFormat(cmd: Command): OutputFormat {
  const opts = cmd.optsWithGlobals();
  return (opts.format || cmd.parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Zoho {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHO_ACCESS_TOKEN.`);
    process.exit(1);
  }
  return new Zoho({ accessToken, baseUrl: getBaseUrl() });
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
  profiles.forEach(p => {
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

profileCmd.command('create <name>').description('Create a new profile')
  .option('--token <token>', 'OAuth access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { accessToken: opts.token });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
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
  info(`Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').description('Set OAuth access token').action((token: string) => {
  setAccessToken(token);
  success(`Access token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const token = getAccessToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

program.command('list-contacts').description('List CRM contacts')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Records per page')
  .option('--fields <fields>', 'Comma-separated field API names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listContacts({
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage, 10) : undefined,
        fields: opts.fields,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('get-contact <id>').description('Get a contact by ID')
  .option('--fields <fields>', 'Comma-separated field API names')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getContact(id, { fields: opts.fields });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('add-contacts').description('Create one or more contacts')
  .option('--data <json>', 'JSON array of contact records (Zoho v8 { data: [...] } shape or raw array)')
  .option('--last-name <name>', 'Last name (single contact shortcut)')
  .option('--first-name <name>', 'First name (single contact shortcut)')
  .option('--email <email>', 'Email (single contact shortcut)')
  .action(async (opts) => {
    try {
      let records: Record<string, unknown>[];
      if (opts.data) {
        const parsed = JSON.parse(opts.data);
        records = Array.isArray(parsed) ? parsed : parsed.data ?? [parsed];
      } else if (opts.lastName) {
        records = [{
          Last_Name: opts.lastName,
          ...(opts.firstName ? { First_Name: opts.firstName } : {}),
          ...(opts.email ? { Email: opts.email } : {}),
        }];
      } else {
        error('Provide --data JSON or --last-name for a single contact');
        process.exit(1);
      }
      const client = getClient();
      const result = await client.addContacts(records);
      success('Contact(s) created');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('list-leads').description('List CRM leads')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Records per page')
  .option('--fields <fields>', 'Comma-separated field API names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listLeads({
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage, 10) : undefined,
        fields: opts.fields,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('list-accounts').description('List CRM accounts')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Records per page')
  .option('--fields <fields>', 'Comma-separated field API names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listAccounts({
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage, 10) : undefined,
        fields: opts.fields,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('list-deals').description('List CRM deals')
  .option('--page <number>', 'Page number')
  .option('--per-page <number>', 'Records per page')
  .option('--fields <fields>', 'Comma-separated field API names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listDeals({
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        per_page: opts.perPage ? parseInt(opts.perPage, 10) : undefined,
        fields: opts.fields,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('raw-request').description('Make a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /Contacts or /settings/modules)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body JSON')
  .option('--params <json>', 'Query params JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest(opts.path, {
        method: opts.method,
        body: opts.body ? JSON.parse(opts.body) : undefined,
        params: opts.params ? JSON.parse(opts.params) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

if (import.meta.main) {
  program.parse();
}
