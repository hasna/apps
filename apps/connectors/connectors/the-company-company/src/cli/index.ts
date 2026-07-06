#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Connector } from '../api';
import {
  getApiKey,
  getBaseUrl,
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

const CONNECTOR_NAME = 'connect-the-company-company';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('The Company Company connector CLI - business agent platform')
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
      process.env.THE_COMPANY_COMPANY_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set THE_COMPANY_COMPANY_API_KEY environment variable.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new Connector({ apiKey, baseUrl });
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
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Agents Commands
const agentsCmd = program.command('agents').description('Manage business agents');

agentsCmd.command('list').description('List business agents').action(async () => {
  try {
    const client = getClient();
    print(await client.agents.list(), getFormat(agentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

agentsCmd.command('get <id>').description('Get a business agent').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.agents.get(id), getFormat(agentsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

agentsCmd
  .command('create')
  .description('Create a business agent')
  .option('--name <name>', 'Agent name')
  .option('--json <json>', 'JSON body for agent creation')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.json ? JSON.parse(opts.json) : { name: opts.name };
      print(await client.agents.create(body), getFormat(agentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Tasks Commands
const tasksCmd = program.command('tasks').description('Manage agent tasks');

tasksCmd.command('list').description('List agent tasks').action(async () => {
  try {
    const client = getClient();
    print(await client.tasks.list(), getFormat(tasksCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

tasksCmd.command('get <id>').description('Get an agent task').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.tasks.get(id), getFormat(tasksCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

tasksCmd
  .command('create')
  .description('Create an agent task')
  .option('--agent-id <id>', 'Agent ID')
  .option('--prompt <prompt>', 'Task prompt')
  .option('--json <json>', 'JSON body for task creation')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.json
        ? JSON.parse(opts.json)
        : { agentId: opts.agentId, prompt: opts.prompt };
      print(await client.tasks.create(body), getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd.command('cancel <id>').description('Cancel an agent task').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.tasks.cancel(id), getFormat(tasksCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Integrations Commands
const integrationsCmd = program.command('integrations').description('Manage business integrations');

integrationsCmd.command('list').description('List connected integrations').action(async () => {
  try {
    const client = getClient();
    print(await client.integrations.list(), getFormat(integrationsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

integrationsCmd
  .command('connect')
  .description('Connect a business integration')
  .option('--json <json>', 'JSON body for integration connection')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.json ? JSON.parse(opts.json) : {};
      print(await client.integrations.connect(body), getFormat(integrationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Memories Commands
const memoriesCmd = program.command('memories').description('Manage agent memories');

memoriesCmd.command('list').description('List agent memories').action(async () => {
  try {
    const client = getClient();
    print(await client.memories.list(), getFormat(memoriesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

memoriesCmd
  .command('create')
  .description('Create an agent memory')
  .option('--json <json>', 'JSON body for memory creation')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.json ? JSON.parse(opts.json) : {};
      print(await client.memories.create(body), getFormat(memoriesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Events Commands
const eventsCmd = program.command('events').description('Manage agent event log');

eventsCmd.command('list').description('List agent events').action(async () => {
  try {
    const client = getClient();
    print(await client.events.list(), getFormat(eventsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

eventsCmd.command('get <id>').description('Get an agent event').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.events.get(id), getFormat(eventsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Raw Request
program
  .command('raw')
  .description('Call any Company Company API path')
  .requiredOption('--path <path>', 'API path (e.g. /agents)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--json <json>', 'JSON request body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.json ? JSON.parse(opts.json) : undefined;
      print(
        await client.rawRequest({
          method: opts.method,
          path: opts.path,
          body,
        }),
        getFormat(program)
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
