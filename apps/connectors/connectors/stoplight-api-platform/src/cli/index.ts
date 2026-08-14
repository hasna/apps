#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Stoplight } from '../api';
import {
  getToken,
  setToken,
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

const CONNECTOR_NAME = 'connect-stoplight-api-platform';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stoplight connector - Manage workspaces, projects, members, groups, and API documentation nodes')
  .version(VERSION)
  .option('-t, --token <token>', 'API token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('--base-url <url>', 'Override the API base URL')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.token) {
      process.env.STOPLIGHT_API_TOKEN = opts.token;
    }
    if (opts.baseUrl) {
      process.env.STOPLIGHT_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || program.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Stoplight {
  const token = getToken();
  if (!token) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set STOPLIGHT_API_TOKEN environment variable.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new Stoplight({ token, baseUrl });
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
  .option('--token <token>', 'API token')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      token: opts.token,
      baseUrl: opts.baseUrl,
    });
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
    info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set API token')
  .action((token: string) => {
    setToken(token);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const token = getToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://stoplight.io/api)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Workspace Commands
// ============================================
const workspaceCmd = program
  .command('workspace')
  .alias('ws')
  .description('Manage workspaces');

workspaceCmd
  .command('projects <workspaceId>')
  .description('List projects in a workspace')
  .option('--page <number>', 'Page number')
  .option('--page-size <number>', 'Page size')
  .action(async (workspaceId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listWorkspaceProjects(workspaceId, {
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        pageSize: opts.pageSize ? parseInt(opts.pageSize, 10) : undefined,
      });
      print(result, getFormat(workspaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

workspaceCmd
  .command('groups <workspaceId>')
  .description('List access groups in a workspace')
  .option('--page <number>', 'Page number')
  .option('--page-size <number>', 'Page size')
  .action(async (workspaceId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listWorkspaceGroups(workspaceId, {
        page: opts.page ? parseInt(opts.page, 10) : undefined,
        pageSize: opts.pageSize ? parseInt(opts.pageSize, 10) : undefined,
      });
      print(result, getFormat(workspaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Project Commands
// ============================================
const projectCmd = program
  .command('project')
  .alias('proj')
  .description('Manage projects');

projectCmd
  .command('get <projectId>')
  .description('Get a project by ID')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      const result = await client.getProject(projectId);
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('branches <projectId>')
  .description('List branches in a project')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      const result = await client.listProjectBranches(projectId);
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('members <projectId>')
  .description('List members of a project')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      const result = await client.listProjectMembers(projectId);
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('toc <projectId>')
  .description('Get the table of contents for a project')
  .option('--branch <branch>', 'Branch slug')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getTableOfContents(projectId, opts.branch);
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Node Commands
// ============================================
const nodeCmd = program
  .command('node')
  .description('Read API documentation nodes (OpenAPI, models, markdown)');

nodeCmd
  .command('get <workspaceSlug> <projectSlug>')
  .description('Get a node by its URI within a project')
  .requiredOption('--uri <uri>', 'Node URI (e.g. /reference/api.yaml)')
  .option('--branch <branch>', 'Branch slug')
  .option('--deref <mode>', 'Dereference mode (bundle, optimizedBundle)')
  .action(async (workspaceSlug: string, projectSlug: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getNode(workspaceSlug, projectSlug, {
        uri: opts.uri,
        branch: opts.branch,
        deref: opts.deref,
      });
      print(result, getFormat(nodeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

nodeCmd
  .command('export <workspaceSlug> <projectSlug>')
  .description('Export a bundled (dereferenced) OpenAPI/JSON Schema node')
  .requiredOption('--uri <uri>', 'Node URI (e.g. /reference/api.yaml)')
  .option('--branch <branch>', 'Branch slug')
  .action(async (workspaceSlug: string, projectSlug: string, opts) => {
    try {
      const client = getClient();
      const result = await client.exportBundledNode(workspaceSlug, projectSlug, opts.uri, opts.branch);
      print(result, getFormat(nodeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
