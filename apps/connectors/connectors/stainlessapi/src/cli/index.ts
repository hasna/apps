#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Stainless } from '../api';
import { TARGETS } from '../types';
import type { StainlessEnvironment, Target } from '../types';
import {
  getApiKey,
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
  getDefaultProject,
  setDefaultProject,
  getEnvironment,
  setEnvironment,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-stainlessapi';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Stainless API connector - manage SDK builds, projects, and orgs')
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
      process.env.STAINLESS_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  let node: Command | null = cmd;
  while (node) {
    const fmt = node.opts().format;
    if (fmt) return fmt as OutputFormat;
    node = node.parent;
  }
  return 'pretty';
}

// Helper to build an authenticated client
function getClient(): Stainless {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set STAINLESS_API_KEY environment variable.`,
    );
    process.exit(1);
  }
  return new Stainless({
    apiKey,
    project: getDefaultProject(),
    environment: getEnvironment(),
  });
}

function handleError(err: unknown): never {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// ============================================
// Profile Commands
// ============================================
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
  .option('--project <project>', 'Default project')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, project: opts.project });
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
    console.log(
      chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`),
    );
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Project: ${config.project || chalk.gray('not set')}`);
    info(`Environment: ${config.environment || chalk.gray('production')}`);
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
  .command('set-project <project>')
  .description('Set default project')
  .action((project: string) => {
    setDefaultProject(project);
    success(`Default project set to: ${project}`);
  });

configCmd
  .command('set-environment <environment>')
  .description('Set environment (production or staging)')
  .action((environment: string) => {
    if (environment !== 'production' && environment !== 'staging') {
      error('Environment must be "production" or "staging"');
      process.exit(1);
    }
    setEnvironment(environment as StainlessEnvironment);
    success(`Environment set to: ${environment}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Project: ${getDefaultProject() || chalk.gray('not set')}`);
    info(`Environment: ${getEnvironment() || chalk.gray('production')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Build Commands
// ============================================
const buildsCmd = program.command('builds').description('Manage SDK builds');

buildsCmd
  .command('create')
  .description('Create a new build')
  .requiredOption('-r, --revision <revision>', 'Branch, commit SHA, or "base..head" merge command')
  .option('--project <project>', 'Project name (overrides default)')
  .option('-b, --branch <branch>', 'Project branch to use')
  .option('-m, --commit-message <message>', 'Commit message for a new commit')
  .option('-t, --targets <targets>', 'Comma-separated targets (e.g. typescript,python)')
  .option('--allow-empty', 'Allow empty commits')
  .action(async (opts) => {
    try {
      const client = getClient();
      const build = await client.builds.create({
        project: opts.project,
        revision: opts.revision,
        branch: opts.branch,
        commit_message: opts.commitMessage,
        allow_empty: opts.allowEmpty,
        targets: parseTargets(opts.targets),
      });
      print(build, getFormat(buildsCmd));
    } catch (err) {
      handleError(err);
    }
  });

buildsCmd
  .command('get <buildId>')
  .description('Retrieve a build by id')
  .action(async (buildId: string) => {
    try {
      const client = getClient();
      print(await client.builds.retrieve(buildId), getFormat(buildsCmd));
    } catch (err) {
      handleError(err);
    }
  });

buildsCmd
  .command('list')
  .description('List builds for a project')
  .option('--project <project>', 'Project name (overrides default)')
  .option('-b, --branch <branch>', 'Filter by branch')
  .option('-l, --limit <limit>', 'Maximum builds to return (max 100)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const page = await client.builds.list({
        project: opts.project,
        branch: opts.branch,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      print(page.data, getFormat(buildsCmd));
    } catch (err) {
      handleError(err);
    }
  });

buildsCmd
  .command('diagnostics <buildId>')
  .description('List diagnostics for a build')
  .action(async (buildId: string) => {
    try {
      const client = getClient();
      const page = await client.builds.diagnostics(buildId);
      print(page.data, getFormat(buildsCmd));
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// Project Commands
// ============================================
const projectsCmd = program.command('projects').description('Manage Stainless projects');

projectsCmd
  .command('list')
  .description('List projects')
  .option('-o, --org <org>', 'Filter by organization')
  .option('-l, --limit <limit>', 'Maximum projects to return')
  .action(async (opts) => {
    try {
      const client = getClient();
      const page = await client.projects.list({
        org: opts.org,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      print(page.data, getFormat(projectsCmd));
    } catch (err) {
      handleError(err);
    }
  });

projectsCmd
  .command('get [project]')
  .description('Retrieve a project (defaults to configured project)')
  .action(async (project?: string) => {
    try {
      const client = getClient();
      print(await client.projects.retrieve(project), getFormat(projectsCmd));
    } catch (err) {
      handleError(err);
    }
  });

const branchesCmd = projectsCmd.command('branches').description('Manage project branches');

branchesCmd
  .command('list [project]')
  .description('List branches for a project')
  .action(async (project?: string) => {
    try {
      const client = getClient();
      const page = await client.projects.branches.list(project);
      print(page.data, getFormat(projectsCmd));
    } catch (err) {
      handleError(err);
    }
  });

branchesCmd
  .command('get <branch> [project]')
  .description('Retrieve a branch')
  .action(async (branch: string, project?: string) => {
    try {
      const client = getClient();
      print(await client.projects.branches.retrieve(branch, project), getFormat(projectsCmd));
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// Org Commands
// ============================================
const orgsCmd = program.command('orgs').description('Manage organizations');

orgsCmd
  .command('list')
  .description('List organizations')
  .action(async () => {
    try {
      const client = getClient();
      const res = await client.orgs.list();
      print(res.data, getFormat(orgsCmd));
    } catch (err) {
      handleError(err);
    }
  });

orgsCmd
  .command('get <org>')
  .description('Retrieve an organization')
  .action(async (org: string) => {
    try {
      const client = getClient();
      print(await client.orgs.retrieve(org), getFormat(orgsCmd));
    } catch (err) {
      handleError(err);
    }
  });

// ============================================
// User / Misc Commands
// ============================================
program
  .command('whoami')
  .description('Show the currently authenticated user')
  .action(async () => {
    try {
      const client = getClient();
      print(await client.user.retrieve(), getFormat(program));
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('targets')
  .description('List available SDK targets')
  .action(() => {
    console.log(chalk.bold('Available Stainless targets:\n'));
    TARGETS.forEach((t) => console.log(`  ${chalk.white(t)}`));
  });

function parseTargets(value?: string): Target[] | undefined {
  if (!value) return undefined;
  const parsed = value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const invalid = parsed.filter((t) => !TARGETS.includes(t as Target));
  if (invalid.length > 0) {
    error(`Invalid target(s): ${invalid.join(', ')}. Available: ${TARGETS.join(', ')}`);
    process.exit(1);
  }
  return parsed as Target[];
}

program.parse();
