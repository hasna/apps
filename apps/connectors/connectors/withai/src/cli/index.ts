#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { WithAi } from '../api';
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

const CONNECTOR_NAME = 'connect-withai';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('WithAI connector CLI - asset-manager command center API')
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
      process.env.WITHAI_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WithAi {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WITHAI_API_KEY environment variable.`);
    process.exit(1);
  }
  return new WithAi({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
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
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://api.withai.co/v1)')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const workspacesCmd = program.command('workspaces').description('Workspace operations');

workspacesCmd
  .command('list')
  .description('List workspaces')
  .option('--firm <firm>', 'Filter by firm')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string> = {};
      if (opts.firm) params.firm = opts.firm;
      const result = await client.listWorkspaces(params);
      print(result, getFormat(workspacesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workspacesCmd
  .command('get <workspaceId>')
  .description('Get workspace by ID')
  .action(async (workspaceId: string) => {
    try {
      const client = getClient();
      const result = await client.getWorkspace(workspaceId);
      print(result, getFormat(workspacesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const researchCmd = program.command('research-tasks').description('Research task operations');

researchCmd
  .command('create <workspaceId>')
  .description('Create a research task in a workspace')
  .option('--ticker <ticker>', 'Ticker symbol')
  .option('--prompt <prompt>', 'Research prompt')
  .option('--body <json>', 'Full request body as JSON')
  .action(async (workspaceId: string, opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body') ?? {
        ...(opts.ticker ? { ticker: opts.ticker } : {}),
        ...(opts.prompt ? { prompt: opts.prompt } : {}),
      };
      const result = await client.createResearchTask(workspaceId, body);
      print(result, getFormat(researchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

researchCmd
  .command('get <taskId>')
  .description('Get research task by ID')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.getResearchTask(taskId);
      print(result, getFormat(researchCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const documentsCmd = program.command('documents').description('Document operations');

documentsCmd
  .command('search')
  .description('Search documents')
  .option('--search-text <text>', 'Search text')
  .option('--filters <json>', 'Search filters as JSON')
  .option('--body <json>', 'Full request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body') ?? {
        ...(opts.searchText ? { search_text: opts.searchText } : {}),
        ...(opts.filters ? { filters: parseJsonOption(opts.filters, '--filters') } : {}),
      };
      const result = await client.searchDocuments(body);
      print(result, getFormat(documentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const portfolioCmd = program.command('portfolio').description('Portfolio operations');
const alertsCmd = portfolioCmd.command('alerts').description('Portfolio alert operations');

alertsCmd
  .command('create')
  .description('Create a portfolio alert')
  .option('--ticker <ticker>', 'Ticker symbol')
  .option('--threshold <threshold>', 'Alert threshold')
  .option('--body <json>', 'Full request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const body = parseJsonOption(opts.body, '--body') ?? {
        ...(opts.ticker ? { ticker: opts.ticker } : {}),
        ...(opts.threshold ? { threshold: opts.threshold } : {}),
      };
      const result = await client.createPortfolioAlert(body);
      print(result, getFormat(alertsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const integrationsCmd = program.command('integrations').description('Integration operations');

integrationsCmd
  .command('list')
  .description('List integrations')
  .option('--status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: Record<string, string> = {};
      if (opts.status) params.status = opts.status;
      const result = await client.listIntegrations(params);
      print(result, getFormat(integrationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw')
  .description('Send a raw API request')
  .option('--path <path>', 'Request path', '/workspaces')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--body <json>', 'Request body as JSON')
  .option('--query <json>', 'Query parameters as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        body: parseJsonOption(opts.body, '--body'),
        params: parseJsonOption(opts.query, '--query') as Record<string, string | number | boolean | undefined> | undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
