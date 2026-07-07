#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Userlist } from '../api';
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
import type { CustomProperties, MessageBodyContent } from '../types';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-userlist';
const VERSION = '0.0.1';

const program = new Command();
let apiKeyOverride: string | undefined;

program
  .name(CONNECTOR_NAME)
  .description('Userlist Push API connector - users, companies, relationships, events, messages')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Push API key (overrides config)')
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
      apiKeyOverride = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Userlist {
  const apiKey = apiKeyOverride || getApiKey();
  if (!apiKey) {
    error(`No Push API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set USERLIST_PUSH_API_KEY.`);
    process.exit(1);
  }
  return new Userlist({
    apiKey,
    baseUrl: process.env.USERLIST_PUSH_BASE_URL,
  });
}

function parseJsonOption(value: string | undefined, label: string): CustomProperties | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as CustomProperties;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

function parseBodyOption(value: string | undefined): MessageBodyContent | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as MessageBodyContent;
  } catch {
    error('Invalid JSON for body');
    process.exit(1);
  }
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
  .option('--api-key <key>', 'Push API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; use?: boolean }) => {
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

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set Push API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const usersCmd = program.command('users').description('Manage users');

usersCmd
  .command('identify')
  .description('Create or update a user')
  .option('-i, --identifier <id>', 'User identifier')
  .option('-e, --email <email>', 'User email')
  .option('--signed-up-at <timestamp>', 'Signup timestamp (RFC3339)')
  .option('--properties <json>', 'Custom properties JSON object')
  .action(async (opts) => {
    try {
      if (!opts.identifier && !opts.email) {
        error('Provide --identifier or --email');
        process.exit(1);
      }
      const client = getClient();
      await client.users.identify({
        identifier: opts.identifier,
        email: opts.email,
        signed_up_at: opts.signedUpAt,
        properties: parseJsonOption(opts.properties, 'properties'),
      });
      success('User identify request accepted (202)');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('delete')
  .description('Delete a user')
  .option('-i, --identifier <id>', 'User identifier')
  .option('-e, --email <email>', 'User email')
  .action(async (opts) => {
    try {
      if (!opts.identifier && !opts.email) {
        error('Provide --identifier or --email');
        process.exit(1);
      }
      const client = getClient();
      await client.users.delete({
        identifier: opts.identifier,
        email: opts.email,
      });
      success('User delete request accepted (202)');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const companiesCmd = program.command('companies').description('Manage companies');

companiesCmd
  .command('identify')
  .description('Create or update a company')
  .requiredOption('-i, --identifier <id>', 'Company identifier')
  .option('-n, --name <name>', 'Company name')
  .option('--signed-up-at <timestamp>', 'Signup timestamp (RFC3339)')
  .option('--properties <json>', 'Custom properties JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      await client.companies.identify({
        identifier: opts.identifier,
        name: opts.name,
        signed_up_at: opts.signedUpAt,
        properties: parseJsonOption(opts.properties, 'properties'),
      });
      success('Company identify request accepted (202)');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

companiesCmd
  .command('delete')
  .description('Delete a company')
  .requiredOption('-i, --identifier <id>', 'Company identifier')
  .action(async (opts) => {
    try {
      const client = getClient();
      await client.companies.delete({ identifier: opts.identifier });
      success('Company delete request accepted (202)');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const relationshipsCmd = program.command('relationships').description('Manage user-company relationships');

relationshipsCmd
  .command('upsert')
  .description('Create or update a relationship')
  .requiredOption('--user <ref>', 'User identifier or email')
  .requiredOption('--company <ref>', 'Company identifier')
  .option('--properties <json>', 'Relationship properties JSON object')
  .action(async (opts) => {
    try {
      const client = getClient();
      await client.relationships.upsert({
        user: opts.user,
        company: opts.company,
        properties: parseJsonOption(opts.properties, 'properties'),
      });
      success('Relationship upsert request accepted (202)');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

relationshipsCmd
  .command('delete')
  .description('Delete a relationship')
  .requiredOption('--user <ref>', 'User identifier or email')
  .requiredOption('--company <ref>', 'Company identifier')
  .action(async (opts) => {
    try {
      const client = getClient();
      await client.relationships.delete({
        user: opts.user,
        company: opts.company,
      });
      success('Relationship delete request accepted (202)');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Track product events');

eventsCmd
  .command('track')
  .description('Track an event')
  .requiredOption('-n, --name <name>', 'Event name')
  .option('--user <ref>', 'User identifier or email')
  .option('--company <ref>', 'Company identifier')
  .option('--occurred-at <timestamp>', 'Event timestamp (RFC3339)')
  .option('--properties <json>', 'Event properties JSON object')
  .action(async (opts) => {
    try {
      if (!opts.user && !opts.company) {
        error('Provide --user and/or --company');
        process.exit(1);
      }
      const client = getClient();
      await client.events.track({
        name: opts.name,
        user: opts.user,
        company: opts.company,
        occurred_at: opts.occurredAt,
        properties: parseJsonOption(opts.properties, 'properties'),
      });
      success('Event track request accepted (202)');
      print({ accepted: true }, getFormat(eventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const messagesCmd = program.command('messages').description('Send transactional messages');

messagesCmd
  .command('send')
  .description('Send a transactional message')
  .option('--template <id>', 'Transactional message template identifier')
  .option('--user <ref>', 'User identifier or email')
  .option('--company <ref>', 'Company identifier')
  .option('--to <email>', 'Recipient email (when not using user)')
  .option('--subject <subject>', 'Message subject (custom messages)')
  .option('--properties <json>', 'Message properties JSON object')
  .option('--body <json>', 'Message body JSON (custom messages)')
  .action(async (opts) => {
    try {
      const client = getClient();
      await client.messages.send({
        template: opts.template,
        user: opts.user,
        company: opts.company,
        to: opts.to,
        subject: opts.subject,
        properties: parseJsonOption(opts.properties, 'properties'),
        body: parseBodyOption(opts.body),
      });
      success('Message send request accepted (202)');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
