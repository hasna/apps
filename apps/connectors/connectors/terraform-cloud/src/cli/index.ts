#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TerraformCloud } from '../api';
import {
  getApiToken,
  setApiToken,
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

const CONNECTOR_NAME = 'connect-terraform-cloud';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Terraform Cloud connector - Manage organizations, workspaces, runs, and IaC resources')
  .version(VERSION)
  .option('-t, --token <token>', 'API token (overrides config)')
  .option('-u, --base-url <url>', 'Base URL (overrides config)')
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
    if (opts.token) {
      process.env.TERRAFORM_CLOUD_TOKEN = opts.token;
    }
    if (opts.baseUrl) {
      process.env.TERRAFORM_CLOUD_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TerraformCloud {
  const apiToken = getApiToken();
  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set TERRAFORM_CLOUD_TOKEN.`);
    process.exit(1);
  }
  return new TerraformCloud({ apiToken, baseUrl: getBaseUrl() });
}

function runAction(fn: () => Promise<void>): Promise<void> {
  return fn().catch((err) => {
    error(String(err));
    process.exit(1);
  });
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'API token')
  .option('--base-url <url>', 'Base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiToken: opts.token, baseUrl: opts.baseUrl });
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
    if (!deleteProfile(name)) {
      error(`Profile "${name}" not found`);
      process.exit(1);
    }
    success(`Profile "${name}" deleted`);
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Token: ${config.apiToken ? `${config.apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://app.terraform.io)')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set API token')
  .action((token: string) => {
    setApiToken(token);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiToken = getApiToken();
    const baseUrl = getBaseUrl();
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Token: ${apiToken ? `${apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('default (https://app.terraform.io)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Organization commands
const orgCmd = program.command('org').description('Organization operations');

orgCmd
  .command('ls')
  .description('List organizations')
  .action(async function () {
    await runAction(async () => {
      const result = await getClient().listOrganizations();
      print(result, getFormat(orgCmd));
    });
  });

orgCmd
  .command('get <name>')
  .description('Get organization details')
  .action(async function (name: string) {
    await runAction(async () => {
      const result = await getClient().getOrganization(name);
      print(result, getFormat(orgCmd));
    });
  });

orgCmd
  .command('entitlements <name>')
  .description('Get organization entitlements')
  .action(async function (name: string) {
    await runAction(async () => {
      const result = await getClient().getOrganizationEntitlements(name);
      print(result, getFormat(orgCmd));
    });
  });

// Workspace commands
const wsCmd = program.command('workspace').description('Workspace operations');

wsCmd
  .command('ls <org>')
  .description('List workspaces in an organization')
  .action(async function (org: string) {
    await runAction(async () => {
      const result = await getClient().listWorkspaces(org);
      print(result, getFormat(wsCmd));
    });
  });

wsCmd
  .command('get <org> <name>')
  .description('Get workspace by organization and name')
  .action(async function (org: string, name: string) {
    await runAction(async () => {
      const result = await getClient().getWorkspace(org, name);
      print(result, getFormat(wsCmd));
    });
  });

wsCmd
  .command('get-by-id <id>')
  .description('Get workspace by ID')
  .action(async function (id: string) {
    await runAction(async () => {
      const result = await getClient().getWorkspaceById(id);
      print(result, getFormat(wsCmd));
    });
  });

wsCmd
  .command('create <org> <name>')
  .description('Create a workspace')
  .option('--description <text>', 'Workspace description')
  .action(async function (org: string, name: string, opts) {
    await runAction(async () => {
      const result = await getClient().createWorkspace(org, {
        name,
        description: opts.description,
      });
      success('Workspace created');
      print(result, getFormat(wsCmd));
    });
  });

wsCmd
  .command('delete <org> <name>')
  .description('Delete a workspace')
  .action(async function (org: string, name: string) {
    await runAction(async () => {
      await getClient().deleteWorkspace(org, name);
      success(`Workspace ${name} deleted`);
    });
  });

// Run commands
const runCmd = program.command('run').description('Run operations');

runCmd
  .command('ls <workspaceId>')
  .description('List runs for a workspace')
  .action(async function (workspaceId: string) {
    await runAction(async () => {
      const result = await getClient().listWorkspaceRuns(workspaceId);
      print(result, getFormat(runCmd));
    });
  });

runCmd
  .command('get <runId>')
  .description('Get run details')
  .action(async function (runId: string) {
    await runAction(async () => {
      const result = await getClient().getRun(runId);
      print(result, getFormat(runCmd));
    });
  });

runCmd
  .command('create <workspaceId>')
  .description('Create a run')
  .option('-m, --message <text>', 'Run message')
  .option('--destroy', 'Destroy run')
  .action(async function (workspaceId: string, opts) {
    await runAction(async () => {
      const result = await getClient().createRun(workspaceId, {
        message: opts.message,
        'is-destroy': opts.destroy || false,
      });
      success('Run created');
      print(result, getFormat(runCmd));
    });
  });

runCmd
  .command('apply <runId>')
  .description('Apply a run')
  .option('-c, --comment <text>', 'Apply comment')
  .action(async function (runId: string, opts) {
    await runAction(async () => {
      const result = await getClient().applyRun(runId, opts.comment);
      success('Run apply initiated');
      print(result, getFormat(runCmd));
    });
  });

runCmd
  .command('cancel <runId>')
  .description('Cancel a run')
  .option('-c, --comment <text>', 'Cancel comment')
  .action(async function (runId: string, opts) {
    await runAction(async () => {
      const result = await getClient().cancelRun(runId, opts.comment);
      success('Run cancel initiated');
      print(result, getFormat(runCmd));
    });
  });

// Variable commands
const varCmd = program.command('var').description('Workspace variable operations');

varCmd
  .command('ls <workspaceId>')
  .description('List workspace variables')
  .action(async function (workspaceId: string) {
    await runAction(async () => {
      const result = await getClient().listWorkspaceVars(workspaceId);
      print(result, getFormat(varCmd));
    });
  });

varCmd
  .command('create <workspaceId>')
  .description('Create a workspace variable')
  .requiredOption('--key <key>', 'Variable key')
  .requiredOption('--value <value>', 'Variable value')
  .option('--category <category>', 'terraform or env', 'terraform')
  .option('--sensitive', 'Mark as sensitive')
  .action(async function (workspaceId: string, opts) {
    await runAction(async () => {
      const result = await getClient().createWorkspaceVar(workspaceId, {
        key: opts.key,
        value: opts.value,
        category: opts.category,
        sensitive: opts.sensitive || false,
      });
      success('Variable created');
      print(result, getFormat(varCmd));
    });
  });

varCmd
  .command('delete <workspaceId> <varId>')
  .description('Delete a variable')
  .action(async function (workspaceId: string, varId: string) {
    await runAction(async () => {
      await getClient().deleteVar(workspaceId, varId);
      success(`Variable ${varId} deleted`);
    });
  });

// State version commands
const stateCmd = program.command('state').description('State version operations');

stateCmd
  .command('ls <workspaceId>')
  .description('List state versions')
  .action(async function (workspaceId: string) {
    await runAction(async () => {
      const result = await getClient().listStateVersions(workspaceId);
      print(result, getFormat(stateCmd));
    });
  });

stateCmd
  .command('get <stateVersionId>')
  .description('Get state version')
  .action(async function (stateVersionId: string) {
    await runAction(async () => {
      const result = await getClient().getStateVersion(stateVersionId);
      print(result, getFormat(stateCmd));
    });
  });

// Configuration version commands
const configVerCmd = program.command('config-version').description('Configuration version operations');

configVerCmd
  .command('ls <workspaceId>')
  .description('List configuration versions')
  .action(async function (workspaceId: string) {
    await runAction(async () => {
      const result = await getClient().listConfigurationVersions(workspaceId);
      print(result, getFormat(configVerCmd));
    });
  });

configVerCmd
  .command('get <configVersionId>')
  .description('Get configuration version')
  .action(async function (configVersionId: string) {
    await runAction(async () => {
      const result = await getClient().getConfigurationVersion(configVersionId);
      print(result, getFormat(configVerCmd));
    });
  });

configVerCmd
  .command('create <workspaceId>')
  .description('Create configuration version')
  .option('--auto-queue-runs', 'Auto-queue runs after upload')
  .action(async function (workspaceId: string, opts) {
    await runAction(async () => {
      const result = await getClient().createConfigurationVersion(workspaceId, {
        'auto-queue-runs': opts.autoQueueRuns || false,
      });
      success('Configuration version created');
      print(result, getFormat(configVerCmd));
    });
  });

// Team commands
const teamCmd = program.command('team').description('Team operations');

teamCmd
  .command('ls <org>')
  .description('List teams')
  .action(async function (org: string) {
    await runAction(async () => {
      const result = await getClient().listTeams(org);
      print(result, getFormat(teamCmd));
    });
  });

teamCmd
  .command('get <teamId>')
  .description('Get team details')
  .action(async function (teamId: string) {
    await runAction(async () => {
      const result = await getClient().getTeam(teamId);
      print(result, getFormat(teamCmd));
    });
  });

teamCmd
  .command('create <org> <name>')
  .description('Create a team')
  .action(async function (org: string, name: string) {
    await runAction(async () => {
      const result = await getClient().createTeam(org, { name });
      success('Team created');
      print(result, getFormat(teamCmd));
    });
  });

teamCmd
  .command('delete <teamId>')
  .description('Delete a team')
  .action(async function (teamId: string) {
    await runAction(async () => {
      await getClient().deleteTeam(teamId);
      success(`Team ${teamId} deleted`);
    });
  });

// Project commands
const projectCmd = program.command('project').description('Project operations');

projectCmd
  .command('ls <org>')
  .description('List projects')
  .action(async function (org: string) {
    await runAction(async () => {
      const result = await getClient().listProjects(org);
      print(result, getFormat(projectCmd));
    });
  });

projectCmd
  .command('get <projectId>')
  .description('Get project details')
  .action(async function (projectId: string) {
    await runAction(async () => {
      const result = await getClient().getProject(projectId);
      print(result, getFormat(projectCmd));
    });
  });

projectCmd
  .command('create <org> <name>')
  .description('Create a project')
  .option('--description <text>', 'Project description')
  .action(async function (org: string, name: string, opts) {
    await runAction(async () => {
      const result = await getClient().createProject(org, {
        name,
        description: opts.description,
      });
      success('Project created');
      print(result, getFormat(projectCmd));
    });
  });

projectCmd
  .command('delete <projectId>')
  .description('Delete a project')
  .action(async function (projectId: string) {
    await runAction(async () => {
      await getClient().deleteProject(projectId);
      success(`Project ${projectId} deleted`);
    });
  });

// Policy set commands
const policyCmd = program.command('policy-set').description('Policy set operations');

policyCmd
  .command('ls <org>')
  .description('List policy sets')
  .action(async function (org: string) {
    await runAction(async () => {
      const result = await getClient().listPolicySets(org);
      print(result, getFormat(policyCmd));
    });
  });

policyCmd
  .command('get <policySetId>')
  .description('Get policy set details')
  .action(async function (policySetId: string) {
    await runAction(async () => {
      const result = await getClient().getPolicySet(policySetId);
      print(result, getFormat(policyCmd));
    });
  });

policyCmd
  .command('create <org> <name>')
  .description('Create a policy set')
  .option('--description <text>', 'Policy set description')
  .option('--global', 'Global policy set')
  .action(async function (org: string, name: string, opts) {
    await runAction(async () => {
      const result = await getClient().createPolicySet(org, {
        name,
        description: opts.description,
        global: opts.global || false,
      });
      success('Policy set created');
      print(result, getFormat(policyCmd));
    });
  });

policyCmd
  .command('delete <policySetId>')
  .description('Delete a policy set')
  .action(async function (policySetId: string) {
    await runAction(async () => {
      await getClient().deletePolicySet(policySetId);
      success(`Policy set ${policySetId} deleted`);
    });
  });

program.parse();
