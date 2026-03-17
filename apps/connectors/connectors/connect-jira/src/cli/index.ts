#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Jira } from '../api';
import {
  getEmail,
  setEmail,
  getApiToken,
  setApiToken,
  getDomain,
  setDomain,
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

const CONNECTOR_NAME = 'connect-jira';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Jira connector CLI - Projects, issues, boards, and sprints management')
  .version(VERSION)
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
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Jira {
  const email = getEmail();
  const apiToken = getApiToken();
  const domain = getDomain();

  if (!email || !apiToken || !domain) {
    error(`Configuration incomplete. Run "${CONNECTOR_NAME} config setup" or set JIRA_EMAIL, JIRA_API_TOKEN, JIRA_DOMAIN environment variables.`);
    process.exit(1);
  }
  return new Jira({ email, apiToken, domain });
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
  .option('--email <email>', 'Jira email')
  .option('--token <token>', 'API token')
  .option('--domain <domain>', 'Jira domain (e.g., mycompany.atlassian.net)')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      email: opts.email,
      apiToken: opts.token,
      domain: opts.domain,
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
    info(`Email: ${config.email || chalk.gray('not set')}`);
    info(`API Token: ${config.apiToken ? `${config.apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Domain: ${config.domain || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('setup')
  .description('Configure Jira credentials')
  .requiredOption('--email <email>', 'Jira email')
  .requiredOption('--token <token>', 'API token')
  .requiredOption('--domain <domain>', 'Jira domain (e.g., mycompany.atlassian.net)')
  .action((opts) => {
    setEmail(opts.email);
    setApiToken(opts.token);
    setDomain(opts.domain);
    success(`Configuration saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-email <email>')
  .description('Set Jira email')
  .action((email: string) => {
    setEmail(email);
    success(`Email saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-token <token>')
  .description('Set API token')
  .action((token: string) => {
    setApiToken(token);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-domain <domain>')
  .description('Set Jira domain')
  .action((domain: string) => {
    setDomain(domain);
    success(`Domain saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const email = getEmail();
    const apiToken = getApiToken();
    const domain = getDomain();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Email: ${email || chalk.gray('not set')}`);
    info(`API Token: ${apiToken ? `${apiToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Domain: ${domain || chalk.gray('not set')}`);
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
  .description('Get current authenticated user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.getMyself();
      print(result, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('search')
  .description('Search users')
  .option('-q, --query <query>', 'Search query')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.searchUsers({
        query: opts.query,
        maxResults: parseInt(opts.limit),
      });
      print(result, getFormat(userCmd));
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
  .command('list')
  .description('List projects')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .option('--expand <fields>', 'Expand fields (comma-separated)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listProjects({
        maxResults: parseInt(opts.limit),
        expand: opts.expand,
      });
      print(result.values, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectCmd
  .command('get <projectKeyOrId>')
  .description('Get a project by key or ID')
  .option('--expand <fields>', 'Expand fields (comma-separated)')
  .action(async (projectKeyOrId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getProject(projectKeyOrId, { expand: opts.expand });
      print(result, getFormat(projectCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Issue Commands
// ============================================
const issueCmd = program
  .command('issue')
  .description('Issue operations');

issueCmd
  .command('search')
  .description('Search issues with JQL')
  .requiredOption('-j, --jql <jql>', 'JQL query')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .option('--fields <fields>', 'Fields to return (comma-separated)')
  .option('--expand <expand>', 'Expand fields')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.searchIssues({
        jql: opts.jql,
        maxResults: parseInt(opts.limit),
        fields: opts.fields ? opts.fields.split(',') : undefined,
        expand: opts.expand,
      });
      print(result.issues, getFormat(issueCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issueCmd
  .command('get <issueKeyOrId>')
  .description('Get an issue by key or ID')
  .option('--fields <fields>', 'Fields to return (comma-separated)')
  .option('--expand <expand>', 'Expand fields')
  .action(async (issueKeyOrId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getIssue(issueKeyOrId, {
        fields: opts.fields ? opts.fields.split(',') : undefined,
        expand: opts.expand,
      });
      print(result, getFormat(issueCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issueCmd
  .command('create')
  .description('Create an issue')
  .requiredOption('-p, --project <key>', 'Project key')
  .requiredOption('-t, --type <type>', 'Issue type (e.g., Task, Bug, Story)')
  .requiredOption('-s, --summary <summary>', 'Issue summary')
  .option('-d, --description <description>', 'Issue description')
  .option('--assignee <accountId>', 'Assignee account ID')
  .option('--priority <name>', 'Priority name')
  .option('--labels <labels>', 'Labels (comma-separated)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.createIssue({
        fields: {
          project: { key: opts.project },
          issuetype: { name: opts.type },
          summary: opts.summary,
          description: opts.description,
          assignee: opts.assignee ? { accountId: opts.assignee } : undefined,
          priority: opts.priority ? { name: opts.priority } : undefined,
          labels: opts.labels ? opts.labels.split(',') : undefined,
        },
      });
      success(`Issue created: ${result.key}`);
      print(result, getFormat(issueCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issueCmd
  .command('update <issueKeyOrId>')
  .description('Update an issue')
  .option('-s, --summary <summary>', 'Issue summary')
  .option('-d, --description <description>', 'Issue description')
  .option('--priority <name>', 'Priority name')
  .option('--labels <labels>', 'Labels (comma-separated)')
  .action(async (issueKeyOrId: string, opts) => {
    try {
      const client = getClient();
      const fields: Record<string, unknown> = {};
      if (opts.summary) fields.summary = opts.summary;
      if (opts.description) fields.description = opts.description;
      if (opts.priority) fields.priority = { name: opts.priority };
      if (opts.labels) fields.labels = opts.labels.split(',');

      await client.updateIssue(issueKeyOrId, { fields });
      success(`Issue ${issueKeyOrId} updated!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issueCmd
  .command('delete <issueKeyOrId>')
  .description('Delete an issue')
  .option('--delete-subtasks', 'Also delete subtasks')
  .action(async (issueKeyOrId: string, opts) => {
    try {
      const client = getClient();
      await client.deleteIssue(issueKeyOrId, { deleteSubtasks: opts.deleteSubtasks });
      success(`Issue ${issueKeyOrId} deleted!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

issueCmd
  .command('assign <issueKeyOrId>')
  .description('Assign an issue')
  .option('-u, --user <accountId>', 'User account ID (omit to unassign)')
  .action(async (issueKeyOrId: string, opts) => {
    try {
      const client = getClient();
      await client.assignIssue(issueKeyOrId, opts.user || null);
      success(`Issue ${issueKeyOrId} ${opts.user ? 'assigned' : 'unassigned'}!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Transition Commands
// ============================================
const transitionCmd = program
  .command('transition')
  .description('Issue transition operations');

transitionCmd
  .command('list <issueKeyOrId>')
  .description('List available transitions')
  .action(async (issueKeyOrId: string) => {
    try {
      const client = getClient();
      const result = await client.getTransitions(issueKeyOrId);
      print(result.transitions, getFormat(transitionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transitionCmd
  .command('do <issueKeyOrId> <transitionId>')
  .description('Transition an issue')
  .action(async (issueKeyOrId: string, transitionId: string) => {
    try {
      const client = getClient();
      await client.transitionIssue(issueKeyOrId, { transition: { id: transitionId } });
      success(`Issue ${issueKeyOrId} transitioned!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Comment Commands
// ============================================
const commentCmd = program
  .command('comment')
  .description('Comment operations');

commentCmd
  .command('list <issueKeyOrId>')
  .description('List comments on an issue')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .action(async (issueKeyOrId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getComments(issueKeyOrId, {
        maxResults: parseInt(opts.limit),
      });
      print(result.comments, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd
  .command('add <issueKeyOrId>')
  .description('Add a comment to an issue')
  .requiredOption('-b, --body <text>', 'Comment body')
  .action(async (issueKeyOrId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.addComment(issueKeyOrId, { body: opts.body });
      success('Comment added!');
      print(result, getFormat(commentCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentCmd
  .command('delete <issueKeyOrId> <commentId>')
  .description('Delete a comment')
  .action(async (issueKeyOrId: string, commentId: string) => {
    try {
      const client = getClient();
      await client.deleteComment(issueKeyOrId, commentId);
      success(`Comment ${commentId} deleted!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Board Commands
// ============================================
const boardCmd = program
  .command('board')
  .description('Board operations (Agile)');

boardCmd
  .command('list')
  .description('List boards')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .option('--type <type>', 'Board type: scrum, kanban, simple')
  .option('--name <name>', 'Filter by name')
  .option('--project <projectKeyOrId>', 'Filter by project')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listBoards({
        maxResults: parseInt(opts.limit),
        type: opts.type,
        name: opts.name,
        projectKeyOrId: opts.project,
      });
      print(result.values, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('get <boardId>')
  .description('Get a board by ID')
  .action(async (boardId: string) => {
    try {
      const client = getClient();
      const result = await client.getBoard(parseInt(boardId));
      print(result, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

boardCmd
  .command('issues <boardId>')
  .description('List issues on a board')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .option('-j, --jql <jql>', 'Additional JQL filter')
  .action(async (boardId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getBoardIssues(parseInt(boardId), {
        maxResults: parseInt(opts.limit),
        jql: opts.jql,
      });
      print(result.issues, getFormat(boardCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Sprint Commands
// ============================================
const sprintCmd = program
  .command('sprint')
  .description('Sprint operations');

sprintCmd
  .command('list <boardId>')
  .description('List sprints for a board')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .option('--state <state>', 'Sprint state: future, active, closed')
  .action(async (boardId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listSprints(parseInt(boardId), {
        maxResults: parseInt(opts.limit),
        state: opts.state,
      });
      print(result.values, getFormat(sprintCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sprintCmd
  .command('get <sprintId>')
  .description('Get a sprint by ID')
  .action(async (sprintId: string) => {
    try {
      const client = getClient();
      const result = await client.getSprint(parseInt(sprintId));
      print(result, getFormat(sprintCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sprintCmd
  .command('issues <sprintId>')
  .description('List issues in a sprint')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .action(async (sprintId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.getSprintIssues(parseInt(sprintId), {
        maxResults: parseInt(opts.limit),
      });
      print(result.issues, getFormat(sprintCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
