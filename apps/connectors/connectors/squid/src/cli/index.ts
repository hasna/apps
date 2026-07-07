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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-squid';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Squid.energy grid planning workspace API connector')
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
      process.env.SQUID_API_KEY = opts.apiKey;
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
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SQUID_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey, baseUrl: getBaseUrl() });
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

const configCmd = program.command('config').description('Manage CLI configuration');

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
  info(`Base URL: ${getBaseUrl() || 'https://api.squid.energy/v1 (default)'}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const networkModelsCmd = program.command('network-models').description('Network model operations');

networkModelsCmd.command('list').description('List network models').action(async () => {
  try {
    const result = await getClient().listNetworkModels();
    print(result, getFormat(networkModelsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

networkModelsCmd.command('get <modelId>').description('Get a network model').action(async (modelId: string) => {
  try {
    const result = await getClient().getNetworkModel(modelId);
    print(result, getFormat(networkModelsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

networkModelsCmd.command('versions <modelId>').description('List model versions').action(async (modelId: string) => {
  try {
    const result = await getClient().listModelVersions(modelId);
    print(result, getFormat(networkModelsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const assetsCmd = program.command('assets').description('Asset operations');

assetsCmd.command('list').description('List assets').action(async () => {
  try {
    const result = await getClient().listAssets();
    print(result, getFormat(assetsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const workflowsCmd = program.command('workflows').description('Workflow operations');

workflowsCmd.command('list').description('List workflows').action(async () => {
  try {
    const result = await getClient().listWorkflows();
    print(result, getFormat(workflowsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const workflowRunsCmd = program.command('workflow-runs').description('Workflow run operations');

workflowRunsCmd
  .command('create')
  .description('Create a workflow run')
  .requiredOption('-w, --workflow-id <id>', 'Workflow ID')
  .option('--body <json>', 'Additional JSON body fields')
  .action(async (opts) => {
    try {
      const body = opts.body ? JSON.parse(opts.body) as Record<string, unknown> : {};
      const result = await getClient().createWorkflowRun({ workflowId: opts.workflowId, ...body });
      success('Workflow run created');
      print(result, getFormat(workflowRunsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rawCmd = program.command('raw').description('Raw API request escape hatch');

rawCmd
  .command('request')
  .description('Send a raw API request')
  .requiredOption('-p, --path <path>', 'API path (e.g. /network-models)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const result = await getClient().rawRequest({
        method: opts.method,
        path: opts.path,
        query: opts.query ? JSON.parse(opts.query) : undefined,
        body: opts.body ? JSON.parse(opts.body) : undefined,
      });
      print(result, getFormat(rawCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
