#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { ZohoBigin } from '../api';
import {
  getToken,
  setToken,
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
import { normalizeRecordPayload } from '../utils/records';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-zoho-bigin';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Bigin connector — contacts, companies, pipelines, and tasks')
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
      process.env.ZOHOBGIN_TOKEN = opts.token;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoBigin {
  const token = getToken();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHOBGIN_TOKEN.`);
    process.exit(1);
  }
  return new ZohoBigin({ token, baseUrl: getBaseUrl() });
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
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'OAuth access token')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      token: opts.token,
      baseUrl: opts.baseUrl,
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
    info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set OAuth access token')
  .action((token: string) => {
    setToken(token);
    success(`Token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const token = getToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://www.zohoapis.com/bigin/v2)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const contactsCmd = program.command('contacts').description('Contact management');

contactsCmd
  .command('list')
  .description('List contacts')
  .option('--page <number>', 'Page number', '1')
  .option('--per-page <number>', 'Records per page', '200')
  .option('--fields <fields>', 'Comma-separated field API names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listContacts({
        page: parseInt(opts.page, 10),
        per_page: parseInt(opts.perPage, 10),
        fields: opts.fields,
      });
      print(result.data ?? result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('get <id>')
  .description('Get a contact by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.getContact(id);
      print(result.data?.[0] ?? result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('add')
  .description('Add one or more contacts')
  .option('--json <payload>', 'JSON object or array of contact records')
  .option('--file <path>', 'Path to JSON file with a contact object or array')
  .option('--last-name <name>', 'Last name (when not using --json/--file)')
  .option('--first-name <name>', 'First name')
  .option('--email <email>', 'Email')
  .action(async (opts) => {
    try {
      const client = getClient();
      let records: Record<string, unknown>[];

      if (opts.json) {
        records = normalizeRecordPayload(JSON.parse(opts.json));
      } else if (opts.file) {
        records = normalizeRecordPayload(JSON.parse(readFileSync(opts.file, 'utf-8')));
      } else {
        if (!opts.lastName) {
          error('Provide --last-name or --json/--file with contact records');
          process.exit(1);
        }
        const record: Record<string, unknown> = { Last_Name: opts.lastName };
        if (opts.firstName) record.First_Name = opts.firstName;
        if (opts.email) record.Email = opts.email;
        records = [record];
      }

      const result = await client.addContacts(records);
      success('Contact(s) created');
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const companiesCmd = program
  .command('companies')
  .alias('accounts')
  .description('Company (Account) management');

companiesCmd
  .command('list')
  .description('List companies')
  .option('--page <number>', 'Page number', '1')
  .option('--per-page <number>', 'Records per page', '200')
  .option('--fields <fields>', 'Comma-separated field API names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listCompanies({
        page: parseInt(opts.page, 10),
        per_page: parseInt(opts.perPage, 10),
        fields: opts.fields,
      });
      print(result.data ?? result, getFormat(companiesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const pipelinesCmd = program.command('pipelines').description('Pipeline management');

pipelinesCmd
  .command('list')
  .description('List pipelines')
  .option('--page <number>', 'Page number', '1')
  .option('--per-page <number>', 'Records per page', '200')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listPipelines({
        page: parseInt(opts.page, 10),
        per_page: parseInt(opts.perPage, 10),
      });
      print(result.data ?? result, getFormat(pipelinesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const tasksCmd = program.command('tasks').description('Task management');

tasksCmd
  .command('list')
  .description('List tasks')
  .option('--page <number>', 'Page number', '1')
  .option('--per-page <number>', 'Records per page', '200')
  .option('--fields <fields>', 'Comma-separated field API names')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTasks({
        page: parseInt(opts.page, 10),
        per_page: parseInt(opts.perPage, 10),
        fields: opts.fields,
      });
      print(result.data ?? result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Raw API request');

rawCmd
  .command('request')
  .description('Make a raw Bigin API request')
  .requiredOption('--path <path>', 'API path (e.g. /Contacts)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'JSON request body')
  .option('--query <json>', 'JSON query parameters object')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const query = opts.query ? JSON.parse(opts.query) : undefined;
      const result = await client.rawRequest(opts.path, opts.method.toUpperCase(), body, query);
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
