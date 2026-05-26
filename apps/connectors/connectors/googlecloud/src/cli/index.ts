#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { GoogleCloud } from '../api';
import {
  getApiKey,
  setApiKey,
  getCredentialsPath,
  setCredentialsPath,
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
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'googlecloud';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Google Cloud Resource Manager API CLI - Manage GCP projects and resources')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-c, --credentials <path>', 'Path to service account credentials JSON')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set API key from flag if provided
    if (opts.apiKey) {
      process.env.GOOGLE_CLOUD_API_KEY = opts.apiKey;
    }
    // Set credentials path from flag if provided
    if (opts.credentials) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = opts.credentials;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): GoogleCloud {
  const apiKey = getApiKey();
  const credentialsPath = getCredentialsPath();
  if (!apiKey && !credentialsPath) {
    error(`No credentials configured. Run "${CONNECTOR_NAME} config set-key <key>" or set GOOGLE_CLOUD_API_KEY / GOOGLE_APPLICATION_CREDENTIALS environment variable.`);
    process.exit(1);
  }
  return new GoogleCloud({ apiKey, credentialsPath });
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

    success(`Profiles:`);
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
  .option('--credentials <path>', 'Path to service account credentials JSON')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      credentialsPath: opts.credentials,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Credentials: ${config.credentialsPath || chalk.gray('not set')}`);
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
  .command('set-credentials <path>')
  .description('Set path to service account credentials JSON')
  .action((path: string) => {
    setCredentialsPath(path);
    success(`Credentials path saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const credentialsPath = getCredentialsPath();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Credentials: ${credentialsPath || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Projects Commands
// ============================================
const projectsCmd = program
  .command('projects')
  .description('Manage Google Cloud projects');

projectsCmd
  .command('list')
  .description('List all projects')
  .option('-n, --max <number>', 'Maximum results', '20')
  .option('--filter <filter>', 'Filter expression')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.projects.list({
        pageSize: parseInt(opts.max),
        filter: opts.filter,
      });
      print(result.projects || [], getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('get <projectId>')
  .description('Get a project by ID')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      const result = await client.projects.get(projectId);
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('create')
  .description('Create a new project')
  .requiredOption('--project-id <id>', 'Unique project ID')
  .requiredOption('-n, --name <name>', 'Project display name')
  .option('--parent-type <type>', 'Parent resource type (organization, folder)')
  .option('--parent-id <id>', 'Parent resource ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params: { projectId: string; name: string; parent?: { type: string; id: string } } = {
        projectId: opts.projectId,
        name: opts.name,
      };
      if (opts.parentType && opts.parentId) {
        params.parent = { type: opts.parentType, id: opts.parentId };
      }
      const result = await client.projects.create(params);
      success('Project created!');
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('delete <projectId>')
  .description('Delete a project (moves to DELETE_REQUESTED state)')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      await client.projects.delete(projectId);
      success(`Project "${projectId}" marked for deletion`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('undelete <projectId>')
  .description('Restore a project from DELETE_REQUESTED state')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      await client.projects.undelete(projectId);
      success(`Project "${projectId}" restored`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
