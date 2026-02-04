#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Google } from '../api';
import {
  getAccessToken,
  setAccessToken,
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
  ensureProfileDirs,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-google';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Google Workspace API connector CLI - Gmail, Drive, Calendar, Docs, Sheets')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
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
    // Set access token from flag if provided
    if (opts.token) {
      process.env.GOOGLE_ACCESS_TOKEN = opts.token;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Google {
  const accessToken = getAccessToken();
  if (!accessToken) {
    error(`No access token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set GOOGLE_ACCESS_TOKEN environment variable.`);
    process.exit(1);
  }
  return new Google({ accessToken });
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
  .option('--token <token>', 'Access token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
    });
    ensureProfileDirs(name);
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
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Gmail Commands
// ============================================
const gmailCmd = program
  .command('gmail')
  .description('Gmail API commands');

// Messages subcommand
const gmailMessagesCmd = gmailCmd
  .command('messages')
  .description('Gmail messages operations');

gmailMessagesCmd
  .command('list')
  .description('List messages')
  .option('-n, --max <number>', 'Maximum results', '10')
  .option('-q, --query <query>', 'Search query')
  .option('--labels <labels>', 'Label IDs (comma-separated)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.gmail.listMessages({
        maxResults: parseInt(opts.max),
        q: opts.query,
        labelIds: opts.labels?.split(','),
      });
      print(result, getFormat(gmailMessagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailMessagesCmd
  .command('get <id>')
  .description('Get a message by ID')
  .option('--format <format>', 'Message format (minimal, full, raw, metadata)', 'full')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.gmail.getMessage(id, { format: opts.format });
      print(result, getFormat(gmailMessagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailMessagesCmd
  .command('send')
  .description('Send an email')
  .requiredOption('--to <email>', 'Recipient email address')
  .requiredOption('--subject <subject>', 'Email subject')
  .requiredOption('--body <body>', 'Email body')
  .option('--cc <emails>', 'CC recipients (comma-separated)')
  .option('--bcc <emails>', 'BCC recipients (comma-separated)')
  .option('--html', 'Send as HTML email')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.gmail.sendMessage({
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
        cc: opts.cc,
        bcc: opts.bcc,
        isHtml: opts.html,
      });
      success('Email sent!');
      print(result, getFormat(gmailMessagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailMessagesCmd
  .command('delete <id>')
  .description('Delete a message permanently')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.gmail.deleteMessage(id);
      success(`Message ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailMessagesCmd
  .command('trash <id>')
  .description('Move a message to trash')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.gmail.trashMessage(id);
      success(`Message ${id} moved to trash`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailMessagesCmd
  .command('untrash <id>')
  .description('Remove a message from trash')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.gmail.untrashMessage(id);
      success(`Message ${id} removed from trash`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Labels subcommand
const gmailLabelsCmd = gmailCmd
  .command('labels')
  .description('Gmail labels operations');

gmailLabelsCmd
  .command('list')
  .description('List all labels')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.gmail.listLabels();
      print(result, getFormat(gmailLabelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailLabelsCmd
  .command('get <id>')
  .description('Get a label by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.gmail.getLabel(id);
      print(result, getFormat(gmailLabelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailLabelsCmd
  .command('create <name>')
  .description('Create a new label')
  .action(async (name: string) => {
    try {
      const client = getClient();
      const result = await client.gmail.createLabel(name);
      success('Label created!');
      print(result, getFormat(gmailLabelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailLabelsCmd
  .command('delete <id>')
  .description('Delete a label')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.gmail.deleteLabel(id);
      success(`Label ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Drafts subcommand
const gmailDraftsCmd = gmailCmd
  .command('drafts')
  .description('Gmail drafts operations');

gmailDraftsCmd
  .command('list')
  .description('List drafts')
  .option('-n, --max <number>', 'Maximum results', '10')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.gmail.listDrafts({
        maxResults: parseInt(opts.max),
      });
      print(result, getFormat(gmailDraftsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailDraftsCmd
  .command('get <id>')
  .description('Get a draft by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.gmail.getDraft(id);
      print(result, getFormat(gmailDraftsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailDraftsCmd
  .command('create')
  .description('Create a draft')
  .requiredOption('--to <email>', 'Recipient email address')
  .requiredOption('--subject <subject>', 'Email subject')
  .requiredOption('--body <body>', 'Email body')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.gmail.createDraft({
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
      });
      success('Draft created!');
      print(result, getFormat(gmailDraftsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailDraftsCmd
  .command('delete <id>')
  .description('Delete a draft')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.gmail.deleteDraft(id);
      success(`Draft ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gmailDraftsCmd
  .command('send <id>')
  .description('Send a draft')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.gmail.sendDraft(id);
      success('Draft sent!');
      print(result, getFormat(gmailDraftsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Drive Commands
// ============================================
const driveCmd = program
  .command('drive')
  .description('Google Drive API commands');

// Files subcommand
const driveFilesCmd = driveCmd
  .command('files')
  .description('Drive files operations');

driveFilesCmd
  .command('list')
  .description('List files')
  .option('-n, --max <number>', 'Maximum results', '20')
  .option('-q, --query <query>', 'Search query')
  .option('--folder <id>', 'List files in folder')
  .action(async (opts) => {
    try {
      const client = getClient();
      let result;
      if (opts.folder) {
        result = await client.drive.listFilesInFolder(opts.folder, {
          pageSize: parseInt(opts.max),
        });
      } else {
        result = await client.drive.listFiles({
          pageSize: parseInt(opts.max),
          q: opts.query,
        });
      }
      print(result, getFormat(driveFilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

driveFilesCmd
  .command('get <id>')
  .description('Get file metadata')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.drive.getFile(id);
      print(result, getFormat(driveFilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

driveFilesCmd
  .command('create')
  .description('Create a file')
  .requiredOption('--name <name>', 'File name')
  .option('--parent <id>', 'Parent folder ID')
  .option('--mime-type <type>', 'MIME type')
  .option('--content <content>', 'File content')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.drive.createFile({
        name: opts.name,
        parents: opts.parent ? [opts.parent] : undefined,
        mimeType: opts.mimeType,
        content: opts.content,
      });
      success('File created!');
      print(result, getFormat(driveFilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

driveFilesCmd
  .command('create-folder <name>')
  .description('Create a folder')
  .option('--parent <id>', 'Parent folder ID')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.drive.createFolder(name, {
        parents: opts.parent ? [opts.parent] : undefined,
      });
      success('Folder created!');
      print(result, getFormat(driveFilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

driveFilesCmd
  .command('update <id>')
  .description('Update file metadata')
  .option('--name <name>', 'New name')
  .option('--description <desc>', 'Description')
  .option('--starred', 'Star the file')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.drive.updateFile(id, {
        name: opts.name,
        description: opts.description,
        starred: opts.starred,
      });
      success('File updated!');
      print(result, getFormat(driveFilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

driveFilesCmd
  .command('delete <id>')
  .description('Delete a file permanently')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.drive.deleteFile(id);
      success(`File ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

driveFilesCmd
  .command('trash <id>')
  .description('Move a file to trash')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.drive.trashFile(id);
      success(`File ${id} moved to trash`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

driveFilesCmd
  .command('copy <id>')
  .description('Copy a file')
  .option('--name <name>', 'New name for the copy')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.drive.copyFile(id, { name: opts.name });
      success('File copied!');
      print(result, getFormat(driveFilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Permissions subcommand
const drivePermissionsCmd = driveCmd
  .command('permissions')
  .description('Drive permissions operations');

drivePermissionsCmd
  .command('list <fileId>')
  .description('List permissions for a file')
  .action(async (fileId: string) => {
    try {
      const client = getClient();
      const result = await client.drive.listPermissions(fileId);
      print(result, getFormat(drivePermissionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drivePermissionsCmd
  .command('create <fileId>')
  .description('Share a file')
  .requiredOption('--type <type>', 'Permission type (user, group, domain, anyone)')
  .requiredOption('--role <role>', 'Permission role (reader, commenter, writer, owner)')
  .option('--email <email>', 'Email address (for user/group type)')
  .option('--domain <domain>', 'Domain (for domain type)')
  .option('--notify', 'Send notification email')
  .action(async (fileId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.drive.createPermission(fileId, {
        type: opts.type,
        role: opts.role,
        emailAddress: opts.email,
        domain: opts.domain,
        sendNotificationEmail: opts.notify,
      });
      success('Permission created!');
      print(result, getFormat(drivePermissionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drivePermissionsCmd
  .command('delete <fileId> <permissionId>')
  .description('Remove a permission')
  .action(async (fileId: string, permissionId: string) => {
    try {
      const client = getClient();
      await client.drive.deletePermission(fileId, permissionId);
      success('Permission deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Calendar Commands
// ============================================
const calendarCmd = program
  .command('calendar')
  .description('Google Calendar API commands');

// Calendars subcommand
const calendarListCmd = calendarCmd
  .command('calendars')
  .description('Calendar list operations');

calendarListCmd
  .command('list')
  .description('List calendars')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.calendar.listCalendars();
      print(result, getFormat(calendarListCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarListCmd
  .command('get <id>')
  .description('Get a calendar')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.calendar.getCalendar(id);
      print(result, getFormat(calendarListCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarListCmd
  .command('create <summary>')
  .description('Create a new calendar')
  .option('--description <desc>', 'Calendar description')
  .option('--timezone <tz>', 'Time zone')
  .action(async (summary: string, opts) => {
    try {
      const client = getClient();
      const result = await client.calendar.createCalendar(summary, {
        description: opts.description,
        timeZone: opts.timezone,
      });
      success('Calendar created!');
      print(result, getFormat(calendarListCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarListCmd
  .command('delete <id>')
  .description('Delete a calendar')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.calendar.deleteCalendar(id);
      success(`Calendar ${id} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Events subcommand
const calendarEventsCmd = calendarCmd
  .command('events')
  .description('Calendar events operations');

calendarEventsCmd
  .command('list [calendarId]')
  .description('List events')
  .option('-n, --max <number>', 'Maximum results', '10')
  .option('--from <date>', 'Start date (ISO format)')
  .option('--to <date>', 'End date (ISO format)')
  .option('-q, --query <query>', 'Search query')
  .action(async (calendarId: string = 'primary', opts) => {
    try {
      const client = getClient();
      const result = await client.calendar.listEvents(calendarId, {
        maxResults: parseInt(opts.max),
        timeMin: opts.from,
        timeMax: opts.to,
        q: opts.query,
        singleEvents: true,
        orderBy: 'startTime',
      });
      print(result, getFormat(calendarEventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarEventsCmd
  .command('today [calendarId]')
  .description('List today\'s events')
  .action(async (calendarId: string = 'primary') => {
    try {
      const client = getClient();
      const result = await client.calendar.getTodayEvents(calendarId);
      print(result, getFormat(calendarEventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarEventsCmd
  .command('week [calendarId]')
  .description('List this week\'s events')
  .action(async (calendarId: string = 'primary') => {
    try {
      const client = getClient();
      const result = await client.calendar.getWeekEvents(calendarId);
      print(result, getFormat(calendarEventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarEventsCmd
  .command('get <eventId> [calendarId]')
  .description('Get an event')
  .action(async (eventId: string, calendarId: string = 'primary') => {
    try {
      const client = getClient();
      const result = await client.calendar.getEvent(calendarId, eventId);
      print(result, getFormat(calendarEventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarEventsCmd
  .command('create [calendarId]')
  .description('Create an event')
  .requiredOption('--summary <summary>', 'Event title')
  .option('--description <desc>', 'Event description')
  .option('--location <location>', 'Event location')
  .option('--start <datetime>', 'Start date/time (ISO format)')
  .option('--end <datetime>', 'End date/time (ISO format)')
  .option('--date <date>', 'All-day event date (YYYY-MM-DD)')
  .option('--attendees <emails>', 'Attendee emails (comma-separated)')
  .action(async (calendarId: string = 'primary', opts) => {
    try {
      const client = getClient();
      let result;

      if (opts.date) {
        // All-day event
        result = await client.calendar.createAllDayEvent(calendarId, opts.summary, opts.date, {
          description: opts.description,
          location: opts.location,
        });
      } else if (opts.start && opts.end) {
        // Timed event
        result = await client.calendar.createTimedEvent(
          calendarId,
          opts.summary,
          new Date(opts.start),
          new Date(opts.end),
          {
            description: opts.description,
            location: opts.location,
            attendees: opts.attendees?.split(',').map((email: string) => ({ email: email.trim() })),
          }
        );
      } else {
        error('Either --date (for all-day) or both --start and --end (for timed) are required');
        process.exit(1);
      }

      success('Event created!');
      print(result, getFormat(calendarEventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarEventsCmd
  .command('quick-add <text> [calendarId]')
  .description('Quick add an event using natural language')
  .action(async (text: string, calendarId: string = 'primary') => {
    try {
      const client = getClient();
      const result = await client.calendar.quickAddEvent(calendarId, text);
      success('Event created!');
      print(result, getFormat(calendarEventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarEventsCmd
  .command('update <eventId> [calendarId]')
  .description('Update an event')
  .option('--summary <summary>', 'Event title')
  .option('--description <desc>', 'Event description')
  .option('--location <location>', 'Event location')
  .action(async (eventId: string, calendarId: string = 'primary', opts) => {
    try {
      const client = getClient();
      const result = await client.calendar.updateEvent(calendarId, eventId, {
        summary: opts.summary,
        description: opts.description,
        location: opts.location,
      });
      success('Event updated!');
      print(result, getFormat(calendarEventsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

calendarEventsCmd
  .command('delete <eventId> [calendarId]')
  .description('Delete an event')
  .action(async (eventId: string, calendarId: string = 'primary') => {
    try {
      const client = getClient();
      await client.calendar.deleteEvent(calendarId, eventId);
      success('Event deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Docs Commands
// ============================================
const docsCmd = program
  .command('docs')
  .description('Google Docs API commands');

docsCmd
  .command('create <title>')
  .description('Create a new document')
  .action(async (title: string) => {
    try {
      const client = getClient();
      const result = await client.docs.createDocument({ title });
      success('Document created!');
      print(result, getFormat(docsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

docsCmd
  .command('get <documentId>')
  .description('Get a document')
  .action(async (documentId: string) => {
    try {
      const client = getClient();
      const result = await client.docs.getDocument(documentId);
      print(result, getFormat(docsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

docsCmd
  .command('read <documentId>')
  .description('Read document content as plain text')
  .action(async (documentId: string) => {
    try {
      const client = getClient();
      const doc = await client.docs.getDocument(documentId);
      const text = client.docs.extractPlainText(doc);
      console.log(text);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

docsCmd
  .command('append <documentId> <text>')
  .description('Append text to a document')
  .action(async (documentId: string, text: string) => {
    try {
      const client = getClient();
      await client.docs.appendText(documentId, text);
      success('Text appended to document');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

docsCmd
  .command('replace-all <documentId>')
  .description('Replace all occurrences of text')
  .requiredOption('--find <text>', 'Text to find')
  .requiredOption('--replace <text>', 'Replacement text')
  .option('--match-case', 'Case-sensitive matching')
  .action(async (documentId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.docs.replaceAllText(documentId, opts.find, opts.replace, opts.matchCase);
      success('Text replaced');
      print(result, getFormat(docsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

docsCmd
  .command('insert-image <documentId> <imageUri>')
  .description('Insert an image')
  .option('--index <index>', 'Insert position')
  .option('--width <width>', 'Image width in points')
  .option('--height <height>', 'Image height in points')
  .action(async (documentId: string, imageUri: string, opts) => {
    try {
      const client = getClient();
      await client.docs.insertImage(documentId, imageUri, {
        index: opts.index ? parseInt(opts.index) : undefined,
        width: opts.width ? parseInt(opts.width) : undefined,
        height: opts.height ? parseInt(opts.height) : undefined,
      });
      success('Image inserted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

docsCmd
  .command('insert-table <documentId>')
  .description('Insert a table')
  .requiredOption('--rows <rows>', 'Number of rows')
  .requiredOption('--cols <cols>', 'Number of columns')
  .option('--index <index>', 'Insert position')
  .action(async (documentId: string, opts) => {
    try {
      const client = getClient();
      await client.docs.insertTable(documentId, parseInt(opts.rows), parseInt(opts.cols), {
        index: opts.index ? parseInt(opts.index) : undefined,
      });
      success('Table inserted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Sheets Commands
// ============================================
const sheetsCmd = program
  .command('sheets')
  .description('Google Sheets API commands');

sheetsCmd
  .command('create <title>')
  .description('Create a new spreadsheet')
  .action(async (title: string) => {
    try {
      const client = getClient();
      const result = await client.sheets.createSpreadsheet({ title });
      success('Spreadsheet created!');
      print(result, getFormat(sheetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('get <spreadsheetId>')
  .description('Get spreadsheet metadata')
  .action(async (spreadsheetId: string) => {
    try {
      const client = getClient();
      const result = await client.sheets.getSpreadsheetMetadata(spreadsheetId);
      print(result, getFormat(sheetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('sheets <spreadsheetId>')
  .description('List sheet names in a spreadsheet')
  .action(async (spreadsheetId: string) => {
    try {
      const client = getClient();
      const names = await client.sheets.getSheetNames(spreadsheetId);
      print(names, getFormat(sheetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('read <spreadsheetId> <range>')
  .description('Read values from a range')
  .action(async (spreadsheetId: string, range: string) => {
    try {
      const client = getClient();
      const result = await client.sheets.getValues(spreadsheetId, range);
      print(result, getFormat(sheetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('write <spreadsheetId> <range>')
  .description('Write values to a range')
  .requiredOption('--values <json>', 'Values as JSON array (e.g., \'[["A", "B"], ["1", "2"]]\')')
  .action(async (spreadsheetId: string, range: string, opts) => {
    try {
      const client = getClient();
      const values = JSON.parse(opts.values);
      const result = await client.sheets.updateValues(spreadsheetId, range, values);
      success('Values written!');
      print(result, getFormat(sheetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('append <spreadsheetId> <range>')
  .description('Append values to a range')
  .requiredOption('--values <json>', 'Values as JSON array')
  .action(async (spreadsheetId: string, range: string, opts) => {
    try {
      const client = getClient();
      const values = JSON.parse(opts.values);
      const result = await client.sheets.appendValues(spreadsheetId, range, values);
      success('Values appended!');
      print(result, getFormat(sheetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('append-row <spreadsheetId> <sheetName>')
  .description('Append a single row')
  .requiredOption('--row <json>', 'Row values as JSON array (e.g., \'["value1", "value2"]\')')
  .action(async (spreadsheetId: string, sheetName: string, opts) => {
    try {
      const client = getClient();
      const row = JSON.parse(opts.row);
      const result = await client.sheets.appendRow(spreadsheetId, sheetName, row);
      success('Row appended!');
      print(result, getFormat(sheetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('clear <spreadsheetId> <range>')
  .description('Clear values from a range')
  .action(async (spreadsheetId: string, range: string) => {
    try {
      const client = getClient();
      const result = await client.sheets.clearValues(spreadsheetId, range);
      success('Values cleared!');
      print(result, getFormat(sheetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('cell-get <spreadsheetId> <sheetName> <cell>')
  .description('Get a single cell value')
  .action(async (spreadsheetId: string, sheetName: string, cell: string) => {
    try {
      const client = getClient();
      const value = await client.sheets.getCellValue(spreadsheetId, sheetName, cell);
      console.log(value);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('cell-set <spreadsheetId> <sheetName> <cell> <value>')
  .description('Set a single cell value')
  .action(async (spreadsheetId: string, sheetName: string, cell: string, value: string) => {
    try {
      const client = getClient();
      await client.sheets.setCellValue(spreadsheetId, sheetName, cell, value);
      success('Cell value set!');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('row-get <spreadsheetId> <sheetName> <rowIndex>')
  .description('Get a row by index (1-based)')
  .action(async (spreadsheetId: string, sheetName: string, rowIndex: string) => {
    try {
      const client = getClient();
      const row = await client.sheets.getRow(spreadsheetId, sheetName, parseInt(rowIndex));
      print(row, getFormat(sheetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sheetsCmd
  .command('col-get <spreadsheetId> <sheetName> <column>')
  .description('Get a column by letter')
  .action(async (spreadsheetId: string, sheetName: string, column: string) => {
    try {
      const client = getClient();
      const col = await client.sheets.getColumn(spreadsheetId, sheetName, column);
      print(col, getFormat(sheetsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
