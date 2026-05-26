#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Datadog } from '../api';
import {
  getApiKey,
  setApiKey,
  getAppKey,
  setAppKey,
  getSite,
  setSite,
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

const CONNECTOR_NAME = 'connect-datadog';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Datadog connector - Manage metrics, monitors, dashboards, SLOs, and more')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-a, --app-key <key>', 'Application key (overrides config)')
  .option('-s, --site <site>', 'Datadog site (e.g., datadoghq.com, datadoghq.eu)')
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
      process.env.DATADOG_API_KEY = opts.apiKey;
    }
    if (opts.appKey) {
      process.env.DATADOG_APP_KEY = opts.appKey;
    }
    if (opts.site) {
      process.env.DATADOG_SITE = opts.site;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Datadog {
  const apiKey = getApiKey();
  const appKey = getAppKey();
  const site = getSite();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-api-key <key>" or set DATADOG_API_KEY environment variable.`);
    process.exit(1);
  }
  if (!appKey) {
    error(`No Application key configured. Run "${CONNECTOR_NAME} config set-app-key <key>" or set DATADOG_APP_KEY environment variable.`);
    process.exit(1);
  }
  return new Datadog({ apiKey, appKey, site });
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
  .option('--app-key <key>', 'Application key')
  .option('--site <site>', 'Datadog site')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      appKey: opts.appKey,
      site: opts.site,
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
    info(`App Key: ${config.appKey ? `${config.appKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Site: ${config.site || chalk.gray('datadoghq.com (default)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-api-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-app-key <appKey>')
  .description('Set Application key')
  .action((appKey: string) => {
    setAppKey(appKey);
    success(`Application key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-site <site>')
  .description('Set Datadog site (e.g., datadoghq.com, datadoghq.eu)')
  .action((site: string) => {
    setSite(site);
    success(`Site saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const appKey = getAppKey();
    const site = getSite();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`App Key: ${appKey ? `${appKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Site: ${site || chalk.gray('datadoghq.com (default)')}`);
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
      const result = await client.validate();
      if (result.valid) {
        success('API credentials are valid');
      } else {
        error('API credentials are invalid');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Organization Command
// ============================================
program
  .command('org')
  .description('Get organization info')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.getOrganization();
      print(result.org, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Metrics Commands
// ============================================
const metricsCmd = program
  .command('metrics')
  .description('Manage metrics');

metricsCmd
  .command('query')
  .description('Query timeseries metrics')
  .requiredOption('-q, --query <query>', 'Metrics query')
  .option('--from <timestamp>', 'Start time (Unix timestamp)', String(Math.floor(Date.now() / 1000) - 3600))
  .option('--to <timestamp>', 'End time (Unix timestamp)', String(Math.floor(Date.now() / 1000)))
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.queryMetrics({
        query: opts.query,
        from: parseInt(opts.from),
        to: parseInt(opts.to),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

metricsCmd
  .command('list')
  .description('List active metrics')
  .requiredOption('--from <timestamp>', 'Start time (Unix timestamp)')
  .option('--host <host>', 'Filter by host')
  .option('--tag-filter <filter>', 'Filter by tag')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listActiveMetrics({
        from: parseInt(opts.from),
        host: opts.host,
        tag_filter: opts.tagFilter,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

metricsCmd
  .command('metadata <name>')
  .description('Get metric metadata')
  .action(async function(this: Command, name: string) {
    try {
      const client = getClient();
      const result = await client.getMetricMetadata(name);
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
  .description('Manage events');

eventsCmd
  .command('list')
  .description('List events')
  .requiredOption('--start <timestamp>', 'Start time (Unix timestamp)')
  .requiredOption('--end <timestamp>', 'End time (Unix timestamp)')
  .option('--priority <priority>', 'Priority (normal, low)')
  .option('--sources <sources>', 'Comma-separated sources')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listEvents({
        start: parseInt(opts.start),
        end: parseInt(opts.end),
        priority: opts.priority,
        sources: opts.sources,
        tags: opts.tags,
      });
      print(result.events, getFormat(this));
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
      const result = await client.getEvent(parseInt(id));
      print(result.event, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

eventsCmd
  .command('create')
  .description('Create an event')
  .requiredOption('--title <title>', 'Event title')
  .requiredOption('--text <text>', 'Event text')
  .option('--priority <priority>', 'Priority (normal, low)', 'normal')
  .option('--alert-type <type>', 'Alert type (error, warning, info, success)')
  .option('--host <host>', 'Host name')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createEvent({
        title: opts.title,
        text: opts.text,
        priority: opts.priority,
        alert_type: opts.alertType,
        host: opts.host,
        tags: opts.tags?.split(','),
      });
      print(result.event, getFormat(this));
      success(`Event created: ${result.event.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Monitors Commands
// ============================================
const monitorsCmd = program
  .command('monitors')
  .description('Manage monitors');

monitorsCmd
  .command('list')
  .description('List monitors')
  .option('--name <name>', 'Filter by name')
  .option('--tags <tags>', 'Filter by tags')
  .option('--page <page>', 'Page number', '0')
  .option('--page-size <size>', 'Page size', '100')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listMonitors({
        name: opts.name,
        tags: opts.tags,
        page: parseInt(opts.page),
        page_size: parseInt(opts.pageSize),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

monitorsCmd
  .command('get <id>')
  .description('Get a monitor')
  .option('--with-downtimes', 'Include downtime info')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.getMonitor(parseInt(id), {
        with_downtimes: opts.withDowntimes,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

monitorsCmd
  .command('delete <id>')
  .description('Delete a monitor')
  .option('--force', 'Force deletion')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      await client.deleteMonitor(parseInt(id), { force: opts.force });
      success(`Monitor ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

monitorsCmd
  .command('mute <id>')
  .description('Mute a monitor')
  .option('--scope <scope>', 'Scope to mute')
  .option('--end <timestamp>', 'End time (Unix timestamp)')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      await client.muteMonitor(parseInt(id), {
        scope: opts.scope,
        end: opts.end ? parseInt(opts.end) : undefined,
      });
      success(`Monitor ${id} muted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

monitorsCmd
  .command('unmute <id>')
  .description('Unmute a monitor')
  .option('--scope <scope>', 'Scope to unmute')
  .option('--all-scopes', 'Unmute all scopes')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      await client.unmuteMonitor(parseInt(id), {
        scope: opts.scope,
        all_scopes: opts.allScopes,
      });
      success(`Monitor ${id} unmuted`);
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
  .description('Manage dashboards');

dashboardsCmd
  .command('list')
  .description('List dashboards')
  .option('--count <count>', 'Number of dashboards', '100')
  .option('--start <start>', 'Start index', '0')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listDashboards({
        count: parseInt(opts.count),
        start: parseInt(opts.start),
      });
      print(result.dashboards, getFormat(this));
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
      const result = await client.getDashboard(id);
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
      await client.deleteDashboard(id);
      success(`Dashboard ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// SLOs Commands
// ============================================
const slosCmd = program
  .command('slos')
  .description('Manage SLOs (Service Level Objectives)');

slosCmd
  .command('list')
  .description('List SLOs')
  .option('--query <query>', 'Search query')
  .option('--tags <tags>', 'Filter by tags')
  .option('--limit <limit>', 'Limit results', '100')
  .option('--offset <offset>', 'Offset', '0')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listSLOs({
        query: opts.query,
        tags_query: opts.tags,
        limit: parseInt(opts.limit),
        offset: parseInt(opts.offset),
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

slosCmd
  .command('get <id>')
  .description('Get an SLO')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getSLO(id);
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

slosCmd
  .command('delete <id>')
  .description('Delete an SLO')
  .option('--force', 'Force deletion')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      await client.deleteSLO(id, { force: opts.force });
      success(`SLO ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

slosCmd
  .command('history <id>')
  .description('Get SLO history')
  .requiredOption('--from <timestamp>', 'Start time (Unix timestamp)')
  .requiredOption('--to <timestamp>', 'End time (Unix timestamp)')
  .action(async function(this: Command, id: string, opts) {
    try {
      const client = getClient();
      const result = await client.getSLOHistory(id, {
        from_ts: parseInt(opts.from),
        to_ts: parseInt(opts.to),
      });
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Hosts Commands
// ============================================
const hostsCmd = program
  .command('hosts')
  .description('Manage hosts');

hostsCmd
  .command('list')
  .description('List hosts')
  .option('--filter <filter>', 'Filter hosts')
  .option('--sort-field <field>', 'Sort field')
  .option('--sort-dir <dir>', 'Sort direction (asc, desc)')
  .option('--count <count>', 'Number of hosts', '100')
  .option('--start <start>', 'Start index', '0')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listHosts({
        filter: opts.filter,
        sort_field: opts.sortField,
        sort_dir: opts.sortDir,
        count: parseInt(opts.count),
        start: parseInt(opts.start),
      });
      print(result.host_list, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

hostsCmd
  .command('totals')
  .description('Get host totals')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.getHostTotals();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

hostsCmd
  .command('mute <hostname>')
  .description('Mute a host')
  .option('--end <timestamp>', 'End time (Unix timestamp)')
  .option('--message <message>', 'Mute message')
  .action(async function(this: Command, hostname: string, opts) {
    try {
      const client = getClient();
      await client.muteHost(hostname, {
        end: opts.end ? parseInt(opts.end) : undefined,
        message: opts.message,
      });
      success(`Host ${hostname} muted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

hostsCmd
  .command('unmute <hostname>')
  .description('Unmute a host')
  .action(async function(this: Command, hostname: string) {
    try {
      const client = getClient();
      await client.unmuteHost(hostname);
      success(`Host ${hostname} unmuted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Downtimes Commands
// ============================================
const downtimesCmd = program
  .command('downtimes')
  .description('Manage downtimes');

downtimesCmd
  .command('list')
  .description('List downtimes')
  .option('--current-only', 'Only current downtimes')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listDowntimes({
        current_only: opts.currentOnly,
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

downtimesCmd
  .command('get <id>')
  .description('Get a downtime')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      const result = await client.getDowntime(parseInt(id));
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

downtimesCmd
  .command('create')
  .description('Create a downtime')
  .requiredOption('--scope <scope>', 'Scope (e.g., "host:myhost")')
  .option('--start <timestamp>', 'Start time (Unix timestamp)')
  .option('--end <timestamp>', 'End time (Unix timestamp)')
  .option('--message <message>', 'Downtime message')
  .option('--timezone <timezone>', 'Timezone')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createDowntime({
        scope: opts.scope.split(','),
        start: opts.start ? parseInt(opts.start) : undefined,
        end: opts.end ? parseInt(opts.end) : undefined,
        message: opts.message,
        timezone: opts.timezone,
      });
      print(result, getFormat(this));
      success(`Downtime created: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

downtimesCmd
  .command('delete <id>')
  .description('Delete a downtime')
  .action(async function(this: Command, id: string) {
    try {
      const client = getClient();
      await client.deleteDowntime(parseInt(id));
      success(`Downtime ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

downtimesCmd
  .command('cancel-by-scope')
  .description('Cancel downtimes by scope')
  .requiredOption('--scope <scope>', 'Scope to cancel')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.cancelDowntimesByScope(opts.scope);
      print(result, getFormat(this));
      success(`Cancelled ${result.cancelled_ids.length} downtime(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Synthetics Commands
// ============================================
const syntheticsCmd = program
  .command('synthetics')
  .description('Manage synthetic tests');

syntheticsCmd
  .command('list')
  .description('List synthetic tests')
  .option('--page-size <size>', 'Page size', '100')
  .option('--page-number <number>', 'Page number', '0')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listSyntheticsTests({
        page_size: parseInt(opts.pageSize),
        page_number: parseInt(opts.pageNumber),
      });
      print(result.tests, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

syntheticsCmd
  .command('get <publicId>')
  .description('Get a synthetic test')
  .action(async function(this: Command, publicId: string) {
    try {
      const client = getClient();
      const result = await client.getSyntheticsTest(publicId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

syntheticsCmd
  .command('delete <publicIds>')
  .description('Delete synthetic tests (comma-separated IDs)')
  .action(async function(this: Command, publicIds: string) {
    try {
      const client = getClient();
      const result = await client.deleteSyntheticsTest(publicIds.split(','));
      print(result, getFormat(this));
      success(`Deleted ${result.deleted_tests.length} test(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

syntheticsCmd
  .command('trigger <publicIds>')
  .description('Trigger synthetic tests (comma-separated IDs)')
  .action(async function(this: Command, publicIds: string) {
    try {
      const client = getClient();
      const result = await client.triggerSyntheticsTests(publicIds.split(','));
      print(result, getFormat(this));
      success(`Triggered tests, batch ID: ${result.batch_id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

syntheticsCmd
  .command('results <publicId>')
  .description('Get synthetic test results')
  .option('--from <timestamp>', 'Start time (Unix timestamp)')
  .option('--to <timestamp>', 'End time (Unix timestamp)')
  .action(async function(this: Command, publicId: string, opts) {
    try {
      const client = getClient();
      const result = await client.getSyntheticsTestResults(publicId, {
        from_ts: opts.from ? parseInt(opts.from) : undefined,
        to_ts: opts.to ? parseInt(opts.to) : undefined,
      });
      print(result.results, getFormat(this));
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
  .option('--page-size <size>', 'Page size', '100')
  .option('--page-number <number>', 'Page number', '0')
  .option('--filter <filter>', 'Filter users')
  .option('--filter-status <status>', 'Filter by status')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.listUsers({
        page_size: parseInt(opts.pageSize),
        page_number: parseInt(opts.pageNumber),
        filter: opts.filter,
        filter_status: opts.filterStatus,
      });
      print(result.data, getFormat(this));
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
      const result = await client.getUser(id);
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('me')
  .description('Get current user')
  .action(async function(this: Command) {
    try {
      const client = getClient();
      const result = await client.getCurrentUser();
      print(result.data, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
