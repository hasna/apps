#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Vapi } from '../api';
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
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

const CONNECTOR_NAME = 'connect-vapi';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vapi connector CLI - Voice AI assistants, calls, phone numbers, and tools')
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
      process.env.VAPI_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Vapi {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VAPI_API_KEY.`);
    process.exit(1);
  }
  return new Vapi({ apiKey, baseUrl: getBaseUrl() });
}

function parseBody(body?: string): Record<string, unknown> {
  if (!body) {
    error('Body is required. Pass JSON via --body.');
    process.exit(1);
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    error('Invalid JSON body');
    process.exit(1);
  }
}

function readBodyFile(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    error(`Failed to read JSON body from ${path}`);
    process.exit(1);
  }
}

// Profile Commands
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
    const marker = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${marker}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create a new profile')
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
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('https://api.vapi.ai (default)')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || 'https://api.vapi.ai (default)'}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Assistants Commands
const assistantsCmd = program.command('assistants').alias('assistant').description('Manage Vapi assistants');

assistantsCmd.command('list').description('List assistants')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.assistants.list({ limit: parseInt(opts.limit, 10) });
      if (getFormat(assistantsCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold(`Assistants (${result.length}):\n`));
        for (const assistant of result) {
          console.log(`  ${chalk.cyan(assistant.id)} - ${chalk.bold(assistant.name || 'Unnamed')}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

assistantsCmd.command('get <assistantId>').description('Get an assistant by ID').action(async (assistantId: string) => {
  try {
    const client = getClient();
    const result = await client.assistants.get(assistantId);
    print(result, getFormat(assistantsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

assistantsCmd.command('create').description('Create an assistant')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.bodyFile ? readBodyFile(opts.bodyFile) : parseBody(opts.body);
      const result = await client.assistants.create(body);
      print(result, getFormat(assistantsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Calls Commands
const callsCmd = program.command('calls').alias('call').description('Manage Vapi calls');

callsCmd.command('list').description('List calls')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.calls.list({ limit: parseInt(opts.limit, 10) });
      if (getFormat(callsCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold(`Calls (${result.length}):\n`));
        for (const call of result) {
          console.log(`  ${chalk.cyan(call.id)} - ${call.status || 'unknown'}${call.assistantId ? ` (assistant: ${call.assistantId})` : ''}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd.command('create').description('Create a call')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.bodyFile ? readBodyFile(opts.bodyFile) : parseBody(opts.body);
      const result = await client.calls.create(body);
      print(result, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Phone Numbers Commands
const phoneNumbersCmd = program.command('phone-numbers').alias('phones').description('List phone numbers');

phoneNumbersCmd.command('list').description('List phone numbers')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.phoneNumbers.list({ limit: parseInt(opts.limit, 10) });
      if (getFormat(phoneNumbersCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold(`Phone Numbers (${result.length}):\n`));
        for (const phone of result) {
          console.log(`  ${chalk.cyan(phone.id)} - ${phone.number || 'unknown'}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Tools Commands
const toolsCmd = program.command('tools').alias('tool').description('List Vapi tools');

toolsCmd.command('list').description('List tools')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tools.list({ limit: parseInt(opts.limit, 10) });
      if (getFormat(toolsCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold(`Tools (${result.length}):\n`));
        for (const tool of result) {
          console.log(`  ${chalk.cyan(tool.id)} - ${tool.type || 'unknown'}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw Request
program.command('raw-request').description('Call any Vapi API path')
  .requiredOption('--path <path>', 'API path (e.g. /assistant)')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'JSON request body')
  .option('--body-file <path>', 'Path to JSON request body file')
  .action(async (opts) => {
    try {
      const client = getClient();
      const method = opts.method.toUpperCase();
      const body = opts.bodyFile
        ? readBodyFile(opts.bodyFile)
        : opts.body
          ? parseBody(opts.body)
          : undefined;

      const result = await client.rawRequest(opts.path, {
        method,
        body,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
