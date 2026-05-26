#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { Mixpanel } from '../api';
import {
  getProjectToken,
  getApiSecret,
  getProjectId,
  getRegion,
  setProjectToken,
  setApiSecret,
  setProjectId,
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
  saveProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-mixpanel';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Mixpanel connector CLI - Track events, manage profiles, export data, and query analytics')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client for tracking
function getTrackingClient(): Mixpanel {
  const projectToken = getProjectToken();
  const region = getRegion();

  if (!projectToken) {
    error(`No project token configured. Run "${CONNECTOR_NAME} config set --token <token>" or set MIXPANEL_PROJECT_TOKEN.`);
    process.exit(1);
  }

  return new Mixpanel({ projectToken, region });
}

// Helper to get authenticated client for data/export APIs
function getDataClient(): Mixpanel {
  const projectToken = getProjectToken();
  const apiSecret = getApiSecret();
  const projectId = getProjectId();
  const region = getRegion();

  if (!apiSecret) {
    error(`No API secret configured. Run "${CONNECTOR_NAME} config set --secret <secret>" or set MIXPANEL_API_SECRET.`);
    process.exit(1);
  }

  return new Mixpanel({ projectToken, apiSecret, projectId, region });
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
  .option('--token <token>', 'Mixpanel project token')
  .option('--secret <secret>', 'Mixpanel API secret')
  .option('--project-id <id>', 'Mixpanel project ID')
  .option('--region <region>', 'Data residency region (US, EU, or IN)')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    let region: 'US' | 'EU' | 'IN' | undefined;
    if (opts.region) {
      const r = opts.region.toUpperCase();
      region = r === 'EU' ? 'EU' : r === 'IN' ? 'IN' : 'US';
    }

    createProfile(name, {
      projectToken: opts.token,
      apiSecret: opts.secret,
      projectId: opts.projectId,
      region,
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
    info(`Project Token: ${config.projectToken ? `${config.projectToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Secret: ${config.apiSecret ? '********' : chalk.gray('not set')}`);
    info(`Project ID: ${config.projectId || chalk.gray('not set')}`);
    info(`Region: ${config.region || chalk.gray('US (default)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set')
  .description('Set Mixpanel credentials')
  .option('--token <token>', 'Mixpanel project token')
  .option('--secret <secret>', 'Mixpanel API secret')
  .option('--project-id <id>', 'Mixpanel project ID')
  .option('--region <region>', 'Data residency region (US, EU, or IN)')
  .action((opts) => {
    if (opts.token) {
      setProjectToken(opts.token);
      info('Project token saved');
    }
    if (opts.secret) {
      setApiSecret(opts.secret);
      info('API secret saved');
    }
    if (opts.projectId) {
      setProjectId(opts.projectId);
      info('Project ID saved');
    }
    if (opts.region) {
      const r = opts.region.toUpperCase();
      const region: 'US' | 'EU' | 'IN' = r === 'EU' ? 'EU' : r === 'IN' ? 'IN' : 'US';
      setRegion(region);
      info(`Region set to: ${region}`);
    }
    success(`Configuration saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const projectToken = getProjectToken();
    const projectId = getProjectId();
    const region = getRegion();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Project Token: ${projectToken ? `${projectToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Secret: ${getApiSecret() ? '********' : chalk.gray('not set')}`);
    info(`Project ID: ${projectId || chalk.gray('not set')}`);
    info(`Region: ${region}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Track Commands
// ============================================
const trackCmd = program
  .command('track <event>')
  .description('Track an event')
  .option('-d, --distinct-id <id>', 'User distinct ID')
  .option('--properties <json>', 'Event properties as JSON')
  .action(async (event: string, opts: { distinctId?: string; properties?: string }) => {
    try {
      const client = getTrackingClient();

      const properties: Record<string, unknown> = {};
      if (opts.distinctId) {
        properties.distinct_id = opts.distinctId;
      }
      if (opts.properties) {
        Object.assign(properties, JSON.parse(opts.properties));
      }

      const result = await client.track.track(event, properties);

      if (result.status === 1) {
        success(`Event "${event}" tracked successfully`);
      } else {
        error(`Failed to track event: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Profile (Engage) Commands
// ============================================
const engageCmd = program
  .command('engage')
  .description('Manage user profiles (Engage API)');

engageCmd
  .command('get <distinctId>')
  .description('Get a user profile')
  .action(async (distinctId: string) => {
    try {
      const client = getDataClient();
      const result = await client.engage.get(distinctId);

      if (result) {
        print(result, getFormat(engageCmd));
      } else {
        warn(`Profile not found for distinct_id: ${distinctId}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

engageCmd
  .command('set <distinctId>')
  .description('Set user profile properties')
  .requiredOption('--properties <json>', 'Properties to set as JSON')
  .action(async (distinctId: string, opts: { properties: string }) => {
    try {
      const client = getTrackingClient();
      const properties = JSON.parse(opts.properties);
      const result = await client.engage.set(distinctId, properties);

      if (result.status === 1) {
        success(`Profile updated for: ${distinctId}`);
      } else {
        error(`Failed to update profile: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

engageCmd
  .command('set-once <distinctId>')
  .description('Set user profile properties only if they do not exist')
  .requiredOption('--properties <json>', 'Properties to set as JSON')
  .action(async (distinctId: string, opts: { properties: string }) => {
    try {
      const client = getTrackingClient();
      const properties = JSON.parse(opts.properties);
      const result = await client.engage.setOnce(distinctId, properties);

      if (result.status === 1) {
        success(`Profile updated for: ${distinctId}`);
      } else {
        error(`Failed to update profile: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

engageCmd
  .command('add <distinctId>')
  .description('Add numeric values to user profile properties')
  .requiredOption('--properties <json>', 'Properties to add (numeric values) as JSON')
  .action(async (distinctId: string, opts: { properties: string }) => {
    try {
      const client = getTrackingClient();
      const properties = JSON.parse(opts.properties);
      const result = await client.engage.add(distinctId, properties);

      if (result.status === 1) {
        success(`Profile updated for: ${distinctId}`);
      } else {
        error(`Failed to update profile: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

engageCmd
  .command('unset <distinctId>')
  .description('Remove properties from user profile')
  .requiredOption('--properties <names>', 'Comma-separated property names to remove')
  .action(async (distinctId: string, opts: { properties: string }) => {
    try {
      const client = getTrackingClient();
      const propertyNames = opts.properties.split(',').map(p => p.trim());
      const result = await client.engage.unset(distinctId, propertyNames);

      if (result.status === 1) {
        success(`Properties removed from profile: ${distinctId}`);
      } else {
        error(`Failed to update profile: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

engageCmd
  .command('delete <distinctId>')
  .description('Delete a user profile')
  .action(async (distinctId: string) => {
    try {
      const client = getTrackingClient();
      const result = await client.engage.delete(distinctId);

      if (result.status === 1) {
        success(`Profile deleted: ${distinctId}`);
      } else {
        error(`Failed to delete profile: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

engageCmd
  .command('query')
  .description('Query user profiles')
  .option('-w, --where <expression>', 'Filter expression')
  .option('--page <number>', 'Page number', '0')
  .option('--properties <names>', 'Comma-separated property names to include')
  .action(async (opts: { where?: string; page: string; properties?: string }) => {
    try {
      const client = getDataClient();
      const outputProperties = opts.properties ? opts.properties.split(',').map(p => p.trim()) : undefined;

      const result = await client.engage.query({
        where: opts.where,
        page: parseInt(opts.page),
        output_properties: outputProperties,
      });

      print(result.results, getFormat(engageCmd));
      info(`Page: ${result.page}, Results: ${result.results.length}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Export Commands
// ============================================
const exportCmd = program
  .command('export')
  .description('Export raw event data');

exportCmd
  .command('events')
  .description('Export events')
  .requiredOption('--from <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--to <date>', 'End date (YYYY-MM-DD)')
  .option('-e, --event <events>', 'Comma-separated event names to filter')
  .option('-w, --where <expression>', 'Filter expression')
  .option('-o, --output <file>', 'Output file (NDJSON format)')
  .action(async (opts: { from: string; to: string; event?: string; where?: string; output?: string }) => {
    try {
      const client = getDataClient();
      const eventNames = opts.event ? opts.event.split(',').map(e => e.trim()) : undefined;

      if (opts.output) {
        // Export to file as NDJSON
        const rawData = await client.export.exportRaw(opts.from, opts.to, {
          event: eventNames,
          where: opts.where,
        });
        writeFileSync(opts.output, rawData);
        success(`Exported to: ${opts.output}`);
      } else {
        // Export to stdout
        const events = await client.export.export(opts.from, opts.to, {
          event: eventNames,
          where: opts.where,
        });
        print(events, getFormat(exportCmd));
        info(`Total events: ${events.length}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Insights Commands
// ============================================
const insightsCmd = program
  .command('insights')
  .description('Query analytics data');

insightsCmd
  .command('query <jql>')
  .description('Execute a JQL query')
  .option('--params <json>', 'Query parameters as JSON')
  .action(async (jql: string, opts: { params?: string }) => {
    try {
      const client = getDataClient();
      const params = opts.params ? JSON.parse(opts.params) : undefined;
      const result = await client.insights.query(jql, params);

      if (result.error) {
        error(`Query error: ${result.error}`);
        process.exit(1);
      }

      print(result.results, getFormat(insightsCmd));
      if (result.compute_time) {
        info(`Compute time: ${result.compute_time}ms`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

insightsCmd
  .command('segmentation <event>')
  .description('Get segmentation data for an event')
  .requiredOption('--from <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--to <date>', 'End date (YYYY-MM-DD)')
  .option('-t, --type <type>', 'Segmentation type (general, unique, average)', 'general')
  .option('-u, --unit <unit>', 'Time unit (minute, hour, day, week, month)', 'day')
  .option('--on <property>', 'Property to segment by')
  .option('-w, --where <expression>', 'Filter expression')
  .option('-l, --limit <number>', 'Maximum segments')
  .action(async (event: string, opts: {
    from: string;
    to: string;
    type?: string;
    unit?: string;
    on?: string;
    where?: string;
    limit?: string;
  }) => {
    try {
      const client = getDataClient();
      const result = await client.insights.segmentation(event, opts.from, opts.to, {
        type: opts.type as 'general' | 'unique' | 'average',
        unit: opts.unit as 'minute' | 'hour' | 'day' | 'week' | 'month',
        on: opts.on,
        where: opts.where,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      if (result.error) {
        error(`Query error: ${result.error}`);
        process.exit(1);
      }

      print(result.data, getFormat(insightsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

insightsCmd
  .command('events')
  .description('List event names')
  .option('-l, --limit <number>', 'Maximum events')
  .action(async (opts: { limit?: string }) => {
    try {
      const client = getDataClient();
      const result = await client.insights.getEventNames({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      print(result, getFormat(insightsCmd));
      info(`Total events: ${result.length}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Funnels Commands
// ============================================
const funnelsCmd = program
  .command('funnels')
  .description('Get funnel data');

funnelsCmd
  .command('list')
  .description('List all funnels')
  .action(async () => {
    try {
      const client = getDataClient();
      const funnels = await client.funnels.list();

      print(funnels, getFormat(funnelsCmd));
      info(`Total funnels: ${funnels.length}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

funnelsCmd
  .command('get <funnelId>')
  .description('Get funnel data')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('-u, --unit <unit>', 'Time unit (day, week, month)')
  .option('--on <property>', 'Property to segment by')
  .option('-w, --where <expression>', 'Filter expression')
  .action(async (funnelId: string, opts: {
    from?: string;
    to?: string;
    unit?: string;
    on?: string;
    where?: string;
  }) => {
    try {
      const client = getDataClient();
      const result = await client.funnels.get(parseInt(funnelId), {
        from_date: opts.from,
        to_date: opts.to,
        unit: opts.unit as 'day' | 'week' | 'month',
        on: opts.on,
        where: opts.where,
      });

      print(result, getFormat(funnelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Retention Commands
// ============================================
const retentionCmd = program
  .command('retention')
  .description('Get retention data');

retentionCmd
  .command('get')
  .description('Get retention cohort data')
  .requiredOption('--from <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--to <date>', 'End date (YYYY-MM-DD)')
  .option('-t, --type <type>', 'Retention type (birth, compounded)', 'birth')
  .option('--born-event <event>', 'Birth event (cohort definition)')
  .option('-e, --event <event>', 'Return event')
  .option('-u, --unit <unit>', 'Time unit (day, week, month)', 'day')
  .option('-w, --where <expression>', 'Filter expression')
  .action(async (opts: {
    from: string;
    to: string;
    type?: string;
    bornEvent?: string;
    event?: string;
    unit?: string;
    where?: string;
  }) => {
    try {
      const client = getDataClient();
      const result = await client.retention.get(opts.from, opts.to, {
        retention_type: opts.type as 'birth' | 'compounded',
        born_event: opts.bornEvent,
        event: opts.event,
        unit: opts.unit as 'day' | 'week' | 'month',
        where: opts.where,
      });

      print(result, getFormat(retentionCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
