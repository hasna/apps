#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { VisiblSemiconductors } from '../api';
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';
import type { QueryParams } from '../types';

const CONNECTOR_NAME = 'connect-visibl-semiconductors';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Visibl Semiconductors API connector - Chip design coordination')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(
          `Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`,
        );
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.VISIBL_SEMICONDUCTORS_API_KEY = opts.apiKey;
    }
  });

function getFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

function getClient(): VisiblSemiconductors {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VISIBL_SEMICONDUCTORS_API_KEY.`,
    );
    process.exit(1);
  }
  return new VisiblSemiconductors({ apiKey, baseUrl: getBaseUrl() });
}

function parseQuery(opts: { query?: string }): QueryParams | undefined {
  if (!opts.query) return undefined;
  try {
    return JSON.parse(opts.query) as QueryParams;
  } catch {
    error('Invalid JSON for --query');
    process.exit(1);
  }
}

function parseBody(opts: { body?: string }): Record<string, unknown> | undefined {
  if (!opts.body) return undefined;
  try {
    return JSON.parse(opts.body) as Record<string, unknown>;
  } catch {
    error('Invalid JSON for --body');
    process.exit(1);
  }
}

// Profile commands
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
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
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
    success(`Profile: ${profileName}`);
    console.log(`  API Key: ${config.apiKey ? '***configured***' : chalk.gray('not set')}`);
    console.log(`  Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage connector configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key for current profile')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success('API key saved');
  });

configCmd
  .command('set-base-url <baseUrl>')
  .description('Set API base URL for current profile')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success('Base URL saved');
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const config = loadProfile();
    success(`Active profile: ${profile}`);
    console.log(`  Config dir: ${getConfigDir()}`);
    console.log(`  API Key: ${config.apiKey || process.env.VISIBL_SEMICONDUCTORS_API_KEY ? '***configured***' : chalk.gray('not set')}`);
    console.log(`  Base URL: ${getBaseUrl() || chalk.gray('default (https://api.visiblsemi.com/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear current profile configuration')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// API commands
program
  .command('list-projects')
  .description('List chip design projects')
  .option('--query <json>', 'Query parameters as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listProjects(parseQuery(opts));
      print(result, getFormat());
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('get-project <projectId>')
  .description('Get a project by ID')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      print(await client.getProject(projectId), getFormat());
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('list-drift-cases')
  .description('List drift cases')
  .option('--query <json>', 'Query parameters as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      print(await client.listDriftCases(parseQuery(opts)), getFormat());
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('get-drift-case <caseId>')
  .description('Get a drift case by ID')
  .action(async (caseId: string) => {
    try {
      const client = getClient();
      print(await client.getDriftCase(caseId), getFormat());
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('list-fix-proposals <caseId>')
  .description('List fix proposals for a drift case')
  .action(async (caseId: string) => {
    try {
      const client = getClient();
      print(await client.listFixProposals(caseId), getFormat());
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('approve-fix-proposal <proposalId>')
  .description('Approve a fix proposal')
  .option('--body <json>', 'Request body as JSON')
  .action(async (proposalId: string, opts) => {
    try {
      const client = getClient();
      print(await client.approveFixProposal(proposalId, parseBody(opts)), getFormat());
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('sync-design-context <projectId>')
  .description('Sync design context for a project')
  .option('--body <json>', 'Request body as JSON')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      print(await client.syncDesignContext(projectId, parseBody(opts)), getFormat());
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('list-ci-signals')
  .description('List CI signals')
  .option('--query <json>', 'Query parameters as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      print(await client.listCiSignals(parseQuery(opts)), getFormat());
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('get-tapeout-readiness <projectId>')
  .description('Get tapeout readiness for a project')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      print(await client.getTapeoutReadiness(projectId), getFormat());
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Make a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /projects)')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON')
  .option('--body <json>', 'Request body as JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.rawRequest({
        path: opts.path,
        method: opts.method,
        query: parseQuery(opts),
        body: parseBody(opts),
      });
      print(result, getFormat());
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
