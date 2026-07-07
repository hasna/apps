#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Wakatime } from '../api';
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
  isAuthenticated,
} from '../utils/config';
import type { OutputFormat } from '../types';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'wakatime';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('WakaTime API connector CLI - coding time analytics')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
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
      process.env.WAKATIME_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Wakatime {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set WAKATIME_API_KEY.`);
    process.exit(1);
  }
  return new Wakatime({ apiKey });
}

async function run<T>(cmd: Command, fn: (client: Wakatime) => Promise<T>): Promise<void> {
  try {
    const result = await fn(getClient());
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

function parseIds(value: string): string[] {
  return value.split(',').map((id) => id.trim()).filter(Boolean);
}

function parseRules(value: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error('rules must be a JSON array');
  }
  return parsed as Array<Record<string, unknown>>;
}

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
    const marker = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${marker}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Authenticated: ${isAuthenticated() ? 'yes' : 'no'}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

program
  .command('users current')
  .description('Get current authenticated user')
  .action(async function (this: Command) {
    await run(this, (client) => client.users.getCurrentUser());
  });

program
  .command('users all-time')
  .description('Get all time coded since today')
  .option('-u, --user <user>', 'User id or current', 'current')
  .option('--project <project>', 'Filter by project')
  .action(async function (this: Command, opts: { user?: string; project?: string }) {
    await run(this, (client) => client.users.getAllTimeSinceToday(opts));
  });

program
  .command('users machine-names')
  .description('List machine names for a user')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (this: Command, opts: { user?: string }) {
    await run(this, (client) => client.users.listMachineNames(opts));
  });

const heartbeatsCmd = program.command('heartbeats').description('Heartbeat operations');

heartbeatsCmd
  .command('list')
  .description('List heartbeats for a date')
  .requiredOption('-d, --date <date>', 'Date (YYYY-MM-DD)')
  .option('-u, --user <user>', 'User id or current', 'current')
  .option('--timezone <timezone>', 'Timezone')
  .action(async function (this: Command, opts: { date: string; user?: string; timezone?: string }) {
    await run(this, (client) => client.heartbeats.list(opts));
  });

heartbeatsCmd
  .command('create')
  .description('Create a heartbeat')
  .requiredOption('-e, --entity <entity>', 'Entity (file path or app name)')
  .requiredOption('-t, --type <type>', 'Entity type (file, app, domain)')
  .requiredOption('--time <time>', 'Unix timestamp', parseFloat)
  .option('-u, --user <user>', 'User id or current', 'current')
  .option('--project <project>', 'Project name')
  .option('--language <language>', 'Language')
  .option('--write', 'Mark as write activity')
  .option('--lines <lines>', 'Lines count', parseInt)
  .action(async function (
    this: Command,
    opts: {
      entity: string;
      type: string;
      time: number;
      user?: string;
      project?: string;
      language?: string;
      write?: boolean;
      lines?: number;
    },
  ) {
    await run(this, (client) =>
      client.heartbeats.create({
        user: opts.user,
        entity: opts.entity,
        type: opts.type,
        time: opts.time,
        project: opts.project,
        language: opts.language,
        isWrite: opts.write,
        lines: opts.lines,
      }),
    );
  });

heartbeatsCmd
  .command('delete')
  .description('Delete heartbeats by id')
  .requiredOption('--ids <ids>', 'Comma-separated heartbeat ids')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (this: Command, opts: { ids: string; user?: string }) {
    await run(this, (client) =>
      client.heartbeats.deleteBulk({ user: opts.user, ids: parseIds(opts.ids) }),
    );
  });

program
  .command('durations')
  .description('Get durations for a date')
  .requiredOption('-d, --date <date>', 'Date (YYYY-MM-DD)')
  .option('-u, --user <user>', 'User id or current', 'current')
  .option('--project <project>', 'Filter by project')
  .option('--timezone <timezone>', 'Timezone')
  .action(async function (
    this: Command,
    opts: { date: string; user?: string; project?: string; timezone?: string },
  ) {
    await run(this, (client) => client.durations.get(opts));
  });

program
  .command('summaries')
  .description('Get coding summaries')
  .option('-u, --user <user>', 'User id or current', 'current')
  .option('--start <start>', 'Start date')
  .option('--end <end>', 'End date')
  .option('--range <range>', 'Predefined range')
  .option('--project <project>', 'Filter by project')
  .option('--timezone <timezone>', 'Timezone')
  .action(async function (
    this: Command,
    opts: { user?: string; start?: string; end?: string; range?: string; project?: string; timezone?: string },
  ) {
    await run(this, (client) => client.summaries.get(opts));
  });

program
  .command('stats')
  .description('Get coding stats')
  .option('-u, --user <user>', 'User id or current', 'current')
  .option('--range <range>', 'Stats range', 'last_7_days')
  .option('--project <project>', 'Filter by project')
  .option('--timeout <timeout>', 'Timeout in seconds', parseInt)
  .action(async function (
    this: Command,
    opts: { user?: string; range?: string; project?: string; timeout?: number },
  ) {
    await run(this, (client) => client.stats.get(opts));
  });

program
  .command('insights')
  .description('Get coding insights')
  .requiredOption('--type <type>', 'Insight type')
  .requiredOption('--range <range>', 'Insight range')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (
    this: Command,
    opts: { type: string; range: string; user?: string },
  ) {
    await run(this, (client) =>
      client.insights.get({ user: opts.user, insightType: opts.type, range: opts.range }),
    );
  });

const projectsCmd = program.command('projects').description('Project operations');

projectsCmd
  .command('list')
  .description('List projects')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (this: Command, opts: { user?: string }) {
    await run(this, (client) => client.projects.list(opts));
  });

projectsCmd
  .command('commits')
  .description('List commits for a project')
  .requiredOption('--project <project>', 'Project name')
  .option('-u, --user <user>', 'User id or current', 'current')
  .option('--page <page>', 'Page number', parseInt)
  .option('--branch <branch>', 'Branch name')
  .option('--author <author>', 'Author filter')
  .action(async function (
    this: Command,
    opts: { project: string; user?: string; page?: number; branch?: string; author?: string },
  ) {
    await run(this, (client) => client.projects.listCommits(opts));
  });

projectsCmd
  .command('commit')
  .description('Get a single commit')
  .requiredOption('--project <project>', 'Project name')
  .requiredOption('--hash <hash>', 'Commit hash')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (
    this: Command,
    opts: { project: string; hash: string; user?: string },
  ) {
    await run(this, (client) => client.projects.getCommit(opts));
  });

program
  .command('leaders')
  .description('Get public leaderboards')
  .option('--language <language>', 'Programming language')
  .option('--page <page>', 'Page number', parseInt)
  .option('--country-code <code>', 'Country code')
  .action(async function (
    this: Command,
    opts: { language?: string; page?: number; countryCode?: string },
  ) {
    await run(this, (client) => client.leaders.get(opts));
  });

program
  .command('private-leaderboards')
  .description('List private leaderboards')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (this: Command, opts: { user?: string }) {
    await run(this, (client) => client.leaders.listPrivateLeaderboards(opts));
  });

const orgsCmd = program.command('orgs').description('Organization operations');

orgsCmd
  .command('list')
  .description('List organizations')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (this: Command, opts: { user?: string }) {
    await run(this, (client) => client.orgs.list(opts));
  });

orgsCmd
  .command('dashboards')
  .description('List org dashboards')
  .requiredOption('--org <org>', 'Organization id')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (this: Command, opts: { org: string; user?: string }) {
    await run(this, (client) => client.orgs.listDashboards({ user: opts.user, org: opts.org }));
  });

program
  .command('goals')
  .description('List coding goals')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (this: Command, opts: { user?: string }) {
    await run(this, (client) => client.goals.list(opts));
  });

const rulesCmd = program.command('custom-rules').description('Custom rules operations');

rulesCmd
  .command('get')
  .description('Get custom rules')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (this: Command, opts: { user?: string }) {
    await run(this, (client) => client.customRules.get(opts));
  });

rulesCmd
  .command('update')
  .description('Update custom rules')
  .requiredOption('--rules <json>', 'JSON array of rule objects')
  .option('-u, --user <user>', 'User id or current', 'current')
  .action(async function (this: Command, opts: { rules: string; user?: string }) {
    await run(this, (client) =>
      client.customRules.update({ user: opts.user, rules: parseRules(opts.rules) }),
    );
  });

program
  .command('editors')
  .description('List supported editors')
  .action(async function (this: Command) {
    await run(this, (client) => client.editors.list());
  });

program
  .command('meta')
  .description('Get API metadata')
  .action(async function (this: Command) {
    await run(this, (client) => client.meta.get());
  });

program.parse();
