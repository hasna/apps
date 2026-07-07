#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Webex } from '../api';
import type { OutputFormat } from '../types';
import {
  getAccessToken,
  setAccessToken,
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

function getFormat(cmd: Command): OutputFormat {
  const opts = cmd.optsWithGlobals();
  return (opts.format as OutputFormat) || 'pretty';
}

function getClient(): Webex {
  const token = getAccessToken();
  if (!token) {
    console.error(chalk.red('Error: No Webex access token configured.'));
    console.error(chalk.yellow('Set token with: connect-webex config set-token <token>'));
    console.error(chalk.yellow('Or set WEBEX_ACCESS_TOKEN environment variable'));
    process.exit(1);
  }
  return new Webex({ accessToken: token });
}

program
  .name('connect-webex')
  .description('Cisco Webex API CLI')
  .version('0.1.0')
  .option('-p, --profile <name>', 'Use specific profile')
  .option('-f, --format <format>', 'Output format: json, table, pretty', 'pretty')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

const configCmd = program.command('config').description('Configuration commands');

configCmd
  .command('set-token <token>')
  .description('Set access token for current profile')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const token = getAccessToken();
    heading('Current Configuration');
    print({
      profile,
      authenticated: isAuthenticated(),
      token: token ? `${token.substring(0, 10)}...` : 'Not set',
    });
  });

configCmd
  .command('clear')
  .description('Clear configuration for current profile')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

const profileCmd = program.command('profile').description('Profile management');

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
    if (!createProfile(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    success(`Created profile "${name}"`);
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (!deleteProfile(name)) {
      error(`Could not delete profile "${name}"`);
      process.exit(1);
    }
    success(`Deleted profile "${name}"`);
  });

program
  .command('test')
  .description('Test authentication (GET /people/me)')
  .action(async function (this: Command) {
    try {
      const client = getClient();
      const result = await client.test();
      print(result, getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const roomsCmd = program.command('rooms').description('Room commands');

roomsCmd
  .command('list')
  .description('List rooms')
  .option('--type <type>', 'direct or group')
  .option('--max <n>', 'Maximum results', parseInt)
  .action(async function (this: Command, opts: { type?: string; max?: number }) {
    try {
      const client = getClient();
      const rooms = await client.rooms.list({
        type: opts.type as 'direct' | 'group' | undefined,
        max: opts.max,
      });
      print(rooms, getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

roomsCmd
  .command('get <roomId>')
  .description('Get room details')
  .action(async function (this: Command, roomId: string) {
    try {
      const client = getClient();
      print(await client.rooms.get(roomId), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

roomsCmd
  .command('create <title>')
  .description('Create a room')
  .option('--team-id <id>', 'Team ID')
  .option('--description <text>', 'Room description')
  .action(async function (this: Command, title: string, opts: { teamId?: string; description?: string }) {
    try {
      const client = getClient();
      print(await client.rooms.create({
        title,
        teamId: opts.teamId,
        description: opts.description,
      }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

roomsCmd
  .command('update <roomId>')
  .description('Update a room')
  .option('--title <title>', 'New title')
  .option('--description <text>', 'New description')
  .action(async function (this: Command, roomId: string, opts: { title?: string; description?: string }) {
    try {
      const client = getClient();
      print(await client.rooms.update(roomId, {
        title: opts.title,
        description: opts.description,
      }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

roomsCmd
  .command('delete <roomId>')
  .description('Delete a room')
  .action(async (roomId: string) => {
    try {
      const client = getClient();
      await client.rooms.delete(roomId);
      success(`Deleted room ${roomId}`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const membershipsCmd = program.command('memberships').description('Membership commands');

membershipsCmd
  .command('list')
  .description('List memberships')
  .option('--room-id <id>', 'Filter by room ID')
  .option('--person-email <email>', 'Filter by person email')
  .action(async function (this: Command, opts: { roomId?: string; personEmail?: string }) {
    try {
      const client = getClient();
      print(await client.memberships.list({
        roomId: opts.roomId,
        personEmail: opts.personEmail,
      }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

membershipsCmd
  .command('get <membershipId>')
  .description('Get membership details')
  .action(async function (this: Command, membershipId: string) {
    try {
      const client = getClient();
      print(await client.memberships.get(membershipId), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

membershipsCmd
  .command('create')
  .description('Create a membership')
  .requiredOption('--room-id <id>', 'Room ID')
  .option('--person-email <email>', 'Person email')
  .option('--person-id <id>', 'Person ID')
  .action(async function (this: Command, opts: { roomId: string; personEmail?: string; personId?: string }) {
    try {
      const client = getClient();
      print(await client.memberships.create({
        roomId: opts.roomId,
        personEmail: opts.personEmail,
        personId: opts.personId,
      }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

membershipsCmd
  .command('delete <membershipId>')
  .description('Delete a membership')
  .action(async (membershipId: string) => {
    try {
      const client = getClient();
      await client.memberships.delete(membershipId);
      success(`Deleted membership ${membershipId}`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const messagesCmd = program.command('messages').description('Message commands');

messagesCmd
  .command('list')
  .description('List messages in a room')
  .requiredOption('--room-id <id>', 'Room ID')
  .option('--max <n>', 'Maximum results', parseInt)
  .action(async function (this: Command, opts: { roomId: string; max?: number }) {
    try {
      const client = getClient();
      print(await client.messages.list({ roomId: opts.roomId, max: opts.max }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('get <messageId>')
  .description('Get message details')
  .action(async function (this: Command, messageId: string) {
    try {
      const client = getClient();
      print(await client.messages.get(messageId), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('send')
  .description('Send a message')
  .requiredOption('--room-id <id>', 'Room ID')
  .requiredOption('--text <text>', 'Message text')
  .action(async function (this: Command, opts: { roomId: string; text: string }) {
    try {
      const client = getClient();
      print(await client.messages.create({ roomId: opts.roomId, text: opts.text }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('delete <messageId>')
  .description('Delete a message')
  .action(async (messageId: string) => {
    try {
      const client = getClient();
      await client.messages.delete(messageId);
      success(`Deleted message ${messageId}`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const peopleCmd = program.command('people').description('People commands');

peopleCmd
  .command('me')
  .description('Get authenticated user')
  .action(async function (this: Command) {
    try {
      const client = getClient();
      print(await client.people.me(), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

peopleCmd
  .command('list')
  .description('List people')
  .option('--email <email>', 'Filter by email')
  .option('--display-name <name>', 'Filter by display name')
  .action(async function (this: Command, opts: { email?: string; displayName?: string }) {
    try {
      const client = getClient();
      print(await client.people.list({
        email: opts.email,
        displayName: opts.displayName,
      }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

peopleCmd
  .command('get <personId>')
  .description('Get person details')
  .action(async function (this: Command, personId: string) {
    try {
      const client = getClient();
      print(await client.people.get(personId), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const teamsCmd = program.command('teams').description('Team commands');

teamsCmd
  .command('list')
  .description('List teams')
  .action(async function (this: Command) {
    try {
      const client = getClient();
      print(await client.teams.list(), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

teamsCmd
  .command('get <teamId>')
  .description('Get team details')
  .action(async function (this: Command, teamId: string) {
    try {
      const client = getClient();
      print(await client.teams.get(teamId), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

teamsCmd
  .command('create <name>')
  .description('Create a team')
  .action(async function (this: Command, name: string) {
    try {
      const client = getClient();
      print(await client.teams.create({ name }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

teamsCmd
  .command('delete <teamId>')
  .description('Delete a team')
  .action(async (teamId: string) => {
    try {
      const client = getClient();
      await client.teams.delete(teamId);
      success(`Deleted team ${teamId}`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const meetingsCmd = program.command('meetings').description('Meeting commands');

meetingsCmd
  .command('list')
  .description('List meetings')
  .option('--from <date>', 'Start date (ISO 8601)')
  .option('--to <date>', 'End date (ISO 8601)')
  .option('--host-email <email>', 'Filter by host email')
  .action(async function (this: Command, opts: { from?: string; to?: string; hostEmail?: string }) {
    try {
      const client = getClient();
      print(await client.meetings.list({
        from: opts.from,
        to: opts.to,
        hostEmail: opts.hostEmail,
      }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

meetingsCmd
  .command('get <meetingId>')
  .description('Get meeting details')
  .action(async function (this: Command, meetingId: string) {
    try {
      const client = getClient();
      print(await client.meetings.get(meetingId), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

meetingsCmd
  .command('create <title>')
  .description('Create a meeting')
  .requiredOption('--start <datetime>', 'Start time (ISO 8601)')
  .requiredOption('--end <datetime>', 'End time (ISO 8601)')
  .option('--agenda <text>', 'Meeting agenda')
  .action(async function (this: Command, title: string, opts: { start: string; end: string; agenda?: string }) {
    try {
      const client = getClient();
      print(await client.meetings.create({
        title,
        start: opts.start,
        end: opts.end,
        agenda: opts.agenda,
      }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

meetingsCmd
  .command('delete <meetingId>')
  .description('Delete a meeting')
  .action(async (meetingId: string) => {
    try {
      const client = getClient();
      await client.meetings.delete(meetingId);
      success(`Deleted meeting ${meetingId}`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const recordingsCmd = program.command('recordings').description('Recording commands');

recordingsCmd
  .command('list')
  .description('List recordings')
  .option('--from <date>', 'Start date (ISO 8601)')
  .option('--to <date>', 'End date (ISO 8601)')
  .option('--host-email <email>', 'Filter by host email')
  .action(async function (this: Command, opts: { from?: string; to?: string; hostEmail?: string }) {
    try {
      const client = getClient();
      print(await client.recordings.list({
        from: opts.from,
        to: opts.to,
        hostEmail: opts.hostEmail,
      }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

recordingsCmd
  .command('get <recordingId>')
  .description('Get recording details')
  .action(async function (this: Command, recordingId: string) {
    try {
      const client = getClient();
      print(await client.recordings.get(recordingId), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

recordingsCmd
  .command('delete <recordingId>')
  .description('Delete a recording')
  .action(async (recordingId: string) => {
    try {
      const client = getClient();
      await client.recordings.delete(recordingId);
      success(`Deleted recording ${recordingId}`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const webhooksCmd = program.command('webhooks').description('Webhook commands');

webhooksCmd
  .command('list')
  .description('List webhooks')
  .action(async function (this: Command) {
    try {
      const client = getClient();
      print(await client.webhooks.list(), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('get <webhookId>')
  .description('Get webhook details')
  .action(async function (this: Command, webhookId: string) {
    try {
      const client = getClient();
      print(await client.webhooks.get(webhookId), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('create <name>')
  .description('Create a webhook')
  .requiredOption('--target-url <url>', 'Target URL')
  .requiredOption('--resource <resource>', 'Resource (e.g. messages, rooms)')
  .requiredOption('--event <event>', 'Event (e.g. created, updated)')
  .action(async function (this: Command, name: string, opts: { targetUrl: string; resource: string; event: string }) {
    try {
      const client = getClient();
      print(await client.webhooks.create({
        name,
        targetUrl: opts.targetUrl,
        resource: opts.resource,
        event: opts.event,
      }), getFormat(this));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

webhooksCmd
  .command('delete <webhookId>')
  .description('Delete a webhook')
  .action(async (webhookId: string) => {
    try {
      const client = getClient();
      await client.webhooks.delete(webhookId);
      success(`Deleted webhook ${webhookId}`);
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
