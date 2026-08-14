#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Vercel } from '../api';
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
  getTeamId,
  setTeamId,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-vercel';
const VERSION = '0.0.2';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vercel connector - Manage projects, deployments, domains, and environment variables')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-t, --team-id <id>', 'Team ID')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.VERCEL_TOKEN = opts.apiKey;
    }
    if (opts.teamId) {
      process.env.VERCEL_TEAM_ID = opts.teamId;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Vercel {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VERCEL_TOKEN environment variable.`);
    process.exit(1);
  }
  return new Vercel({ apiKey, teamId: getTeamId() });
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
  .option('--team-id <id>', 'Team ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      teamId: opts.teamId,
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
    info(`Team ID: ${config.teamId || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-team <teamId>')
  .description('Set team ID')
  .action((teamId: string) => {
    setTeamId(teamId);
    success(`Team ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const teamId = getTeamId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Team ID: ${teamId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .description('User operations');

userCmd
  .command('me')
  .description('Get current user information')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getUser();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Team Commands
// ============================================
const teamCmd = program
  .command('team')
  .description('Team operations');

teamCmd
  .command('ls')
  .description('List teams')
  .option('-l, --limit <number>', 'Limit results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listTeams({
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(teamCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamCmd
  .command('get <teamId>')
  .description('Get a team by ID')
  .action(async (teamId: string) => {
    try {
      const client = getClient();
      const result = await client.getTeam(teamId);
      print(result, getFormat(teamCmd));
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
  .description('Project operations');

projectCmd
  .command('ls')
  .description('List projects')
  .option('-l, --limit <number>', 'Limit results', '20')
  .option('-s, --search <query>', 'Search query')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listProjects({
        limit: parseInt(opts.limit),
        search: opts.search,
      });
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('get <idOrName>')
  .description('Get a project by ID or name')
  .action(async (idOrName: string) => {
    try {
      const client = getClient();
      const result = await client.getProject(idOrName);
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('create <name>')
  .description('Create a project')
  .option('--framework <framework>', 'Framework (nextjs, gatsby, etc.)')
  .option('--build-command <cmd>', 'Build command')
  .option('--output-dir <dir>', 'Output directory')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createProject({
        name,
        framework: opts.framework,
        buildCommand: opts.buildCommand,
        outputDirectory: opts.outputDir,
      });
      success('Project created!');
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('delete <idOrName>')
  .description('Delete a project')
  .action(async (idOrName: string) => {
    try {
      const client = getClient();
      await client.deleteProject(idOrName);
      success(`Project ${idOrName} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Deployment Commands
// ============================================
const deploymentCmd = program
  .command('deployment')
  .description('Deployment operations');

deploymentCmd
  .command('ls')
  .description('List deployments')
  .option('-l, --limit <number>', 'Limit results', '20')
  .option('--project <id>', 'Project ID')
  .option('--state <state>', 'Filter by state')
  .option('--target <target>', 'Filter by target (production, staging)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listDeployments({
        limit: parseInt(opts.limit),
        projectId: opts.project,
        state: opts.state,
        target: opts.target,
      });
      print(result, getFormat(deploymentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deploymentCmd
  .command('get <idOrUrl>')
  .description('Get a deployment by ID or URL')
  .action(async (idOrUrl: string) => {
    try {
      const client = getClient();
      const result = await client.getDeployment(idOrUrl);
      print(result, getFormat(deploymentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deploymentCmd
  .command('cancel <deploymentId>')
  .description('Cancel a deployment')
  .action(async (deploymentId: string) => {
    try {
      const client = getClient();
      const result = await client.cancelDeployment(deploymentId);
      success('Deployment canceled!');
      print(result, getFormat(deploymentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deploymentCmd
  .command('delete <deploymentId>')
  .description('Delete a deployment')
  .action(async (deploymentId: string) => {
    try {
      const client = getClient();
      await client.deleteDeployment(deploymentId);
      success(`Deployment ${deploymentId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

deploymentCmd
  .command('logs <deploymentId>')
  .description('Get deployment logs')
  .option('-l, --limit <number>', 'Limit results', '100')
  .action(async (deploymentId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getDeploymentEvents(deploymentId, {
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(deploymentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Domain Commands
// ============================================
const domainCmd = program
  .command('domain')
  .description('Domain operations');

domainCmd
  .command('ls')
  .description('List all domains')
  .option('-l, --limit <number>', 'Limit results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listDomains({
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(domainCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('get <domain>')
  .description('Get a domain')
  .action(async (domain: string) => {
    try {
      const client = getClient();
      const result = await client.getDomain(domain);
      print(result, getFormat(domainCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('add <projectId> <domain>')
  .description('Add a domain to a project')
  .option('--git-branch <branch>', 'Git branch')
  .action(async (projectId: string, domain: string, opts) => {
    try {
      const client = getClient();
      const result = await client.addProjectDomain(projectId, domain, {
        gitBranch: opts.gitBranch,
      });
      success('Domain added!');
      print(result, getFormat(domainCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('remove <projectId> <domain>')
  .description('Remove a domain from a project')
  .action(async (projectId: string, domain: string) => {
    try {
      const client = getClient();
      await client.removeProjectDomain(projectId, domain);
      success(`Domain ${domain} removed from project`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('verify <projectId> <domain>')
  .description('Verify a domain')
  .action(async (projectId: string, domain: string) => {
    try {
      const client = getClient();
      const result = await client.verifyProjectDomain(projectId, domain);
      success('Domain verification initiated!');
      print(result, getFormat(domainCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

domainCmd
  .command('config <domain>')
  .description('Get domain configuration')
  .action(async (domain: string) => {
    try {
      const client = getClient();
      const result = await client.getDomainConfig(domain);
      print(result, getFormat(domainCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Environment Variable Commands
// ============================================
const envCmd = program
  .command('env')
  .description('Environment variable operations');

envCmd
  .command('ls <projectId>')
  .description('List environment variables for a project')
  .action(async (projectId: string) => {
    try {
      const client = getClient();
      const result = await client.listEnvVars(projectId);
      print(result, getFormat(envCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

envCmd
  .command('get <projectId> <envId>')
  .description('Get an environment variable')
  .action(async (projectId: string, envId: string) => {
    try {
      const client = getClient();
      const result = await client.getEnvVar(projectId, envId);
      print(result, getFormat(envCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

envCmd
  .command('create <projectId>')
  .description('Create an environment variable')
  .requiredOption('--key <key>', 'Variable key')
  .requiredOption('--value <value>', 'Variable value')
  .option('--target <targets>', 'Target environments (comma-separated: production,preview,development)', 'production,preview,development')
  .option('--type <type>', 'Variable type (plain, secret, encrypted)', 'encrypted')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      const targets = opts.target.split(',').map((t: string) => t.trim());
      const result = await client.createEnvVar(projectId, {
        key: opts.key,
        value: opts.value,
        target: targets,
        type: opts.type,
      });
      success('Environment variable created!');
      print(result, getFormat(envCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

envCmd
  .command('delete <projectId> <envId>')
  .description('Delete an environment variable')
  .action(async (projectId: string, envId: string) => {
    try {
      const client = getClient();
      await client.deleteEnvVar(projectId, envId);
      success(`Environment variable ${envId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Secret Commands (Legacy)
// ============================================
const secretCmd = program
  .command('secret')
  .description('Secret operations (legacy)');

secretCmd
  .command('ls')
  .description('List secrets')
  .option('-l, --limit <number>', 'Limit results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listSecrets({
        limit: parseInt(opts.limit),
      });
      print(result, getFormat(secretCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

secretCmd
  .command('get <nameOrId>')
  .description('Get a secret')
  .action(async (nameOrId: string) => {
    try {
      const client = getClient();
      const result = await client.getSecret(nameOrId);
      print(result, getFormat(secretCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

secretCmd
  .command('create <name> <value>')
  .description('Create a secret')
  .action(async (name: string, value: string) => {
    try {
      const client = getClient();
      const result = await client.createSecret(name, value);
      success('Secret created!');
      print(result, getFormat(secretCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

secretCmd
  .command('delete <nameOrId>')
  .description('Delete a secret')
  .action(async (nameOrId: string) => {
    try {
      const client = getClient();
      await client.deleteSecret(nameOrId);
      success(`Secret ${nameOrId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Alias Commands
// ============================================
const aliasCmd = program
  .command('alias')
  .description('Alias operations');

aliasCmd
  .command('ls')
  .description('List aliases')
  .option('-l, --limit <number>', 'Limit results', '20')
  .option('--project <id>', 'Project ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listAliases({
        limit: parseInt(opts.limit),
        projectId: opts.project,
      });
      print(result, getFormat(aliasCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

aliasCmd
  .command('get <aliasId>')
  .description('Get an alias')
  .action(async (aliasId: string) => {
    try {
      const client = getClient();
      const result = await client.getAlias(aliasId);
      print(result, getFormat(aliasCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

aliasCmd
  .command('assign <deploymentId> <alias>')
  .description('Assign an alias to a deployment')
  .action(async (deploymentId: string, alias: string) => {
    try {
      const client = getClient();
      const result = await client.assignAlias(deploymentId, alias);
      success('Alias assigned!');
      print(result, getFormat(aliasCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

aliasCmd
  .command('delete <aliasId>')
  .description('Delete an alias')
  .action(async (aliasId: string) => {
    try {
      const client = getClient();
      await client.deleteAlias(aliasId);
      success(`Alias ${aliasId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
