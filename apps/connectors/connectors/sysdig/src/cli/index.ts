#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Sysdig } from '../api';
import {
  getApiToken,
  setApiToken,
  getRegion,
  setRegion,
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

const CONNECTOR_NAME = 'connect-sysdig';
const VERSION = '0.0.1';

const program = new Command();

function credentialStatus(value?: string): string {
  return value ? 'configured' : chalk.gray('not set');
}

program
  .name(CONNECTOR_NAME)
  .description('Sysdig connector - Manage Monitor alerts, dashboards, events, notification channels, users, teams, and Secure policies')
  .version(VERSION)
  .option('-t, --api-token <token>', 'API token (overrides config)')
  .option('-r, --region <region>', 'Sysdig SaaS region (e.g., us1, us2, eu1)')
  .option('-u, --base-url <url>', 'Custom base URL (on-prem; overrides region)')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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
    if (opts.apiToken) {
      process.env.SYSDIG_API_TOKEN = opts.apiToken;
    }
    if (opts.region) {
      process.env.SYSDIG_REGION = opts.region;
    }
    if (opts.baseUrl) {
      process.env.SYSDIG_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Sysdig {
  const apiToken = getApiToken();
  const region = getRegion();
  const baseUrl = getBaseUrl();

  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set SYSDIG_API_TOKEN environment variable.`);
    process.exit(1);
  }
  return new Sysdig({ apiToken, region, baseUrl });
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
  .option('--api-token <token>', 'API token')
  .option('--region <region>', 'Sysdig SaaS region')
  .option('--base-url <url>', 'Custom base URL (on-prem)')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiToken: opts.apiToken,
      region: opts.region,
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
    info(`API Token: ${credentialStatus(config.apiToken)}`);
    info(`Region: ${config.region || chalk.gray('us1 (default)')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-token <apiToken>')
  .description('Set API token')
  .action((apiToken: string) => {
    setApiToken(apiToken);
    success(`API token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-region <region>')
  .description('Set Sysdig SaaS region (e.g., us1, us2, eu1)')
  .action((region: string) => {
    setRegion(region);
    success(`Region saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set custom base URL (on-prem installations)')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiToken = getApiToken();
    const region = getRegion();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Token: ${credentialStatus(apiToken)}`);
    info(`Region: ${region || chalk.gray('us1 (default)')}`);
    info(`Base URL: ${baseUrl || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Validate Command
// ============================================
program
  .command('validate')
  .description('Validate API credentials')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      await client.validate();
      success('API credentials are valid');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Whoami Command
// ============================================
program
  .command('whoami')
  .description('Show the current authenticated user')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const user = await client.getCurrentUser();
      print(user, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Users Commands
// ============================================
const usersCmd = program
  .command('users')
  .description('Manage users');

usersCmd
  .command('list')
  .description('List users')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listUsers();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('get <id>')
  .description('Get a user')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getUser(parseInt(id));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('me')
  .description('Get the current user')
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
// Teams Commands
// ============================================
const teamsCmd = program
  .command('teams')
  .description('Manage teams');

teamsCmd
  .command('list')
  .description('List teams')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listTeams();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

teamsCmd
  .command('get <id>')
  .description('Get a team')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getTeam(parseInt(id));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Alerts Commands
// ============================================
const alertsCmd = program
  .command('alerts')
  .description('Manage Monitor alerts');

alertsCmd
  .command('list')
  .description('List alerts')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listAlerts();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

alertsCmd
  .command('get <id>')
  .description('Get an alert')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getAlert(parseInt(id));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

alertsCmd
  .command('create')
  .description('Create an alert')
  .requiredOption('--name <name>', 'Alert name')
  .option('--description <description>', 'Alert description')
  .option('--condition <condition>', 'Alert condition expression')
  .option('--severity <severity>', 'Severity (0 high .. 7 info)', '4')
  .option('--timespan <microseconds>', 'Evaluation timespan in microseconds')
  .option('--disabled', 'Create the alert disabled')
  .option('--channels <ids>', 'Comma-separated notification channel IDs')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createAlert({
        name: opts.name,
        description: opts.description,
        condition: opts.condition,
        severity: parseInt(opts.severity),
        timespan: opts.timespan ? parseInt(opts.timespan) : undefined,
        enabled: !opts.disabled,
        notificationChannelIds: opts.channels
          ? opts.channels.split(',').map((id: string) => parseInt(id.trim()))
          : undefined,
      });
      print(result, getFormat(this));
      success(`Alert created: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

alertsCmd
  .command('delete <id>')
  .description('Delete an alert')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      await client.deleteAlert(parseInt(id));
      success(`Alert ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Dashboards Commands
// ============================================
const dashboardsCmd = program
  .command('dashboards')
  .description('Manage Monitor dashboards');

dashboardsCmd
  .command('list')
  .description('List dashboards')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listDashboards();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dashboardsCmd
  .command('get <id>')
  .description('Get a dashboard')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getDashboard(parseInt(id));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

dashboardsCmd
  .command('delete <id>')
  .description('Delete a dashboard')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      await client.deleteDashboard(parseInt(id));
      success(`Dashboard ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Notification Channels Commands
// ============================================
const channelsCmd = program
  .command('channels')
  .description('Manage notification channels');

channelsCmd
  .command('list')
  .description('List notification channels')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listNotificationChannels();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelsCmd
  .command('get <id>')
  .description('Get a notification channel')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getNotificationChannel(parseInt(id));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Events Commands
// ============================================
const eventsCmd = program
  .command('events')
  .description('Manage Monitor events');

eventsCmd
  .command('list')
  .description('List events')
  .option('--from <timestamp>', 'Start time (Unix seconds)')
  .option('--to <timestamp>', 'End time (Unix seconds)')
  .option('--limit <limit>', 'Maximum number of events')
  .option('--filter <filter>', 'Event filter expression')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listEvents({
        from: opts.from ? parseInt(opts.from) : undefined,
        to: opts.to ? parseInt(opts.to) : undefined,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
        filter: opts.filter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('get <id>')
  .description('Get an event')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getEvent(id);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('create')
  .description('Create a custom event')
  .requiredOption('--name <name>', 'Event name')
  .option('--description <description>', 'Event description')
  .option('--severity <severity>', 'Severity (0 high .. 7 info)')
  .option('--scope <scope>', 'Event scope expression')
  .option('--tags <tags>', 'Comma-separated key=value tags')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const tags = opts.tags
        ? Object.fromEntries(
            (opts.tags as string).split(',').map((pair: string) => {
              const [k, ...rest] = pair.split('=');
              return [k.trim(), rest.join('=').trim()];
            }),
          )
        : undefined;
      const result = await client.createEvent({
        name: opts.name,
        description: opts.description,
        severity: opts.severity ? parseInt(opts.severity) : undefined,
        scope: opts.scope,
        tags,
      });
      print(result, getFormat(this));
      success(`Event created: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('delete <id>')
  .description('Delete an event')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      await client.deleteEvent(id);
      success(`Event ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Secure Policies Commands
// ============================================
const policiesCmd = program
  .command('policies')
  .description('Manage Sysdig Secure policies');

policiesCmd
  .command('list')
  .description('List Secure policies')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.listSecurePolicies();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

policiesCmd
  .command('get <id>')
  .description('Get a Secure policy')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getSecurePolicy(parseInt(id));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
