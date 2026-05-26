#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { GitLab } from '../api';
import {
  getAccessToken,
  setAccessToken,
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

const CONNECTOR_NAME = 'connect-gitlab';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('GitLab connector - Manage projects, issues, merge requests, pipelines, and more')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
  .option('-u, --url <url>', 'GitLab URL (overrides config)')
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
      process.env.GITLAB_ACCESS_TOKEN = opts.token;
    }
    if (opts.url) {
      process.env.GITLAB_URL = opts.url;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): GitLab {
  const accessToken = getAccessToken();
  const baseUrl = getBaseUrl();

  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set GITLAB_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  return new GitLab({ accessToken, baseUrl });
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
  .option('--token <token>', 'Access token')
  .option('--url <url>', 'GitLab URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
      baseUrl: opts.url,
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`URL: ${config.baseUrl || chalk.gray('gitlab.com (default)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-token <token>')
  .description('Set access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-url <url>')
  .description('Set GitLab URL (for self-hosted)')
  .action((url: string) => {
    setBaseUrl(url);
    success(`URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const token = getAccessToken();
    const url = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`URL: ${url || chalk.gray('gitlab.com (default)')}`);
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
program
  .command('me')
  .description('Get current user info')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.getCurrentUser();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Projects Commands
// ============================================
const projectsCmd = program
  .command('projects')
  .description('Manage projects');

projectsCmd
  .command('list')
  .description('List projects')
  .option('--owned', 'Only owned projects')
  .option('--membership', 'Only membership projects')
  .option('--starred', 'Only starred projects')
  .option('--search <query>', 'Search query')
  .option('--visibility <visibility>', 'Visibility (public, internal, private)')
  .option('--per-page <count>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listProjects({
        owned: opts.owned,
        membership: opts.membership,
        starred: opts.starred,
        search: opts.search,
        visibility: opts.visibility,
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('get <projectId>')
  .description('Get a project')
  .action(async function(this: Command, projectId: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.getProject(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('create')
  .description('Create a project')
  .requiredOption('-n, --name <name>', 'Project name')
  .option('--path <path>', 'Project path')
  .option('--description <description>', 'Project description')
  .option('--visibility <visibility>', 'Visibility (public, internal, private)', 'private')
  .option('--initialize-readme', 'Initialize with README')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createProject({
        name: opts.name,
        path: opts.path,
        description: opts.description,
        visibility: opts.visibility,
        initialize_with_readme: opts.initializeReadme,
      });
      print(result, getFormat(this));
      success(`Project created: ${result.web_url}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('delete <projectId>')
  .description('Delete a project')
  .action(async function(this: Command, projectId: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      await client.deleteProject(id);
      success(`Project ${projectId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd
  .command('fork <projectId>')
  .description('Fork a project')
  .option('--namespace <namespace>', 'Target namespace')
  .option('--name <name>', 'New project name')
  .action(async function(this: Command, projectId: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.forkProject(id, {
        namespace_path: opts.namespace,
        name: opts.name,
      });
      print(result, getFormat(this));
      success(`Project forked: ${result.web_url}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Issues Commands
// ============================================
const issuesCmd = program
  .command('issues')
  .description('Manage issues');

issuesCmd
  .command('list <projectId>')
  .description('List project issues')
  .option('--state <state>', 'State (opened, closed, all)', 'opened')
  .option('--labels <labels>', 'Filter by labels')
  .option('--search <query>', 'Search query')
  .option('--per-page <count>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async function(this: Command, projectId: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.listIssues(id, {
        state: opts.state,
        labels: opts.labels,
        search: opts.search,
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issuesCmd
  .command('get <projectId> <issueIid>')
  .description('Get an issue')
  .action(async function(this: Command, projectId: string, issueIid: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.getIssue(id, parseInt(issueIid));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issuesCmd
  .command('create <projectId>')
  .description('Create an issue')
  .requiredOption('-t, --title <title>', 'Issue title')
  .option('-d, --description <description>', 'Issue description')
  .option('--labels <labels>', 'Comma-separated labels')
  .option('--assignee-ids <ids>', 'Comma-separated assignee IDs')
  .action(async function(this: Command, projectId: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.createIssue(id, {
        title: opts.title,
        description: opts.description,
        labels: opts.labels,
        assignee_ids: opts.assigneeIds?.split(',').map((i: string) => parseInt(i)),
      });
      print(result, getFormat(this));
      success(`Issue created: ${result.web_url}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issuesCmd
  .command('close <projectId> <issueIid>')
  .description('Close an issue')
  .action(async function(this: Command, projectId: string, issueIid: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      await client.updateIssue(id, parseInt(issueIid), { state_event: 'close' });
      success(`Issue #${issueIid} closed`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issuesCmd
  .command('reopen <projectId> <issueIid>')
  .description('Reopen an issue')
  .action(async function(this: Command, projectId: string, issueIid: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      await client.updateIssue(id, parseInt(issueIid), { state_event: 'reopen' });
      success(`Issue #${issueIid} reopened`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Merge Requests Commands
// ============================================
const mrCmd = program
  .command('mr')
  .description('Manage merge requests');

mrCmd
  .command('list <projectId>')
  .description('List merge requests')
  .option('--state <state>', 'State (opened, closed, merged, all)', 'opened')
  .option('--source-branch <branch>', 'Source branch')
  .option('--target-branch <branch>', 'Target branch')
  .option('--search <query>', 'Search query')
  .option('--per-page <count>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async function(this: Command, projectId: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.listMergeRequests(id, {
        state: opts.state,
        source_branch: opts.sourceBranch,
        target_branch: opts.targetBranch,
        search: opts.search,
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mrCmd
  .command('get <projectId> <mrIid>')
  .description('Get a merge request')
  .action(async function(this: Command, projectId: string, mrIid: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.getMergeRequest(id, parseInt(mrIid));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mrCmd
  .command('create <projectId>')
  .description('Create a merge request')
  .requiredOption('-s, --source-branch <branch>', 'Source branch')
  .requiredOption('-t, --target-branch <branch>', 'Target branch')
  .requiredOption('--title <title>', 'MR title')
  .option('-d, --description <description>', 'MR description')
  .option('--remove-source-branch', 'Remove source branch on merge')
  .option('--squash', 'Squash commits on merge')
  .action(async function(this: Command, projectId: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.createMergeRequest(id, {
        source_branch: opts.sourceBranch,
        target_branch: opts.targetBranch,
        title: opts.title,
        description: opts.description,
        remove_source_branch: opts.removeSourceBranch,
        squash: opts.squash,
      });
      print(result, getFormat(this));
      success(`Merge request created: ${result.web_url}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mrCmd
  .command('merge <projectId> <mrIid>')
  .description('Merge a merge request')
  .option('--squash', 'Squash commits')
  .option('--remove-source-branch', 'Remove source branch')
  .option('--when-pipeline-succeeds', 'Merge when pipeline succeeds')
  .action(async function(this: Command, projectId: string, mrIid: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.acceptMergeRequest(id, parseInt(mrIid), {
        squash: opts.squash,
        should_remove_source_branch: opts.removeSourceBranch,
        merge_when_pipeline_succeeds: opts.whenPipelineSucceeds,
      });
      print(result, getFormat(this));
      success(`Merge request !${mrIid} merged`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Pipelines Commands
// ============================================
const pipelinesCmd = program
  .command('pipelines')
  .description('Manage pipelines');

pipelinesCmd
  .command('list <projectId>')
  .description('List pipelines')
  .option('--status <status>', 'Status filter')
  .option('--ref <ref>', 'Branch/tag ref')
  .option('--per-page <count>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async function(this: Command, projectId: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.listPipelines(id, {
        status: opts.status,
        ref: opts.ref,
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pipelinesCmd
  .command('get <projectId> <pipelineId>')
  .description('Get a pipeline')
  .action(async function(this: Command, projectId: string, pipelineId: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.getPipeline(id, parseInt(pipelineId));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pipelinesCmd
  .command('create <projectId>')
  .description('Create/trigger a pipeline')
  .requiredOption('-r, --ref <ref>', 'Branch or tag to run pipeline on')
  .action(async function(this: Command, projectId: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.createPipeline(id, opts.ref);
      print(result, getFormat(this));
      success(`Pipeline #${result.id} created`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pipelinesCmd
  .command('retry <projectId> <pipelineId>')
  .description('Retry a pipeline')
  .action(async function(this: Command, projectId: string, pipelineId: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.retryPipeline(id, parseInt(pipelineId));
      print(result, getFormat(this));
      success(`Pipeline #${pipelineId} retried`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pipelinesCmd
  .command('cancel <projectId> <pipelineId>')
  .description('Cancel a pipeline')
  .action(async function(this: Command, projectId: string, pipelineId: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.cancelPipeline(id, parseInt(pipelineId));
      print(result, getFormat(this));
      success(`Pipeline #${pipelineId} cancelled`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Jobs Commands
// ============================================
const jobsCmd = program
  .command('jobs')
  .description('Manage jobs');

jobsCmd
  .command('list <projectId> <pipelineId>')
  .description('List pipeline jobs')
  .option('--per-page <count>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async function(this: Command, projectId: string, pipelineId: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.listPipelineJobs(id, parseInt(pipelineId), {
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobsCmd
  .command('get <projectId> <jobId>')
  .description('Get a job')
  .action(async function(this: Command, projectId: string, jobId: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.getJob(id, parseInt(jobId));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobsCmd
  .command('retry <projectId> <jobId>')
  .description('Retry a job')
  .action(async function(this: Command, projectId: string, jobId: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      await client.retryJob(id, parseInt(jobId));
      success(`Job ${jobId} retried`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobsCmd
  .command('cancel <projectId> <jobId>')
  .description('Cancel a job')
  .action(async function(this: Command, projectId: string, jobId: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      await client.cancelJob(id, parseInt(jobId));
      success(`Job ${jobId} cancelled`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

jobsCmd
  .command('play <projectId> <jobId>')
  .description('Play a manual job')
  .action(async function(this: Command, projectId: string, jobId: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      await client.playJob(id, parseInt(jobId));
      success(`Job ${jobId} started`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Branches Commands
// ============================================
const branchesCmd = program
  .command('branches')
  .description('Manage branches');

branchesCmd
  .command('list <projectId>')
  .description('List branches')
  .option('--search <query>', 'Search query')
  .option('--per-page <count>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async function(this: Command, projectId: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.listBranches(id, {
        search: opts.search,
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

branchesCmd
  .command('get <projectId> <branch>')
  .description('Get a branch')
  .action(async function(this: Command, projectId: string, branch: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.getBranch(id, branch);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

branchesCmd
  .command('create <projectId>')
  .description('Create a branch')
  .requiredOption('-n, --name <name>', 'Branch name')
  .requiredOption('-r, --ref <ref>', 'Source branch/commit')
  .action(async function(this: Command, projectId: string, opts) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      const result = await client.createBranch(id, opts.name, opts.ref);
      print(result, getFormat(this));
      success(`Branch ${opts.name} created`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

branchesCmd
  .command('delete <projectId> <branch>')
  .description('Delete a branch')
  .action(async function(this: Command, projectId: string, branch: string) {
    try {
      const client = getClient();
      const id = projectId.includes('/') ? projectId : parseInt(projectId);
      await client.deleteBranch(id, branch);
      success(`Branch ${branch} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Groups Commands
// ============================================
const groupsCmd = program
  .command('groups')
  .description('Manage groups');

groupsCmd
  .command('list')
  .description('List groups')
  .option('--owned', 'Only owned groups')
  .option('--search <query>', 'Search query')
  .option('--per-page <count>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listGroups({
        owned: opts.owned,
        search: opts.search,
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('get <groupId>')
  .description('Get a group')
  .action(async function(this: Command, groupId: string) {
    try {
      const client = getClient();
      const id = groupId.includes('/') ? groupId : parseInt(groupId);
      const result = await client.getGroup(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

groupsCmd
  .command('projects <groupId>')
  .description('List group projects')
  .option('--per-page <count>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async function(this: Command, groupId: string, opts) {
    try {
      const client = getClient();
      const id = groupId.includes('/') ? groupId : parseInt(groupId);
      const result = await client.listGroupProjects(id, {
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Runners Commands
// ============================================
const runnersCmd = program
  .command('runners')
  .description('Manage runners');

runnersCmd
  .command('list')
  .description('List runners')
  .option('--status <status>', 'Status (online, offline)')
  .option('--type <type>', 'Type (instance_type, group_type, project_type)')
  .option('--per-page <count>', 'Results per page', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listRunners({
        status: opts.status,
        type: opts.type,
        per_page: parseInt(opts.perPage),
        page: parseInt(opts.page),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

runnersCmd
  .command('get <runnerId>')
  .description('Get a runner')
  .action(async function(this: Command, runnerId: string) {
    try {
      const client = getClient();
      const result = await client.getRunner(parseInt(runnerId));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
