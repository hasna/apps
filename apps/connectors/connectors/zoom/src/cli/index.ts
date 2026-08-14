#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Zoom } from '../api';
import {
  getAccountId,
  getClientId,
  getClientSecret,
  setAccountId,
  setClientId,
  setClientSecret,
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
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-zoom';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoom connector CLI - Meetings, Webinars, Recordings, Users with multi-profile support')
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

// Helper to get authenticated client
function getClient(): Zoom {
  const accountId = getAccountId();
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (!accountId) {
    error(`No Zoom Account ID configured. Run "${CONNECTOR_NAME} config set" or set ZOOM_ACCOUNT_ID environment variable.`);
    process.exit(1);
  }
  if (!clientId) {
    error(`No Zoom Client ID configured. Run "${CONNECTOR_NAME} config set" or set ZOOM_CLIENT_ID environment variable.`);
    process.exit(1);
  }
  if (!clientSecret) {
    error(`No Zoom Client Secret configured. Run "${CONNECTOR_NAME} config set" or set ZOOM_CLIENT_SECRET environment variable.`);
    process.exit(1);
  }

  return new Zoom({ accountId, clientId, clientSecret });
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
  .option('--account-id <id>', 'Zoom Account ID')
  .option('--client-id <id>', 'Zoom Client ID')
  .option('--client-secret <secret>', 'Zoom Client Secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accountId: opts.accountId,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
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
    info(`Account ID: ${config.accountId ? `${config.accountId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Client ID: ${config.clientId ? `${config.clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${config.clientSecret ? '********' : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set')
  .description('Set Zoom credentials')
  .requiredOption('--account-id <id>', 'Zoom Account ID')
  .requiredOption('--client-id <id>', 'Zoom Client ID')
  .requiredOption('--client-secret <secret>', 'Zoom Client Secret')
  .action((opts) => {
    setAccountId(opts.accountId);
    setClientId(opts.clientId);
    setClientSecret(opts.clientSecret);
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accountId = getAccountId();
    const clientId = getClientId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Account ID: ${accountId ? `${accountId.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Client ID: ${clientId ? `${clientId.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Me Command (shortcut)
// ============================================
program
  .command('me')
  .description('Get current user info')
  .action(async () => {
    try {
      const client = getClient();
      const user = await client.users.getMe();
      print(user, getFormat(program));
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
  .description('User operations');

usersCmd
  .command('list')
  .description('List users in the account')
  .option('-n, --max <number>', 'Maximum results per page', '30')
  .option('-s, --status <status>', 'Filter by status (active, inactive, pending)')
  .option('--next-page-token <token>', 'Pagination token')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.users.listUsers({
        status: opts.status,
        pageSize: parseInt(opts.max),
        nextPageToken: opts.nextPageToken,
      });

      const users = result.users.map(u => ({
        id: u.id,
        email: u.email,
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
        type: u.type === 1 ? 'Basic' : u.type === 2 ? 'Licensed' : 'On-prem',
        status: u.status,
      }));

      print(users, getFormat(usersCmd));

      if (result.next_page_token) {
        info(`More results available. Use --next-page-token ${result.next_page_token}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('get <userId>')
  .description('Get user details')
  .action(async (userId: string) => {
    try {
      const client = getClient();
      const user = await client.users.getUser(userId);
      print(user, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Meetings Commands
// ============================================
const meetingsCmd = program
  .command('meetings')
  .description('Meeting operations');

meetingsCmd
  .command('list [userId]')
  .description('List meetings for a user (default: me)')
  .option('-t, --type <type>', 'Meeting type (scheduled, live, upcoming, upcoming_meetings, previous_meetings)')
  .option('-n, --max <number>', 'Maximum results per page', '30')
  .option('--next-page-token <token>', 'Pagination token')
  .action(async (userId: string | undefined, opts) => {
    try {
      const client = getClient();
      const result = await client.meetings.listMeetings(userId || 'me', {
        type: opts.type,
        pageSize: parseInt(opts.max),
        nextPageToken: opts.nextPageToken,
      });

      const meetings = result.meetings.map(m => ({
        id: m.id,
        topic: m.topic,
        start_time: m.start_time,
        duration: m.duration,
        type: m.type === 1 ? 'Instant' : m.type === 2 ? 'Scheduled' : 'Recurring',
        join_url: m.join_url,
      }));

      print(meetings, getFormat(meetingsCmd));

      if (result.next_page_token) {
        info(`More results available. Use --next-page-token ${result.next_page_token}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

meetingsCmd
  .command('get <meetingId>')
  .description('Get meeting details')
  .action(async (meetingId: string) => {
    try {
      const client = getClient();
      const meeting = await client.meetings.getMeeting(meetingId);
      print(meeting, getFormat(meetingsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

meetingsCmd
  .command('create <topic>')
  .description('Create a new meeting')
  .option('-s, --start <datetime>', 'Start time (ISO 8601 format)')
  .option('-d, --duration <minutes>', 'Duration in minutes', '60')
  .option('-z, --timezone <tz>', 'Timezone')
  .option('--password <password>', 'Meeting password')
  .option('--agenda <agenda>', 'Meeting agenda')
  .option('--user <userId>', 'User to create meeting for (default: me)')
  .option('--waiting-room', 'Enable waiting room')
  .option('--join-before-host', 'Allow join before host')
  .option('--mute-upon-entry', 'Mute participants on entry')
  .option('--auto-recording <type>', 'Auto recording (local, cloud, none)')
  .action(async (topic: string, opts) => {
    try {
      const client = getClient();

      const meeting = await client.meetings.createMeeting(opts.user || 'me', {
        topic,
        start_time: opts.start,
        duration: parseInt(opts.duration),
        timezone: opts.timezone,
        password: opts.password,
        agenda: opts.agenda,
        settings: {
          waiting_room: opts.waitingRoom,
          join_before_host: opts.joinBeforeHost,
          mute_upon_entry: opts.muteUponEntry,
          auto_recording: opts.autoRecording,
        },
      });

      success(`Meeting created: ${meeting.topic}`);
      info(`Meeting ID: ${meeting.id}`);
      info(`Join URL: ${meeting.join_url}`);
      if (meeting.password) {
        info(`Password: ${meeting.password}`);
      }

      print(meeting, getFormat(meetingsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

meetingsCmd
  .command('update <meetingId>')
  .description('Update a meeting')
  .option('-t, --topic <topic>', 'Meeting topic')
  .option('-s, --start <datetime>', 'Start time (ISO 8601 format)')
  .option('-d, --duration <minutes>', 'Duration in minutes')
  .option('-z, --timezone <tz>', 'Timezone')
  .option('--password <password>', 'Meeting password')
  .option('--agenda <agenda>', 'Meeting agenda')
  .action(async (meetingId: string, opts) => {
    try {
      const client = getClient();
      await client.meetings.updateMeeting(meetingId, {
        topic: opts.topic,
        start_time: opts.start,
        duration: opts.duration ? parseInt(opts.duration) : undefined,
        timezone: opts.timezone,
        password: opts.password,
        agenda: opts.agenda,
      });
      success(`Meeting ${meetingId} updated`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

meetingsCmd
  .command('delete <meetingId>')
  .description('Delete a meeting')
  .action(async (meetingId: string) => {
    try {
      const client = getClient();
      await client.meetings.deleteMeeting(meetingId);
      success(`Meeting ${meetingId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

meetingsCmd
  .command('end <meetingId>')
  .description('End a live meeting')
  .action(async (meetingId: string) => {
    try {
      const client = getClient();
      await client.meetings.endMeeting(meetingId);
      success(`Meeting ${meetingId} ended`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Webinars Commands
// ============================================
const webinarsCmd = program
  .command('webinars')
  .description('Webinar operations');

webinarsCmd
  .command('list [userId]')
  .description('List webinars for a user (default: me)')
  .option('-t, --type <type>', 'Webinar type (scheduled, upcoming)')
  .option('-n, --max <number>', 'Maximum results per page', '30')
  .option('--next-page-token <token>', 'Pagination token')
  .action(async (userId: string | undefined, opts) => {
    try {
      const client = getClient();
      const result = await client.webinars.listWebinars(userId || 'me', {
        type: opts.type,
        pageSize: parseInt(opts.max),
        nextPageToken: opts.nextPageToken,
      });

      const webinars = result.webinars.map(w => ({
        id: w.id,
        topic: w.topic,
        start_time: w.start_time,
        duration: w.duration,
        join_url: w.join_url,
      }));

      print(webinars, getFormat(webinarsCmd));

      if (result.next_page_token) {
        info(`More results available. Use --next-page-token ${result.next_page_token}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webinarsCmd
  .command('get <webinarId>')
  .description('Get webinar details')
  .action(async (webinarId: string) => {
    try {
      const client = getClient();
      const webinar = await client.webinars.getWebinar(webinarId);
      print(webinar, getFormat(webinarsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webinarsCmd
  .command('create <topic>')
  .description('Create a new webinar')
  .option('-s, --start <datetime>', 'Start time (ISO 8601 format)')
  .option('-d, --duration <minutes>', 'Duration in minutes', '60')
  .option('-z, --timezone <tz>', 'Timezone')
  .option('--password <password>', 'Webinar password')
  .option('--agenda <agenda>', 'Webinar agenda')
  .option('--user <userId>', 'User to create webinar for (default: me)')
  .option('--auto-recording <type>', 'Auto recording (local, cloud, none)')
  .action(async (topic: string, opts) => {
    try {
      const client = getClient();

      const webinar = await client.webinars.createWebinar(opts.user || 'me', {
        topic,
        start_time: opts.start,
        duration: parseInt(opts.duration),
        timezone: opts.timezone,
        password: opts.password,
        agenda: opts.agenda,
        settings: {
          auto_recording: opts.autoRecording,
        },
      });

      success(`Webinar created: ${webinar.topic}`);
      info(`Webinar ID: ${webinar.id}`);
      info(`Join URL: ${webinar.join_url}`);

      print(webinar, getFormat(webinarsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webinarsCmd
  .command('delete <webinarId>')
  .description('Delete a webinar')
  .action(async (webinarId: string) => {
    try {
      const client = getClient();
      await client.webinars.deleteWebinar(webinarId);
      success(`Webinar ${webinarId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Recordings Commands
// ============================================
const recordingsCmd = program
  .command('recordings')
  .description('Cloud recording operations');

recordingsCmd
  .command('list [userId]')
  .description('List recordings for a user (default: me)')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('-n, --max <number>', 'Maximum results per page', '30')
  .option('--next-page-token <token>', 'Pagination token')
  .option('--trash', 'List recordings in trash')
  .action(async (userId: string | undefined, opts) => {
    try {
      const client = getClient();

      // Default to last 30 days if no dates provided
      const to = opts.to || new Date().toISOString().split('T')[0];
      const fromDate = opts.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const result = await client.recordings.listRecordings(userId || 'me', {
        from: fromDate,
        to,
        pageSize: parseInt(opts.max),
        nextPageToken: opts.nextPageToken,
        trash: opts.trash,
      });

      const recordings = result.meetings.map(r => ({
        id: r.id,
        uuid: r.uuid,
        topic: r.topic,
        start_time: r.start_time,
        duration: r.duration,
        recording_count: r.recording_count,
        total_size: r.total_size ? `${Math.round(r.total_size / 1024 / 1024)}MB` : undefined,
        share_url: r.share_url,
      }));

      print(recordings, getFormat(recordingsCmd));

      if (result.next_page_token) {
        info(`More results available. Use --next-page-token ${result.next_page_token}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordingsCmd
  .command('get <meetingId>')
  .description('Get recording details for a meeting')
  .action(async (meetingId: string) => {
    try {
      const client = getClient();
      const recording = await client.recordings.getRecording(meetingId);
      print(recording, getFormat(recordingsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

recordingsCmd
  .command('delete <meetingId>')
  .description('Delete recordings for a meeting')
  .option('--permanent', 'Permanently delete (skip trash)')
  .action(async (meetingId: string, opts) => {
    try {
      const client = getClient();
      await client.recordings.deleteRecording(meetingId, {
        action: opts.permanent ? 'delete' : 'trash',
      });
      success(`Recording ${meetingId} ${opts.permanent ? 'permanently deleted' : 'moved to trash'}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Reports Commands
// ============================================
const reportsCmd = program
  .command('reports')
  .description('Report operations');

reportsCmd
  .command('meetings [userId]')
  .description('Get meeting reports for a user')
  .requiredOption('--from <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--to <date>', 'End date (YYYY-MM-DD)')
  .option('-n, --max <number>', 'Maximum results per page', '30')
  .option('--next-page-token <token>', 'Pagination token')
  .action(async (userId: string | undefined, opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getMeetingReports(userId || 'me', {
        from: opts.from,
        to: opts.to,
        pageSize: parseInt(opts.max),
        nextPageToken: opts.nextPageToken,
      });

      const meetings = result.meetings.map(m => ({
        id: m.id,
        topic: m.topic,
        start_time: m.start_time,
        end_time: m.end_time,
        duration: m.duration,
        participants: m.participants,
        has_recording: m.has_recording,
      }));

      print(meetings, getFormat(reportsCmd));

      if (result.next_page_token) {
        info(`More results available. Use --next-page-token ${result.next_page_token}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('meeting <meetingId>')
  .description('Get detailed report for a meeting')
  .action(async (meetingId: string) => {
    try {
      const client = getClient();
      const report = await client.reports.getMeetingDetail(meetingId);
      print(report, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('participants <meetingId>')
  .description('Get participant report for a meeting')
  .option('-n, --max <number>', 'Maximum results per page', '30')
  .option('--next-page-token <token>', 'Pagination token')
  .action(async (meetingId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.reports.getMeetingParticipants(meetingId, {
        pageSize: parseInt(opts.max),
        nextPageToken: opts.nextPageToken,
      });

      print(result.participants, getFormat(reportsCmd));

      if (result.next_page_token) {
        info(`More results available. Use --next-page-token ${result.next_page_token}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

reportsCmd
  .command('daily')
  .description('Get daily usage report')
  .option('-y, --year <year>', 'Year', String(new Date().getFullYear()))
  .option('-m, --month <month>', 'Month (1-12)', String(new Date().getMonth() + 1))
  .action(async (opts) => {
    try {
      const client = getClient();
      const report = await client.reports.getDailyUsageReport({
        year: parseInt(opts.year),
        month: parseInt(opts.month),
      });
      print(report, getFormat(reportsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
