#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SonarQube } from '../api';
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

const CONNECTOR_NAME = 'connect-sonarqube';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('SonarQube Web API connector CLI')
  .version(VERSION)
  .option('-t, --token <token>', 'SonarQube token (overrides config)')
  .option('-u, --base-url <url>', 'SonarQube base URL (overrides config)')
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
      process.env.SONARQUBE_TOKEN = opts.token;
    }
    if (opts.baseUrl) {
      process.env.SONARQUBE_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): SonarQube {
  const token = getToken();
  const baseUrl = getBaseUrl();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set SONARQUBE_TOKEN.`);
    process.exit(1);
  }
  if (!baseUrl) {
    error(`No base URL configured. Run "${CONNECTOR_NAME} config set-base-url <url>" or set SONARQUBE_BASE_URL.`);
    process.exit(1);
  }
  return new SonarQube({ token, baseUrl });
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
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--token <token>', 'SonarQube token')
  .option('--base-url <url>', 'SonarQube base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { token: opts.token, baseUrl: opts.baseUrl });
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
  info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').description('Set SonarQube token').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set SonarQube base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const token = getToken();
  const baseUrl = getBaseUrl();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${baseUrl || chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const systemCmd = program.command('system').description('System endpoints');

systemCmd.command('status').description('Get SonarQube system status').action(async () => {
  try {
    const result = await getClient().system.status();
    print(result, getFormat(systemCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

systemCmd.command('health').description('Get SonarQube health').action(async () => {
  try {
    const result = await getClient().system.health();
    print(result, getFormat(systemCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

systemCmd.command('ping').description('Ping SonarQube instance').action(async () => {
  try {
    const result = await getClient().system.ping();
    print(result, getFormat(systemCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const projectsCmd = program.command('projects').description('Project operations');

projectsCmd
  .command('search')
  .description('Search projects')
  .option('-q, --query <query>', 'Search query')
  .option('-p, --page <number>', 'Page index', '1')
  .option('--page-size <number>', 'Page size', '100')
  .option('--organization <org>', 'Organization key (SonarCloud)')
  .action(async (opts) => {
    try {
      const result = await getClient().projects.search({
        q: opts.query,
        p: parseInt(opts.page, 10),
        ps: parseInt(opts.pageSize, 10),
        organization: opts.organization,
      });
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd.command('show <component>').description('Show project/component details').action(async (component: string) => {
  try {
    const result = await getClient().projects.show(component);
    print(result, getFormat(projectsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

projectsCmd
  .command('create')
  .description('Create a project')
  .requiredOption('--project <key>', 'Project key')
  .requiredOption('--name <name>', 'Project name')
  .option('--main-branch <branch>', 'Main branch name')
  .option('--visibility <visibility>', 'public or private')
  .option('--organization <org>', 'Organization key (SonarCloud)')
  .action(async (opts) => {
    try {
      const result = await getClient().projects.create({
        project: opts.project,
        name: opts.name,
        mainBranch: opts.mainBranch,
        visibility: opts.visibility,
        organization: opts.organization,
      });
      success('Project created');
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd.command('delete <project>').description('Delete a project').action(async (project: string) => {
  try {
    await getClient().projects.delete(project);
    success(`Project deleted: ${project}`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const issuesCmd = program.command('issues').description('Issue operations');

issuesCmd
  .command('search')
  .description('Search issues')
  .option('--component-keys <keys>', 'Comma-separated component keys')
  .option('--project-keys <keys>', 'Comma-separated project keys')
  .option('--severities <values>', 'Comma-separated severities')
  .option('--statuses <values>', 'Comma-separated statuses')
  .option('--types <values>', 'Comma-separated issue types')
  .option('-p, --page <number>', 'Page index', '1')
  .option('--page-size <number>', 'Page size', '100')
  .action(async (opts) => {
    try {
      const result = await getClient().issues.search({
        componentKeys: opts.componentKeys,
        projectKeys: opts.projectKeys,
        severities: opts.severities,
        statuses: opts.statuses,
        types: opts.types,
        p: parseInt(opts.page, 10),
        ps: parseInt(opts.pageSize, 10),
      });
      print(result, getFormat(issuesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const measuresCmd = program.command('measures').description('Measure operations');

measuresCmd
  .command('component')
  .description('Get component measures')
  .requiredOption('--component <key>', 'Component key')
  .requiredOption('--metrics <metrics>', 'Comma-separated metric keys')
  .option('--branch <branch>', 'Branch name')
  .action(async (opts) => {
    try {
      const result = await getClient().measures.component({
        component: opts.component,
        metricKeys: opts.metrics.split(','),
        branch: opts.branch,
      });
      print(result, getFormat(measuresCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

measuresCmd
  .command('search')
  .description('Search measures for projects')
  .requiredOption('--project-keys <keys>', 'Comma-separated project keys')
  .requiredOption('--metrics <metrics>', 'Comma-separated metric keys')
  .option('-p, --page <number>', 'Page index', '1')
  .option('--page-size <number>', 'Page size', '100')
  .action(async (opts) => {
    try {
      const result = await getClient().measures.search({
        projectKeys: opts.projectKeys.split(','),
        metricKeys: opts.metrics.split(','),
        p: parseInt(opts.page, 10),
        ps: parseInt(opts.pageSize, 10),
      });
      print(result, getFormat(measuresCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const rulesCmd = program.command('rules').description('Rule operations');

rulesCmd
  .command('search')
  .description('Search rules')
  .option('-q, --query <query>', 'Search query')
  .option('--languages <values>', 'Comma-separated languages')
  .option('--severities <values>', 'Comma-separated severities')
  .option('-p, --page <number>', 'Page index', '1')
  .option('--page-size <number>', 'Page size', '100')
  .action(async (opts) => {
    try {
      const result = await getClient().rules.search({
        q: opts.query,
        languages: opts.languages,
        severities: opts.severities,
        p: parseInt(opts.page, 10),
        ps: parseInt(opts.pageSize, 10),
      });
      print(result, getFormat(rulesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const usersCmd = program.command('users').description('User operations');

usersCmd
  .command('search')
  .description('Search users')
  .option('-q, --query <query>', 'Search query')
  .option('-p, --page <number>', 'Page index', '1')
  .option('--page-size <number>', 'Page size', '50')
  .action(async (opts) => {
    try {
      const result = await getClient().users.search({
        q: opts.query,
        p: parseInt(opts.page, 10),
        ps: parseInt(opts.pageSize, 10),
      });
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const groupsCmd = program.command('groups').description('User group operations');

groupsCmd
  .command('search')
  .description('Search user groups')
  .option('-q, --query <query>', 'Search query')
  .option('-p, --page <number>', 'Page index', '1')
  .option('--page-size <number>', 'Page size', '50')
  .action(async (opts) => {
    try {
      const result = await getClient().groups.search({
        q: opts.query,
        p: parseInt(opts.page, 10),
        ps: parseInt(opts.pageSize, 10),
      });
      print(result, getFormat(groupsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const qualityGatesCmd = program.command('quality-gates').description('Quality gate operations');

qualityGatesCmd.command('list').description('List quality gates').action(async () => {
  try {
    const result = await getClient().qualitygates.list();
    print(result, getFormat(qualityGatesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

qualityGatesCmd.command('show <id>').description('Show quality gate details').action(async (id: string) => {
  try {
    const result = await getClient().qualitygates.show(id);
    print(result, getFormat(qualityGatesCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const qualityProfilesCmd = program.command('quality-profiles').description('Quality profile operations');

qualityProfilesCmd
  .command('search')
  .description('Search quality profiles')
  .option('--language <language>', 'Language key')
  .option('--project <project>', 'Project key')
  .option('--defaults', 'Only default profiles')
  .action(async (opts) => {
    try {
      const result = await getClient().qualityprofiles.search({
        language: opts.language,
        project: opts.project,
        defaults: opts.defaults,
      });
      print(result, getFormat(qualityProfilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const webhooksCmd = program.command('webhooks').description('Webhook operations');

webhooksCmd
  .command('list')
  .description('List webhooks')
  .option('--project <project>', 'Project key')
  .action(async (opts) => {
    try {
      const result = await getClient().webhooks.list(opts.project);
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create')
  .description('Create a webhook')
  .requiredOption('--name <name>', 'Webhook name')
  .requiredOption('--url <url>', 'Webhook URL')
  .option('--project <project>', 'Project key')
  .option('--secret <secret>', 'Webhook secret')
  .action(async (opts) => {
    try {
      const result = await getClient().webhooks.create({
        name: opts.name,
        url: opts.url,
        project: opts.project,
        secret: opts.secret,
      });
      success('Webhook created');
      print(result, getFormat(webhooksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhooksCmd.command('delete <webhook>').description('Delete a webhook').action(async (webhook: string) => {
  try {
    await getClient().webhooks.delete(webhook);
    success(`Webhook deleted: ${webhook}`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const ceCmd = program.command('ce').description('Compute Engine task operations');

ceCmd
  .command('activity')
  .description('List CE activity')
  .option('--component <component>', 'Component key')
  .option('--status <status>', 'Comma-separated statuses')
  .option('-p, --page <number>', 'Page index', '1')
  .option('--page-size <number>', 'Page size', '100')
  .action(async (opts) => {
    try {
      const result = await getClient().ce.activity({
        component: opts.component,
        status: opts.status,
        p: parseInt(opts.page, 10),
        ps: parseInt(opts.pageSize, 10),
      });
      print(result, getFormat(ceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ceCmd
  .command('analysis-status')
  .description('Get analysis status for a component')
  .requiredOption('--component <component>', 'Component key')
  .option('--branch <branch>', 'Branch name')
  .option('--pull-request <pr>', 'Pull request ID')
  .action(async (opts) => {
    try {
      const result = await getClient().ce.analysisStatus({
        component: opts.component,
        branch: opts.branch,
        pullRequest: opts.pullRequest,
      });
      print(result, getFormat(ceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
