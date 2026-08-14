#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Amplitude } from '../api';
import {
  getApiKey,
  setApiKey,
  getSecretKey,
  setSecretKey,
  clearConfig,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  setProfileOverride,
  getConfigDir,
} from '../utils/config';

const program = new Command();

// Helper to get authenticated client
function getClient(): Amplitude {
  const apiKey = getApiKey();
  const secretKey = getSecretKey();
  if (!apiKey || !secretKey) {
    console.error(chalk.red('Error: Not authenticated. Run "connect-amplitude auth set-key" and "connect-amplitude auth set-secret" first.'));
    process.exit(1);
  }
  return new Amplitude({ apiKey, secretKey });
}

program
  .name('connect-amplitude')
  .description('Amplitude connector - Analytics data, events, users, and cohorts')
  .version('0.0.1')
  .option('--profile <name>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

// ============================================
// Auth Commands
// ============================================

const authCmd = program.command('auth').description('Authentication management');

authCmd
  .command('set-key')
  .description('Set API key for the current profile')
  .argument('<key>', 'Amplitude API key')
  .action((key: string) => {
    setApiKey(key);
    console.log(chalk.green(`API key saved to profile "${getCurrentProfile()}"`));
  });

authCmd
  .command('set-secret')
  .description('Set secret key for the current profile')
  .argument('<secret>', 'Amplitude secret key')
  .action((secret: string) => {
    setSecretKey(secret);
    console.log(chalk.green(`Secret key saved to profile "${getCurrentProfile()}"`));
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(() => {
    const apiKey = getApiKey();
    const secretKey = getSecretKey();

    if (!apiKey || !secretKey) {
      console.log(chalk.yellow('Not authenticated'));
      if (!apiKey) console.log(chalk.gray('  API key: not set'));
      if (!secretKey) console.log(chalk.gray('  Secret key: not set'));
      console.log(chalk.gray('\nRun "connect-amplitude auth set-key <key>" and "connect-amplitude auth set-secret <secret>" to authenticate'));
      return;
    }

    console.log(chalk.green('Authenticated'));
    console.log(`  Profile: ${chalk.cyan(getCurrentProfile())}`);
    console.log(`  API Key: ${chalk.white(apiKey.substring(0, 8) + '...')}`);
    console.log(`  Secret Key: ${chalk.white(secretKey.substring(0, 8) + '...')}`);
  });

authCmd
  .command('clear')
  .description('Clear stored credentials')
  .action(() => {
    clearConfig();
    console.log(chalk.green('Credentials cleared'));
  });

// ============================================
// Profile Commands
// ============================================

const profileCmd = program.command('profile').description('Profile management');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      console.log(chalk.gray('No profiles configured'));
      return;
    }

    console.log(chalk.bold('Profiles:'));
    for (const profile of profiles) {
      const marker = profile === current ? chalk.green(' (active)') : '';
      console.log(`  ${profile}${marker}`);
    }
  });

profileCmd
  .command('use')
  .description('Switch to a profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      console.log(chalk.green(`Switched to profile "${name}"`));
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

profileCmd
  .command('create')
  .description('Create a new profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    try {
      if (createProfile(name)) {
        console.log(chalk.green(`Profile "${name}" created`));
      } else {
        console.log(chalk.yellow(`Profile "${name}" already exists`));
      }
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

profileCmd
  .command('delete')
  .description('Delete a profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    if (deleteProfile(name)) {
      console.log(chalk.green(`Profile "${name}" deleted`));
    } else {
      console.log(chalk.yellow(`Cannot delete profile "${name}" (doesn't exist or is default)`));
    }
  });

profileCmd
  .command('show')
  .description('Show current profile')
  .action(() => {
    console.log(`Current profile: ${chalk.cyan(getCurrentProfile())}`);
    console.log(`Config directory: ${chalk.gray(getConfigDir())}`);
  });

// ============================================
// Events Commands
// ============================================

const eventsCmd = program.command('events').description('Event operations');

eventsCmd
  .command('track')
  .description('Track a single event')
  .requiredOption('-t, --type <type>', 'Event type')
  .option('-u, --user <userId>', 'User ID')
  .option('-d, --device <deviceId>', 'Device ID')
  .option('-p, --properties <json>', 'Event properties as JSON')
  .action(async (options) => {
    try {
      if (!options.user && !options.device) {
        console.error(chalk.red('Error: Either --user or --device is required'));
        process.exit(1);
      }

      const client = getClient();
      const event: Record<string, unknown> = {
        event_type: options.type,
      };

      if (options.user) event.user_id = options.user;
      if (options.device) event.device_id = options.device;
      if (options.properties) {
        try {
          event.event_properties = JSON.parse(options.properties);
        } catch {
          console.error(chalk.red('Error: Invalid JSON for properties'));
          process.exit(1);
        }
      }

      const result = await client.trackEvent(event as import('../types').Event);
      console.log(chalk.green('Event tracked successfully'));
      console.log(`  Code: ${result.code}`);
      if (result.events_ingested) {
        console.log(`  Events ingested: ${result.events_ingested}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Users Commands
// ============================================

const usersCmd = program.command('users').description('User operations');

usersCmd
  .command('search')
  .description('Search for users')
  .argument('<query>', 'User ID or partial match')
  .action(async (query: string) => {
    try {
      const client = getClient();
      const result = await client.searchUsers(query);

      if (result.matches.length === 0) {
        console.log(chalk.gray('No users found'));
        return;
      }

      console.log(chalk.bold(`Found ${result.matches.length} user(s):`));
      for (const match of result.matches) {
        console.log(`\n  ${chalk.white(match.user_id || `Amplitude ID: ${match.amplitude_id}`)}`);
        console.log(`    Amplitude ID: ${chalk.gray(String(match.amplitude_id))}`);
        if (match.platform) console.log(`    Platform: ${match.platform}`);
        if (match.country) console.log(`    Country: ${match.country}`);
        if (match.last_used) console.log(`    Last used: ${match.last_used}`);
        if (match.number_of_events) console.log(`    Events: ${match.number_of_events}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

usersCmd
  .command('activity')
  .description('Get user activity')
  .option('-u, --user <userId>', 'User ID')
  .option('-a, --amplitude-id <id>', 'Amplitude ID')
  .option('-l, --limit <n>', 'Maximum events to return', '20')
  .action(async (options) => {
    try {
      if (!options.user && !options.amplitudeId) {
        console.error(chalk.red('Error: Either --user or --amplitude-id is required'));
        process.exit(1);
      }

      const client = getClient();
      const result = await client.getUserActivity({
        user: options.user,
        amplitude_id: options.amplitudeId ? parseInt(options.amplitudeId) : undefined,
        limit: parseInt(options.limit),
      });

      if (result.userData) {
        console.log(chalk.bold('User Data:'));
        console.log(`  User ID: ${result.userData.user_id || chalk.gray('N/A')}`);
        console.log(`  Sessions: ${result.userData.num_sessions || 0}`);
        console.log(`  Events: ${result.userData.num_events || 0}`);
        console.log(`  Revenue: $${result.userData.revenue || 0}`);
        if (result.userData.first_used) console.log(`  First used: ${result.userData.first_used}`);
        if (result.userData.last_used) console.log(`  Last used: ${result.userData.last_used}`);
      }

      if (result.events.length > 0) {
        console.log(chalk.bold(`\nRecent Events (${result.events.length}):`));
        for (const event of result.events.slice(0, 10)) {
          console.log(`\n  ${chalk.cyan(event.event_type || 'Unknown')}`);
          if (event.event_time) console.log(`    Time: ${event.event_time}`);
          if (event.platform) console.log(`    Platform: ${event.platform}`);
          if (event.country) console.log(`    Country: ${event.country}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Cohorts Commands
// ============================================

const cohortsCmd = program.command('cohorts').description('Cohort operations');

cohortsCmd
  .command('list')
  .description('List all cohorts')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listCohorts();

      if (result.cohorts.length === 0) {
        console.log(chalk.gray('No cohorts found'));
        return;
      }

      console.log(chalk.bold(`Cohorts (${result.cohorts.length}):`));
      for (const cohort of result.cohorts) {
        console.log(`\n  ${chalk.white(cohort.name)}`);
        console.log(`    ID: ${chalk.gray(cohort.id)}`);
        if (cohort.description) console.log(`    Description: ${cohort.description}`);
        if (cohort.size !== undefined) console.log(`    Size: ${cohort.size} users`);
        console.log(`    Archived: ${cohort.archived ? 'Yes' : 'No'}`);
        if (cohort.last_computed) console.log(`    Last computed: ${cohort.last_computed}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

cohortsCmd
  .command('get')
  .description('Get cohort details')
  .argument('<cohortId>', 'Cohort ID')
  .action(async (cohortId: string) => {
    try {
      const client = getClient();
      const cohort = await client.getCohort(cohortId);

      console.log(chalk.bold('Cohort Details:'));
      console.log(`  Name: ${cohort.name}`);
      console.log(`  ID: ${chalk.gray(cohort.id)}`);
      if (cohort.description) console.log(`  Description: ${cohort.description}`);
      if (cohort.size !== undefined) console.log(`  Size: ${cohort.size} users`);
      console.log(`  Archived: ${cohort.archived ? 'Yes' : 'No'}`);
      console.log(`  Created: ${cohort.created_at}`);
      if (cohort.last_modified) console.log(`  Last modified: ${cohort.last_modified}`);
      if (cohort.last_computed) console.log(`  Last computed: ${cohort.last_computed}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

cohortsCmd
  .command('members')
  .description('Get cohort members')
  .argument('<cohortId>', 'Cohort ID')
  .option('--props', 'Include user properties')
  .action(async (cohortId: string, options) => {
    try {
      const client = getClient();
      const result = await client.getCohortMembership(cohortId, {
        props: options.props ? 1 : undefined,
      });

      console.log(chalk.bold('Cohort Membership:'));
      console.log(`  Cohort ID: ${result.cohort_id}`);
      console.log(`  Request ID: ${chalk.gray(result.request_id)}`);

      if (result.user_ids && result.user_ids.length > 0) {
        console.log(`\n  User IDs (${result.user_ids.length}):`);
        for (const userId of result.user_ids.slice(0, 20)) {
          console.log(`    ${userId}`);
        }
        if (result.user_ids.length > 20) {
          console.log(chalk.gray(`    ... and ${result.user_ids.length - 20} more`));
        }
      }

      if (result.amplitude_ids && result.amplitude_ids.length > 0) {
        console.log(`\n  Amplitude IDs (${result.amplitude_ids.length}):`);
        for (const ampId of result.amplitude_ids.slice(0, 20)) {
          console.log(`    ${ampId}`);
        }
        if (result.amplitude_ids.length > 20) {
          console.log(chalk.gray(`    ... and ${result.amplitude_ids.length - 20} more`));
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Charts Commands
// ============================================

const chartsCmd = program.command('charts').description('Chart operations');

chartsCmd
  .command('get')
  .description('Get chart data')
  .argument('<chartId>', 'Chart ID')
  .option('-s, --start <date>', 'Start date (YYYYMMDD)')
  .option('-e, --end <date>', 'End date (YYYYMMDD)')
  .action(async (chartId: string, options) => {
    try {
      const client = getClient();
      const result = await client.getChartData(chartId, {
        start: options.start,
        end: options.end,
      });

      console.log(chalk.bold('Chart Data:'));
      if (result.data && result.data.length > 0) {
        for (const series of result.data) {
          if (series.seriesLabels) {
            console.log(`\n  Series: ${series.seriesLabels.join(', ')}`);
          }
          if (series.xValues && series.seriesValues) {
            console.log('  Values:');
            for (let i = 0; i < series.xValues.length && i < 10; i++) {
              const values = series.seriesValues.map(v => v[i] ?? '-').join(', ');
              console.log(`    ${series.xValues[i]}: ${values}`);
            }
            if (series.xValues.length > 10) {
              console.log(chalk.gray(`    ... and ${series.xValues.length - 10} more data points`));
            }
          }
        }
      } else {
        console.log(chalk.gray('  No data available'));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Taxonomy Commands
// ============================================

const taxonomyCmd = program.command('taxonomy').description('Event and property taxonomy');

taxonomyCmd
  .command('events')
  .description('List event types')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listEventTypes();

      if (result.data.length === 0) {
        console.log(chalk.gray('No event types found'));
        return;
      }

      console.log(chalk.bold(`Event Types (${result.data.length}):`));
      for (const eventType of result.data) {
        console.log(`\n  ${chalk.cyan(eventType.event_type)}`);
        if (eventType.display_name) console.log(`    Display name: ${eventType.display_name}`);
        if (eventType.description) console.log(`    Description: ${eventType.description}`);
        if (eventType.category) console.log(`    Category: ${eventType.category.name}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

taxonomyCmd
  .command('event-properties')
  .description('List properties for an event type')
  .argument('<eventType>', 'Event type name')
  .action(async (eventType: string) => {
    try {
      const client = getClient();
      const result = await client.listEventProperties(eventType);

      if (result.data.length === 0) {
        console.log(chalk.gray('No properties found for this event type'));
        return;
      }

      console.log(chalk.bold(`Properties for "${eventType}" (${result.data.length}):`));
      for (const prop of result.data) {
        console.log(`\n  ${chalk.white(prop.event_property)}`);
        if (prop.type) console.log(`    Type: ${prop.type}`);
        if (prop.description) console.log(`    Description: ${prop.description}`);
        if (prop.is_required) console.log(`    Required: Yes`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

taxonomyCmd
  .command('user-properties')
  .description('List user properties')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listUserProperties();

      if (result.data.length === 0) {
        console.log(chalk.gray('No user properties found'));
        return;
      }

      console.log(chalk.bold(`User Properties (${result.data.length}):`));
      for (const prop of result.data) {
        console.log(`\n  ${chalk.white(prop.user_property)}`);
        if (prop.type) console.log(`    Type: ${prop.type}`);
        if (prop.description) console.log(`    Description: ${prop.description}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
