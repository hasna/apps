#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Sidekick } from '../api';
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'textsidekick';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Sidekick (Textsidekick) SMS frontline assistant API CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
      process.env.TEXTSIDEKICK_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Sidekick {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TEXTSIDEKICK_API_KEY.`);
    process.exit(1);
  }
  return new Sidekick({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, flag: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${flag}`);
    process.exit(1);
  }
}

// Profile commands
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
  .option('--api-key <key>', 'API key')
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

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete the default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
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
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set custom API base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.textsidekick.com/v1)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Documents
const documentsCmd = program.command('documents').description('Manage knowledge-base documents');

documentsCmd.command('list').description('List documents').action(async () => {
  try {
    const result = await getClient().listDocuments();
    print(result, getFormat(documentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

documentsCmd.command('get <documentId>').description('Get a document').action(async (documentId: string) => {
  try {
    const result = await getClient().getDocument(documentId);
    print(result, getFormat(documentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

documentsCmd
  .command('upload')
  .description('Upload a document')
  .requiredOption('-d, --data <json>', 'Document JSON body')
  .action(async (opts: { data: string }) => {
    try {
      const body = parseJsonOption(opts.data, '--data')!;
      const result = await getClient().uploadDocument(body);
      success('Document uploaded');
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

documentsCmd.command('delete <documentId>').description('Delete a document').action(async (documentId: string) => {
  try {
    await getClient().deleteDocument(documentId);
    success('Document deleted');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Workers
const workersCmd = program.command('workers').description('Manage frontline workers');

workersCmd.command('list').description('List workers').action(async () => {
  try {
    const result = await getClient().listWorkers();
    print(result, getFormat(workersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

workersCmd.command('get <workerId>').description('Get a worker').action(async (workerId: string) => {
  try {
    const result = await getClient().getWorker(workerId);
    print(result, getFormat(workersCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

workersCmd
  .command('create')
  .description('Create a worker')
  .requiredOption('-d, --data <json>', 'Worker JSON body')
  .action(async (opts: { data: string }) => {
    try {
      const body = parseJsonOption(opts.data, '--data')!;
      const result = await getClient().createWorker(body);
      success('Worker created');
      print(result, getFormat(workersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Messages
const messagesCmd = program.command('messages').description('SMS conversation messages');

messagesCmd.command('list').description('List messages').action(async () => {
  try {
    const result = await getClient().listMessages();
    print(result, getFormat(messagesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

messagesCmd
  .command('send')
  .description('Send a message')
  .requiredOption('-d, --data <json>', 'Message JSON body (e.g. {"workerId":"...","body":"..."})')
  .action(async (opts: { data: string }) => {
    try {
      const body = parseJsonOption(opts.data, '--data')!;
      const result = await getClient().sendMessage(body);
      success('Message sent');
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Escalations
const escalationsCmd = program.command('escalations').description('Manage escalations');

escalationsCmd.command('list').description('List escalations').action(async () => {
  try {
    const result = await getClient().listEscalations();
    print(result, getFormat(escalationsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

escalationsCmd
  .command('resolve <escalationId>')
  .description('Resolve an escalation')
  .option('-d, --data <json>', 'Optional resolution JSON body')
  .action(async (escalationId: string, opts: { data?: string }) => {
    try {
      const body = parseJsonOption(opts.data, '--data') ?? {};
      const result = await getClient().resolveEscalation(escalationId, body);
      success('Escalation resolved');
      print(result, getFormat(escalationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Tutorials
const tutorialsCmd = program.command('tutorials').description('Onboarding tutorials');

tutorialsCmd.command('list').description('List tutorials').action(async () => {
  try {
    const result = await getClient().listTutorials();
    print(result, getFormat(tutorialsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

tutorialsCmd.command('get <tutorialId>').description('Get a tutorial').action(async (tutorialId: string) => {
  try {
    const result = await getClient().getTutorial(tutorialId);
    print(result, getFormat(tutorialsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Phone number
program
  .command('phone-number')
  .description('Get assigned phone number')
  .action(async () => {
    try {
      const result = await getClient().getPhoneNumber();
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Raw request
program
  .command('raw')
  .description('Send a raw API request')
  .requiredOption('-p, --path <path>', 'API path (e.g. /documents)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-d, --data <json>', 'JSON request body')
  .action(async (opts: { path: string; method: string; data?: string }) => {
    try {
      const body = parseJsonOption(opts.data, '--data');
      const result = await getClient().rawRequest(opts.path, {
        method: opts.method.toUpperCase(),
        body,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
