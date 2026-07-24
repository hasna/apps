#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SmolMachines } from '../api';
import {
  getApiKey,
  setApiKey,
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
  getConnectorConfig,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-smol-machines';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('smol machines connector — portable microVM runtime HTTP API')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'API base URL (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }

    if (opts.apiKey) {
      process.env.SMOL_MACHINES_API_KEY = opts.apiKey;
    }

    if (opts.baseUrl) {
      process.env.SMOL_MACHINES_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): SmolMachines {
  return new SmolMachines(getConnectorConfig());
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid ${label} JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// Profile Commands
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found');
    return;
  }
  profiles.forEach((p) => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  });
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) {
    success(`Profile "${name}" deleted`);
  } else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success('API key saved');
});

configCmd.command('set-base-url <url>').description('Set API base URL').action((url: string) => {
  setBaseUrl(url);
  success('Base URL saved');
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  info(`API Key: ${getApiKey() ? `${getApiKey()!.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.smolmachines.com/v1)')}`);
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success('Configuration cleared');
});

// Machine Commands
program
  .command('list-machines')
  .description('List all machines')
  .action(async () => {
    try {
      const client = getClient();
      const machines = await client.machines.list();
      print(machines, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('create-machine')
  .description('Create a machine')
  .requiredOption('--name <name>', 'Machine name')
  .option('--network', 'Enable networking')
  .option('--cpus <n>', 'Number of CPUs', (v) => parseInt(v, 10))
  .option('--mem <mb>', 'Memory in MiB', (v) => parseInt(v, 10))
  .option('--image <image>', 'OCI image reference')
  .option('--from <path>', 'Path to .smolmachine artifact')
  .option('--body <json>', 'Full request body JSON (overrides other options)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = opts.body
        ? parseJsonOption(opts.body, 'body')
        : {
            name: opts.name,
            ...(opts.network ? { network: true } : {}),
            ...(opts.cpus !== undefined ? { cpus: opts.cpus } : {}),
            ...(opts.mem !== undefined ? { mem: opts.mem } : {}),
            ...(opts.image ? { image: opts.image } : {}),
            ...(opts.from ? { from: opts.from } : {}),
          };
      const machine = await client.machines.create(body as { name: string });
      print(machine, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('get-machine')
  .description('Get machine details')
  .requiredOption('--name <name>', 'Machine name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const machine = await client.machines.get(opts.name);
      print(machine, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('start-machine')
  .description('Start a machine')
  .requiredOption('--name <name>', 'Machine name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const machine = await client.machines.start(opts.name);
      print(machine, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('stop-machine')
  .description('Stop a machine')
  .requiredOption('--name <name>', 'Machine name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const machine = await client.machines.stop(opts.name);
      print(machine, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('exec-machine')
  .description('Execute a command in a machine')
  .requiredOption('--name <name>', 'Machine name')
  .option('--command <json>', 'Command as JSON array, e.g. \'["echo","hello"]\'')
  .option('-- <args...>', 'Command arguments (alternative to --command)')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      let command: string[];
      if (opts.command) {
        const parsed = JSON.parse(opts.command);
        if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
          error('--command must be a JSON array of strings');
          process.exit(1);
        }
        command = parsed;
      } else {
        const rest = cmd.args as string[];
        const dashIndex = rest.indexOf('--');
        command = dashIndex >= 0 ? rest.slice(dashIndex + 1) : rest;
      }
      if (!command.length) {
        error('Provide --command JSON or arguments after --');
        process.exit(1);
      }
      const result = await client.machines.exec(opts.name, { command });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('delete-machine')
  .description('Delete a machine')
  .requiredOption('--name <name>', 'Machine name')
  .action(async (opts) => {
    try {
      const client = getClient();
      await client.machines.delete(opts.name);
      success(`Machine "${opts.name}" deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send an arbitrary HTTP request to the API')
  .requiredOption('--path <path>', 'Request path (e.g. /machines)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.machines.rawRequest({
        method: opts.method,
        path: opts.path,
        query: opts.query
          ? (parseJsonOption(opts.query, 'query') as Record<string, string | number | boolean | undefined>)
          : undefined,
        body: opts.body ? JSON.parse(opts.body) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
