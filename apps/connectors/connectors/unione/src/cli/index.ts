#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { UniOne } from '../api';
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

const CONNECTOR_NAME = 'connect-unione';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('UniOne transactional email API connector')
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
      process.env.UNIONE_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): UniOne {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set UNIONE_API_KEY environment variable.`);
    process.exit(1);
  }
  return new UniOne({ apiKey });
}

function parseBodyOption(body?: string, file?: string): Record<string, unknown> {
  if (file) {
    return JSON.parse(readFileSync(file, 'utf-8'));
  }
  if (body) {
    return JSON.parse(body);
  }
  return {};
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

    success('Profiles:');
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
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

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
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// UniOne API Commands
// ============================================
program
  .command('send-email')
  .description('Send a transactional email')
  .option('--body <json>', 'Full request body as JSON')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.sendEmail(parseBodyOption(opts.body, opts.bodyFile) as never);
      success('Email send requested');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('subscribe-email')
  .description('Subscribe an email address to a list')
  .option('--body <json>', 'Full request body as JSON')
  .option('--body-file <path>', 'Path to JSON request body file')
  .option('--list-id <id>', 'List ID')
  .option('--email <email>', 'Email address')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseBodyOption(opts.body, opts.bodyFile);
      if (opts.listId) body.list_id = opts.listId;
      if (opts.email) body.email = opts.email;
      const result = await client.subscribeEmail(body as never);
      success('Email subscribed');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('validate-email')
  .description('Validate a single email address')
  .option('--body <json>', 'Full request body as JSON')
  .option('--body-file <path>', 'Path to JSON request body file')
  .option('--email <email>', 'Email address to validate')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseBodyOption(opts.body, opts.bodyFile);
      if (opts.email) body.email = opts.email;
      const result = await client.validateEmail(body as never);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('set-template')
  .description('Create or update an email template')
  .option('--body <json>', 'Full request body as JSON')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.setTemplate(parseBodyOption(opts.body, opts.bodyFile) as never);
      success('Template saved');
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-template')
  .description('Get an email template by ID')
  .option('--body <json>', 'Full request body as JSON')
  .option('--body-file <path>', 'Path to JSON request body file')
  .option('--template-id <id>', 'Template ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseBodyOption(opts.body, opts.bodyFile);
      if (opts.templateId) body.template_id = opts.templateId;
      const result = await client.getTemplate(body as never);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('list-templates')
  .description('List email templates')
  .option('--body <json>', 'Optional request body as JSON')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTemplates(parseBodyOption(opts.body, opts.bodyFile) as never);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('list-webhooks')
  .description('List configured webhooks')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listWebhooks();
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('list-projects')
  .description('List UniOne projects')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listProjects();
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
