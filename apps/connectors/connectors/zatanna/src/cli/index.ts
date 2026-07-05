#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Zatanna } from '../api';
import {
  getConfig,
  setApiKey,
  setDefaultWorkspaceId,
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

const CONNECTOR_NAME = 'connect-zatanna';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zatanna AI workflow automation connector CLI')
  .version(VERSION)
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
  });

function getFormat(cmd: Command): OutputFormat {
  return (cmd.optsWithGlobals().format || 'pretty') as OutputFormat;
}

function getClient(): Zatanna {
  const config = getConfig();
  if (!config.apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ZATANNA_API_KEY`);
    process.exit(1);
  }
  return new Zatanna({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    authHeader: config.authHeader,
    defaultWorkspaceId: config.defaultWorkspaceId,
  });
}

const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found');
    return;
  }
  profiles.forEach(p => {
    const marker = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${marker}`);
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

profileCmd.command('create <name>').description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--workspace-id <id>', 'Default workspace ID')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      apiKey: opts.apiKey,
      defaultWorkspaceId: opts.workspaceId,
    });
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
  info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Workspace: ${config.defaultWorkspaceId || chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success('API key saved');
});

configCmd.command('set-workspace <workspaceId>').description('Set default workspace ID').action((workspaceId: string) => {
  setDefaultWorkspaceId(workspaceId);
  success('Default workspace ID saved');
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const config = getConfig();
  info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Workspace: ${config.defaultWorkspaceId || chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

const workflowsCmd = program.command('workflows').description('Workflow operations');

workflowsCmd.command('search')
  .description('Search workflows')
  .option('-q, --query <query>', 'Search query')
  .option('--status <status>', 'Workflow status filter')
  .option('--workspace-id <id>', 'Workspace ID')
  .option('--limit <n>', 'Result limit', parseInt)
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.workflows.searchWorkflows({
        query: opts.query,
        status: opts.status,
        workspaceId: opts.workspaceId,
        limit: opts.limit,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workflowsCmd.command('discover')
  .description('Discover workflows by intent')
  .requiredOption('-q, --query <query>', 'Discovery query')
  .option('--target <target>', 'Target system or portal')
  .option('--workspace-id <id>', 'Workspace ID')
  .option('--limit <n>', 'Result limit', parseInt)
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.workflows.discoverWorkflows({
        query: opts.query,
        target: opts.target,
        workspaceId: opts.workspaceId,
        limit: opts.limit,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workflowsCmd.command('get <workflowId>')
  .description('Get workflow details')
  .action(async (workflowId: string) => {
    try {
      const client = getClient();
      const result = await client.workflows.getWorkflow(workflowId);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workflowsCmd.command('invoke <workflowId>')
  .description('Invoke a workflow')
  .option('--input <json>', 'Input JSON object')
  .option('--metadata <json>', 'Metadata JSON object')
  .option('--idempotency-key <key>', 'Idempotency key')
  .option('--dry-run', 'Dry run')
  .action(async (workflowId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.workflows.invokeWorkflow({
        workflowId,
        input: opts.input ? JSON.parse(opts.input) : undefined,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
        idempotencyKey: opts.idempotencyKey,
        dryRun: opts.dryRun,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workflowsCmd.command('export <workflowId>')
  .description('Export workflow definition')
  .option('--format <format>', 'Export format', 'openapi')
  .option('--include-secrets', 'Include secrets in export')
  .action(async (workflowId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.workflows.exportWorkflow({
        workflowId,
        format: opts.format,
        includeSecrets: opts.includeSecrets,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const runsCmd = program.command('runs').description('Workflow run operations');

runsCmd.command('status <runId>')
  .description('Get run status')
  .action(async (runId: string) => {
    try {
      const client = getClient();
      const result = await client.workflows.getRunStatus(runId);
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

runsCmd.command('events <runId>')
  .description('List run events')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--limit <n>', 'Result limit', parseInt)
  .action(async (runId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.workflows.listRunEvents({
        runId,
        cursor: opts.cursor,
        limit: opts.limit,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.command('captures replay <captureId>')
  .description('Replay a captured workflow session')
  .option('--input <json>', 'Input JSON object')
  .option('--metadata <json>', 'Metadata JSON object')
  .action(async (captureId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.workflows.replayCapture({
        captureId,
        input: opts.input ? JSON.parse(opts.input) : undefined,
        metadata: opts.metadata ? JSON.parse(opts.metadata) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
