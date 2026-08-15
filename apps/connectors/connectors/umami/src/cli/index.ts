#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Umami } from '../api';
import {
  getApiKey,
  setApiKey,
  getHost,
  setHost,
  getBaseUrl,
  setBaseUrl,
  getRegion,
  setRegion,
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
import type { MetricsType, TeamRole, TimeUnit } from '../types';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-umami';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Umami analytics connector - websites, statistics, events, and teams')
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
      process.env.UMAMI_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Umami {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set UMAMI_API_KEY.`);
    process.exit(1);
  }

  return new Umami({
    apiKey,
    host: getHost(),
    baseUrl: getBaseUrl(),
    region: getRegion(),
  });
}

function parseTimestamp(value: string | undefined, label: string): number {
  if (!value) {
    error(`${label} is required (ISO date or epoch milliseconds)`);
    process.exit(1);
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    error(`Invalid ${label}: ${value}`);
    process.exit(1);
  }
  return parsed;
}

function parseFilters(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed;
  } catch {
    error('Filters must be valid JSON object');
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd
  .command('list')
  .description('List profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();
    if (profiles.length === 0) {
      info('No profiles found.');
      return;
    }
    success('Profiles:');
    profiles.forEach((p) => {
      const active = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${active}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch active profile')
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
  .description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--host <host>', 'API host')
  .option('--region <region>', 'Cloud region (us|eu)')
  .option('--use', 'Switch to profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    const region = opts.region === 'us' || opts.region === 'eu' ? opts.region : undefined;
    createProfile(name, { apiKey: opts.apiKey, host: opts.host, region });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete profile')
  .action((name: string) => {
    if (name === 'default') {
      error('Cannot delete default profile');
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
  .description('Show profile config')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    print({ profile: profileName, ...config, apiKey: config.apiKey ? '***' : undefined }, 'pretty');
  });

// Config commands
const configCmd = program.command('config').description('Manage connector configuration');

configCmd
  .command('set-key <key>')
  .description('Set API key')
  .action((key: string) => {
    setApiKey(key);
    success('API key saved');
  });

configCmd
  .command('set-host <host>')
  .description('Set API host (cloud or self-hosted)')
  .action((host: string) => {
    setHost(host);
    success('Host saved');
  });

configCmd
  .command('set-base-url <url>')
  .description('Set explicit API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success('Base URL saved');
  });

configCmd
  .command('set-region <region>')
  .description('Set cloud region (us|eu)')
  .action((region: string) => {
    if (region !== 'us' && region !== 'eu') {
      error('Region must be us or eu');
      process.exit(1);
    }
    setRegion(region);
    success(`Region set to ${region}`);
  });

configCmd
  .command('show')
  .description('Show active configuration')
  .action(() => {
    const client = getClient();
    print(
      {
        profile: getCurrentProfile(),
        apiKey: client.getApiKeyPreview(),
        baseUrl: client.getBaseUrl(),
        configDir: getConfigDir(),
      },
      'pretty'
    );
  });

configCmd
  .command('clear')
  .description('Clear active profile credentials')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// Website commands
const websitesCmd = program.command('websites').description('Website management');

websitesCmd
  .command('list')
  .description('List websites')
  .option('--include-teams', 'Include team-owned websites')
  .option('--search <text>', 'Search text')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size')
  .action(async (opts, cmd) => {
    const client = getClient();
    const data = await client.websites.list({
      includeTeams: opts.includeTeams,
      search: opts.search,
      page: Number(opts.page),
      pageSize: opts.pageSize ? Number(opts.pageSize) : undefined,
    });
    print(data, getFormat(cmd));
  });

websitesCmd
  .command('get <websiteId>')
  .description('Get website')
  .action(async (websiteId: string, _opts, cmd) => {
    print(await getClient().websites.get(websiteId), getFormat(cmd));
  });

websitesCmd
  .command('create')
  .description('Create website')
  .requiredOption('--name <name>', 'Website name')
  .requiredOption('--domain <domain>', 'Tracked domain')
  .option('--team-id <id>', 'Team ID')
  .option('--share-id <id>', 'Share ID')
  .action(async (opts, cmd) => {
    const data = await getClient().websites.create({
      name: opts.name,
      domain: opts.domain,
      teamId: opts.teamId,
      shareId: opts.shareId,
    });
    print(data, getFormat(cmd));
  });

websitesCmd
  .command('update <websiteId>')
  .description('Update website')
  .option('--name <name>', 'Website name')
  .option('--domain <domain>', 'Tracked domain')
  .option('--share-id <id>', 'Share ID')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().websites.update(websiteId, {
      name: opts.name,
      domain: opts.domain,
      shareId: opts.shareId,
    });
    print(data, getFormat(cmd));
  });

websitesCmd
  .command('delete <websiteId>')
  .description('Delete website')
  .action(async (websiteId: string, _opts, cmd) => {
    print(await getClient().websites.delete(websiteId), getFormat(cmd));
  });

websitesCmd
  .command('reset <websiteId>')
  .description('Reset website statistics')
  .action(async (websiteId: string, _opts, cmd) => {
    print(await getClient().websites.reset(websiteId), getFormat(cmd));
  });

websitesCmd
  .command('active <websiteId>')
  .description('Get active visitors')
  .action(async (websiteId: string, _opts, cmd) => {
    print(await getClient().websites.getActive(websiteId), getFormat(cmd));
  });

websitesCmd
  .command('daterange <websiteId>')
  .description('Get available data date range')
  .action(async (websiteId: string, _opts, cmd) => {
    print(await getClient().websites.getDateRange(websiteId), getFormat(cmd));
  });

// Stats commands
const statsCmd = program.command('stats').description('Website analytics');

statsCmd
  .command('summary <websiteId>')
  .description('Get summarized website statistics')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getStats(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

statsCmd
  .command('pageviews <websiteId>')
  .description('Get pageviews time series')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .option('--unit <unit>', 'Time unit (minute|hour|day|month|year)', 'day')
  .option('--timezone <tz>', 'Timezone')
  .option('--compare <mode>', 'Comparison period (prev|yoy)')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getPageviews(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      unit: opts.unit as TimeUnit,
      timezone: opts.timezone,
      compare: opts.compare,
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

statsCmd
  .command('metrics <websiteId>')
  .description('Get metrics breakdown')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .requiredOption('--type <type>', 'Metric type')
  .option('--limit <n>', 'Result limit', '500')
  .option('--offset <n>', 'Result offset', '0')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getMetrics(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      type: opts.type as MetricsType,
      limit: Number(opts.limit),
      offset: Number(opts.offset),
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

statsCmd
  .command('metrics-expanded <websiteId>')
  .description('Get expanded metrics breakdown')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .requiredOption('--type <type>', 'Metric type')
  .option('--limit <n>', 'Result limit', '500')
  .option('--offset <n>', 'Result offset', '0')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getMetricsExpanded(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      type: opts.type as MetricsType,
      limit: Number(opts.limit),
      offset: Number(opts.offset),
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

statsCmd
  .command('events-series <websiteId>')
  .description('Get events time series')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .option('--unit <unit>', 'Time unit', 'day')
  .option('--timezone <tz>', 'Timezone')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getEventsSeries(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      unit: opts.unit as TimeUnit,
      timezone: opts.timezone,
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

statsCmd
  .command('events <websiteId>')
  .description('List website events')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .option('--search <text>', 'Search text')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size', '20')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.listEvents(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      search: opts.search,
      page: Number(opts.page),
      pageSize: Number(opts.pageSize),
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

statsCmd
  .command('event-stats <websiteId>')
  .description('Get aggregated event statistics')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .option('--compare <mode>', 'Comparison period (prev|yoy)')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getEventStats(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      compare: opts.compare,
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

const eventDataCmd = statsCmd.command('event-data').description('Event data queries');

eventDataCmd
  .command('list <websiteId>')
  .description('List event data')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size', '20')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getEventData(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      page: Number(opts.page),
      pageSize: Number(opts.pageSize),
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

eventDataCmd
  .command('get <websiteId> <eventId>')
  .description('Get event data by ID')
  .action(async (websiteId: string, eventId: string, _opts, cmd) => {
    print(await getClient().analytics.getEventDataById(websiteId, eventId), getFormat(cmd));
  });

eventDataCmd
  .command('events <websiteId>')
  .description('List event data names and properties')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .option('--event <name>', 'Event name filter')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getEventDataEvents(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      event: opts.event,
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

eventDataCmd
  .command('fields <websiteId>')
  .description('Get event data field counts')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getEventDataFields(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

eventDataCmd
  .command('properties <websiteId>')
  .description('Get event property counts')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getEventDataProperties(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

eventDataCmd
  .command('values <websiteId>')
  .description('Get event property values')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .requiredOption('--event <name>', 'Event name')
  .requiredOption('--property <name>', 'Property name')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getEventDataValues(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      event: opts.event,
      propertyName: opts.property,
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

eventDataCmd
  .command('stats <websiteId>')
  .description('Get aggregated event data stats')
  .requiredOption('--start-at <ms>', 'Start timestamp')
  .requiredOption('--end-at <ms>', 'End timestamp')
  .option('--filters <json>', 'Filters JSON')
  .action(async (websiteId: string, opts, cmd) => {
    const data = await getClient().analytics.getEventDataStats(websiteId, {
      startAt: parseTimestamp(opts.startAt, 'start-at'),
      endAt: parseTimestamp(opts.endAt, 'end-at'),
      filters: parseFilters(opts.filters),
    });
    print(data, getFormat(cmd));
  });

// Teams commands
const teamsCmd = program.command('teams').description('Team management');

teamsCmd
  .command('list')
  .description('List teams')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size')
  .action(async (opts, cmd) => {
    const data = await getClient().teams.list({
      page: Number(opts.page),
      pageSize: opts.pageSize ? Number(opts.pageSize) : undefined,
    });
    print(data, getFormat(cmd));
  });

teamsCmd
  .command('get <teamId>')
  .description('Get team')
  .action(async (teamId: string, _opts, cmd) => {
    print(await getClient().teams.get(teamId), getFormat(cmd));
  });

teamsCmd
  .command('create')
  .description('Create team')
  .requiredOption('--name <name>', 'Team name')
  .action(async (opts, cmd) => {
    print(await getClient().teams.create({ name: opts.name }), getFormat(cmd));
  });

teamsCmd
  .command('update <teamId>')
  .description('Update team')
  .option('--name <name>', 'Team name')
  .option('--access-code <code>', 'Access code')
  .action(async (teamId: string, opts, cmd) => {
    const data = await getClient().teams.update(teamId, {
      name: opts.name,
      accessCode: opts.accessCode,
    });
    print(data, getFormat(cmd));
  });

teamsCmd
  .command('delete <teamId>')
  .description('Delete team')
  .action(async (teamId: string, _opts, cmd) => {
    print(await getClient().teams.delete(teamId), getFormat(cmd));
  });

teamsCmd
  .command('join')
  .description('Join team by access code')
  .requiredOption('--access-code <code>', 'Team access code')
  .action(async (opts, cmd) => {
    print(await getClient().teams.join({ accessCode: opts.accessCode }), getFormat(cmd));
  });

const teamUsersCmd = teamsCmd.command('users').description('Team user management');

teamUsersCmd
  .command('list <teamId>')
  .description('List team users')
  .option('--search <text>', 'Search text')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size')
  .action(async (teamId: string, opts, cmd) => {
    const data = await getClient().teams.listUsers(teamId, {
      search: opts.search,
      page: Number(opts.page),
      pageSize: opts.pageSize ? Number(opts.pageSize) : undefined,
    });
    print(data, getFormat(cmd));
  });

teamUsersCmd
  .command('add <teamId>')
  .description('Add user to team')
  .requiredOption('--user-id <id>', 'User ID')
  .requiredOption('--role <role>', 'Team role')
  .action(async (teamId: string, opts, cmd) => {
    const data = await getClient().teams.addUser(teamId, {
      userId: opts.userId,
      role: opts.role as TeamRole,
    });
    print(data, getFormat(cmd));
  });

teamUsersCmd
  .command('get <teamId> <userId>')
  .description('Get team user')
  .action(async (teamId: string, userId: string, _opts, cmd) => {
    print(await getClient().teams.getUser(teamId, userId), getFormat(cmd));
  });

teamUsersCmd
  .command('update <teamId> <userId>')
  .description('Update team user role')
  .requiredOption('--role <role>', 'Team role')
  .action(async (teamId: string, userId: string, opts, cmd) => {
    const data = await getClient().teams.updateUser(teamId, userId, {
      role: opts.role as TeamRole,
    });
    print(data, getFormat(cmd));
  });

teamUsersCmd
  .command('remove <teamId> <userId>')
  .description('Remove user from team')
  .action(async (teamId: string, userId: string, _opts, cmd) => {
    print(await getClient().teams.removeUser(teamId, userId), getFormat(cmd));
  });

teamsCmd
  .command('websites <teamId>')
  .description('List team websites')
  .option('--search <text>', 'Search text')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size')
  .action(async (teamId: string, opts, cmd) => {
    const data = await getClient().teamWebsites.list(teamId, {
      search: opts.search,
      page: Number(opts.page),
      pageSize: opts.pageSize ? Number(opts.pageSize) : undefined,
    });
    print(data, getFormat(cmd));
  });

program.parse();
