#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Linear } from '../api';
import type { OutputFormat, LinearPriority } from '../types';
import {
  getApiKey,
  setApiKey,
  getDefaultTeamId,
  setDefaultTeamId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  clearConfig,
  isAuthenticated,
  setProfileOverride,
} from '../utils/config';
import { print, success, error, info, heading } from '../utils/output';

const program = new Command();

// Helper to get authenticated client
function getClient(): Linear {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(chalk.red('Error: No Linear API key configured.'));
    console.error(chalk.yellow('Set API key with: connect-linear config set-api-key <key>'));
    console.error(chalk.yellow('Or set LINEAR_API_KEY environment variable'));
    process.exit(1);
  }
  return new Linear({ apiKey });
}

// Global options
program
  .name('connect-linear')
  .description('Linear API CLI')
  .version('0.0.1')
  .option('-p, --profile <name>', 'Use specific profile')
  .option('-f, --format <format>', 'Output format: json, table, pretty', 'pretty')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

// ============================================
// Auth/Config Commands
// ============================================

const configCmd = program
  .command('config')
  .description('Configuration commands');

configCmd
  .command('set-api-key <key>')
  .description('Set API key for current profile')
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-team <teamId>')
  .description('Set default team ID')
  .action((teamId: string) => {
    setDefaultTeamId(teamId);
    success(`Default team set to "${teamId}"`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const apiKey = getApiKey();
    const teamId = getDefaultTeamId();

    heading('Current Configuration');
    print({
      profile,
      authenticated: isAuthenticated(),
      apiKey: apiKey ? `${apiKey.substring(0, 10)}...` : 'Not set',
      defaultTeamId: teamId || 'Not set',
    });
  });

configCmd
  .command('clear')
  .description('Clear configuration for current profile')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// Profile Commands
// ============================================

const profileCmd = program
  .command('profile')
  .description('Profile management');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      info('No profiles found. Using default.');
      return;
    }

    heading('Profiles');
    profiles.forEach(p => {
      const marker = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${marker}`);
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
    success(`Switched to profile "${name}"`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      createProfile(name);
      success(`Profile "${name}" created`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    try {
      deleteProfile(name);
      success(`Profile "${name}" deleted`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('show')
  .description('Show current profile name')
  .action(() => {
    console.log(getCurrentProfile());
  });

// ============================================
// Test/Auth Commands
// ============================================

program
  .command('test')
  .alias('whoami')
  .description('Test authentication and show current user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.test();
      print({
        name: result.name,
        displayName: result.displayName,
        email: result.email,
        admin: result.admin,
        active: result.active,
      });
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ============================================
// Issue Commands
// ============================================

const issuesCmd = program
  .command('issues')
  .description('Issue commands');

issuesCmd
  .command('list')
  .description('List issues')
  .option('-t, --team <id>', 'Filter by team ID')
  .option('-p, --project <id>', 'Filter by project ID')
  .option('-a, --assignee <id>', 'Filter by assignee ID')
  .option('-l, --limit <n>', 'Maximum number to return', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const issues = await client.issues.list({
        teamId: opts.team || getDefaultTeamId(),
        projectId: opts.project,
        assigneeId: opts.assignee,
        first: parseInt(opts.limit, 10),
      });

      if (format === 'json') {
        print(issues, format);
      } else {
        print(issues.map(i => ({
          id: i.identifier,
          title: i.title.substring(0, 50) + (i.title.length > 50 ? '...' : ''),
          status: i.state?.name || 'Unknown',
          priority: i.priorityLabel,
          assignee: i.assignee?.displayName || 'Unassigned',
        })), format);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

issuesCmd
  .command('get <id>')
  .description('Get issue details')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const issue = await client.issues.get(id);
      print(issue, format);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

issuesCmd
  .command('create')
  .description('Create a new issue')
  .requiredOption('--title <title>', 'Issue title')
  .requiredOption('--team <id>', 'Team ID')
  .option('--description <text>', 'Issue description')
  .option('--project <id>', 'Project ID')
  .option('--assignee <id>', 'Assignee user ID')
  .option('--priority <n>', 'Priority (0-4)', '0')
  .action(async (opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const issue = await client.issues.create({
        title: opts.title,
        teamId: opts.team || getDefaultTeamId()!,
        description: opts.description,
        projectId: opts.project,
        assigneeId: opts.assignee,
        priority: parseInt(opts.priority, 10) as LinearPriority,
      });

      success(`Issue created: ${issue.identifier}`);
      print({
        id: issue.identifier,
        title: issue.title,
        url: issue.url,
      }, format);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

issuesCmd
  .command('update <id>')
  .description('Update an issue')
  .option('--title <title>', 'New title')
  .option('--description <text>', 'New description')
  .option('--state <id>', 'New state ID')
  .option('--assignee <id>', 'New assignee ID')
  .option('--priority <n>', 'New priority (0-4)')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;

      const updates: Record<string, unknown> = {};
      if (opts.title) updates.title = opts.title;
      if (opts.description) updates.description = opts.description;
      if (opts.state) updates.stateId = opts.state;
      if (opts.assignee) updates.assigneeId = opts.assignee;
      if (opts.priority) updates.priority = parseInt(opts.priority, 10);

      const issue = await client.issues.update(id, updates);
      success(`Issue updated: ${issue.identifier}`);
      print({
        id: issue.identifier,
        title: issue.title,
        status: issue.state?.name,
      }, format);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

issuesCmd
  .command('archive <id>')
  .description('Archive an issue')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.issues.archive(id);
      success(`Issue ${id} archived`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

issuesCmd
  .command('search <query>')
  .description('Search issues')
  .option('-l, --limit <n>', 'Maximum results', '20')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const issues = await client.issues.search(query, parseInt(opts.limit, 10));

      if (format === 'json') {
        print(issues, format);
      } else {
        print(issues.map(i => ({
          id: i.identifier,
          title: i.title.substring(0, 50) + (i.title.length > 50 ? '...' : ''),
          status: i.state?.name || 'Unknown',
          team: i.team?.key || 'Unknown',
        })), format);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ============================================
// Project Commands
// ============================================

const projectsCmd = program
  .command('projects')
  .description('Project commands');

projectsCmd
  .command('list')
  .description('List projects')
  .option('-l, --limit <n>', 'Maximum number to return', '50')
  .action(async (opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const projects = await client.projects.list({
        first: parseInt(opts.limit, 10),
      });

      if (format === 'json') {
        print(projects, format);
      } else {
        print(projects.map(p => ({
          id: p.id,
          name: p.name,
          state: p.state,
          progress: `${Math.round(p.progress * 100)}%`,
          lead: p.lead?.displayName || 'None',
        })), format);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

projectsCmd
  .command('get <id>')
  .description('Get project details')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const project = await client.projects.get(id);
      print(project, format);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ============================================
// Team Commands
// ============================================

const teamsCmd = program
  .command('teams')
  .description('Team commands');

teamsCmd
  .command('list')
  .description('List teams')
  .action(async () => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const teams = await client.teams.list();

      if (format === 'json') {
        print(teams, format);
      } else {
        print(teams.map(t => ({
          id: t.id,
          key: t.key,
          name: t.name,
          private: t.private ? 'yes' : 'no',
        })), format);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

teamsCmd
  .command('get <id>')
  .description('Get team details')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const team = await client.teams.get(id);
      print(team, format);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

teamsCmd
  .command('states <teamId>')
  .description('List workflow states for a team')
  .action(async (teamId: string) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const states = await client.teams.getWorkflowStates(teamId);

      if (format === 'json') {
        print(states, format);
      } else {
        print(states.map(s => ({
          id: s.id,
          name: s.name,
          type: s.type,
          color: s.color,
        })), format);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ============================================
// User Commands
// ============================================

const usersCmd = program
  .command('users')
  .description('User commands');

usersCmd
  .command('list')
  .description('List users')
  .option('-l, --limit <n>', 'Maximum number to return', '100')
  .option('--all', 'Include inactive users')
  .action(async (opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;

      let users;
      if (opts.all) {
        users = await client.users.list({ first: parseInt(opts.limit, 10) });
      } else {
        users = await client.users.listActive({ first: parseInt(opts.limit, 10) });
      }

      if (format === 'json') {
        print(users, format);
      } else {
        print(users.map(u => ({
          id: u.id,
          name: u.name,
          displayName: u.displayName,
          email: u.email,
          admin: u.admin ? 'yes' : 'no',
          active: u.active ? 'yes' : 'no',
        })), format);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

usersCmd
  .command('get <id>')
  .description('Get user details')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const user = await client.users.get(id);
      print(user, format);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

usersCmd
  .command('me')
  .description('Show current authenticated user')
  .action(async () => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const user = await client.users.me();
      print(user, format);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

program.parse();
