#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { Gmail } from '../api';
import {
  getClientId,
  getClientSecret,
  setCredentials,
  clearConfig,
  isAuthenticated,
  loadTokens,
  saveTokens,
  getUserEmail,
  setUserEmail,
  getUserName,
  setUserName,
  getConfigDir,
  getBaseConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
} from '../utils/config';
import {
  getAuthUrl,
  startCallbackServer,
} from '../utils/auth';
import {
  saveContact,
  getContact,
  getAllContacts,
  deleteContact,
  searchContacts,
  type Contact,
} from '../utils/contacts';
import {
  loadSettings,
  saveSettings,
  setSetting,
  setSignature,
  type Settings,
} from '../utils/settings';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const program = new Command();

program
  .name('connect-gmail')
  .description('Gmail API connector CLI - Send, read, and manage Gmail with ease')
  .version('0.1.0')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    // Set profile override before any command runs
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "connect-gmail profiles create ${opts.profile}"`);
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

// Helper to check authentication
function requireAuth(): Gmail {
  if (!isAuthenticated()) {
    error('Not authenticated. Run "connect-gmail auth login" first.');
    process.exit(1);
  }
  return Gmail.create();
}

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Authentication commands');

authCmd
  .command('login')
  .description('Login to Gmail via OAuth2 (opens browser) - auto-creates profile from email')
  .action(async () => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (!clientId || !clientSecret) {
      error('OAuth credentials not configured.');
      info('Run "connect-gmail config set-credentials <client-id> <client-secret>" first.');
      info('Or set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables.');
      process.exit(1);
    }

    info('Starting OAuth2 authentication flow...');
    info('A browser window will open for you to authorize the application.');

    // Start callback server first
    const serverPromise = startCallbackServer();

    // Open browser to auth URL
    const authUrl = getAuthUrl();
    await open(authUrl);

    info('Waiting for authentication...');

    const result = await serverPromise;

    if (result.success) {
      success('Successfully authenticated!');

      // Get user profile and create/switch to profile named after email
      try {
        // Temporarily switch to default profile to avoid overwriting other profiles
        setProfileOverride('default');

        // Save tokens to default profile first so Gmail.create() can use them
        if (result.tokens) {
          saveTokens(result.tokens);
        }

        const gmail = Gmail.create();
        const profile = await gmail.profile.get();
        const email = profile.emailAddress;

        // Convert email to profile slug: user@example.com → andreihasnacom
        const profileSlug = email.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

        // Create profile if it doesn't exist
        if (!profileExists(profileSlug)) {
          createProfile(profileSlug);
          info(`Created profile: ${profileSlug}`);
        }

        // Switch to the profile and save credentials there
        setCurrentProfile(profileSlug);
        setProfileOverride(profileSlug);

        // Save tokens and email to the new profile
        setUserEmail(email);

        // Re-save tokens to the correct profile
        if (result.tokens) {
          saveTokens(result.tokens);
        }

        success(`Profile: ${profileSlug}`);
        info(`Email: ${email}`);
      } catch (err) {
        // Profile fetch failed but auth succeeded
        warn(`Could not auto-create profile: ${err}`);
      }
    } else {
      error(`Authentication failed: ${result.error}`);
      process.exit(1);
    }
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(async () => {
    if (isAuthenticated()) {
      const tokens = loadTokens();
      const email = getUserEmail();
      success('Authenticated');
      if (email) {
        info(`Email: ${email}`);
      }
      if (tokens) {
        const expiresIn = Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000 / 60));
        info(`Access token expires in: ${expiresIn} minutes`);
        info(`Has refresh token: ${tokens.refreshToken ? 'Yes' : 'No'}`);
      }
    } else {
      warn('Not authenticated');
      info('Run "connect-gmail auth login" to authenticate.');
    }
  });

authCmd
  .command('logout')
  .description('Clear stored authentication tokens')
  .action(() => {
    clearConfig();
    success('Logged out successfully');
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-credentials <clientId> <clientSecret>')
  .description('Set OAuth2 client credentials')
  .action((clientId: string, clientSecret: string) => {
    setCredentials(clientId, clientSecret);
    success('OAuth credentials saved successfully');
    info(`Config stored in: ${getConfigDir()}`);
  });

configCmd
  .command('set-name <name>')
  .description('Set your display name for sending emails (e.g., "John Doe")')
  .action((name: string) => {
    setUserName(name);
    success(`Display name set to: ${name}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const email = getUserEmail();
    const name = getUserName();
    const tokens = loadTokens();
    const settings = loadSettings();

    info(`Config directory: ${getConfigDir()}`);
    info(`Client ID: ${clientId ? `${clientId.substring(0, 20)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${clientSecret ? '********' : chalk.gray('not set')}`);
    info(`Authenticated: ${isAuthenticated() ? chalk.green('Yes') : chalk.red('No')}`);
    if (email) {
      info(`Email: ${email}`);
    }
    if (name) {
      info(`Display Name: ${name}`);
    }
    if (tokens) {
      info(`Token expires: ${new Date(tokens.expiresAt).toLocaleString()}`);
    }
    info(`Markdown enabled: ${settings.markdownEnabled ? 'Yes' : 'No'}`);
    info(`Append signature: ${settings.appendSignature ? 'Yes' : 'No'}`);
  });

configCmd
  .command('clear')
  .description('Clear all configuration and tokens')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// Me Command (Gmail profile info)
// ============================================
program
  .command('me')
  .description('Get your Gmail profile information')
  .action(async () => {
    try {
      const gmail = requireAuth();
      const profile = await gmail.profile.get();
      print(profile, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Profiles Management Commands
// ============================================
const profilesCmd = program
  .command('profiles')
  .description('Manage multiple Gmail profiles');

profilesCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    try {
      const profiles = listProfiles();
      const current = getCurrentProfile();

      if (profiles.length === 0) {
        info('No profiles found');
        return;
      }

      success(`${profiles.length} profile(s):`);
      for (const p of profiles) {
        if (p === current) {
          info(`  ${chalk.green('→')} ${p} ${chalk.gray('(current)')}`);
        } else {
          info(`    ${p}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('current')
  .description('Show current profile')
  .action(() => {
    const current = getCurrentProfile();
    info(`Current profile: ${chalk.green(current)}`);
    info(`Config directory: ${getConfigDir()}`);
  });

profilesCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      createProfile(name);
      success(`Profile "${name}" created`);
      info(`Switch to it with: connect-gmail profiles switch ${name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('switch <name>')
  .alias('use')
  .description('Switch to a different profile')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      success(`Switched to profile "${name}"`);
      info(`Config directory: ${getConfigDir()}`);

      // Show auth status for the new profile
      if (isAuthenticated()) {
        const email = getUserEmail();
        if (email) {
          info(`Logged in as: ${email}`);
        }
      } else {
        warn('Profile not authenticated. Run "connect-gmail auth login"');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    try {
      deleteProfile(name);
      success(`Profile "${name}" deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('show')
  .description('Show all profiles with their status')
  .action(async () => {
    try {
      const profiles = listProfiles();
      const current = getCurrentProfile();

      if (profiles.length === 0) {
        info('No profiles found');
        return;
      }

      success(`${profiles.length} profile(s):\n`);

      for (const p of profiles) {
        // Temporarily switch to profile to check status
        setProfileOverride(p);
        const authenticated = isAuthenticated();
        const email = authenticated ? getUserEmail() : null;
        setProfileOverride(undefined);

        const isCurrent = p === current;
        const marker = isCurrent ? chalk.green('→') : ' ';
        const status = authenticated ? chalk.green('authenticated') : chalk.yellow('not authenticated');
        const emailStr = email ? chalk.gray(`(${email})`) : '';
        const currentStr = isCurrent ? chalk.gray(' [current]') : '';

        info(`  ${marker} ${p}${currentStr}`);
        info(`      Status: ${status} ${emailStr}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Messages Commands
// ============================================
const messagesCmd = program
  .command('messages')
  .description('Email message commands');

messagesCmd
  .command('list')
  .description('List messages in your mailbox')
  .option('-n, --max <number>', 'Maximum messages to return', '10')
  .option('-q, --query <query>', 'Gmail search query (e.g., "is:unread", "from:someone@example.com")')
  .option('-l, --label <label>', 'Filter by label ID')
  .action(async (opts) => {
    try {
      const gmail = requireAuth();
      const result = await gmail.messages.list({
        maxResults: parseInt(opts.max),
        q: opts.query,
        labelIds: opts.label ? [opts.label] : undefined,
      });

      if (!result.messages || result.messages.length === 0) {
        info('No messages found');
        return;
      }

      success(`Found ${result.messages.length} messages:`);

      // Fetch details for each message
      const messages = await Promise.all(
        result.messages.slice(0, 10).map(async (m) => {
          const msg = await gmail.messages.get(m.id, 'metadata');
          const headers = msg.payload?.headers || [];
          const getHeader = (name: string) =>
            headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

          return {
            id: m.id,
            from: getHeader('From'),
            subject: getHeader('Subject'),
            date: getHeader('Date'),
            snippet: msg.snippet?.substring(0, 50) + '...',
          };
        })
      );

      print(messages, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('read <messageId>')
  .description('Read a specific message')
  .option('--body', 'Include full message body')
  .option('--html', 'Show HTML body instead of plain text')
  .option('--structure', 'Show message MIME structure (for debugging)')
  .action(async (messageId: string, opts) => {
    try {
      const gmail = requireAuth();
      const message = await gmail.messages.get(messageId);

      const headers = message.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      // Extract body from message parts
      let body = '';
      if (opts.body && message.payload) {
        const targetType = opts.html ? 'text/html' : 'text/plain';

        // Helper to check MIME type (handles charset params like "text/html; charset=utf-8")
        const mimeMatches = (mimeType: string | undefined, target: string): boolean => {
          if (!mimeType) return false;
          const baseMime = mimeType.split(';')[0].trim().toLowerCase();
          return baseMime === target.toLowerCase();
        };

        // Collect all text parts from the message structure
        const collectTextParts = (part: typeof message.payload, results: Array<{mimeType: string, data: string}> = []): Array<{mimeType: string, data: string}> => {
          if (part.body?.data && part.mimeType) {
            const baseMime = part.mimeType.split(';')[0].trim().toLowerCase();
            if (baseMime.startsWith('text/')) {
              results.push({
                mimeType: baseMime,
                data: Buffer.from(part.body.data, 'base64url').toString('utf-8')
              });
            }
          }
          if (part.parts) {
            for (const p of part.parts) {
              collectTextParts(p, results);
            }
          }
          return results;
        };

        const textParts = collectTextParts(message.payload);

        // First, try to find exact target type
        const exactMatch = textParts.find(p => p.mimeType === targetType);
        if (exactMatch) {
          body = exactMatch.data;
        } else {
          // Fallback: if looking for text/plain but only text/html exists, use that
          // Or if looking for text/html but only text/plain exists, use that
          const altMatch = textParts.find(p => p.mimeType.startsWith('text/'));
          if (altMatch) {
            body = altMatch.data;
          }
        }
      }

      const output: Record<string, unknown> = {
        id: message.id,
        threadId: message.threadId,
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        labels: message.labelIds,
      };

      if (opts.structure) {
        output.structure = gmail.messages.getMessageStructure(message);
      }

      if (opts.body) {
        output.body = body;
      } else if (!opts.structure) {
        output.snippet = message.snippet;
      }

      print(output, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('send')
  .description('Send an email')
  .requiredOption('-t, --to <email>', 'Recipient email address')
  .requiredOption('-s, --subject <subject>', 'Email subject')
  .requiredOption('-b, --body <body>', 'Email body')
  .option('--cc <emails>', 'CC recipients (comma-separated)')
  .option('--bcc <emails>', 'BCC recipients (comma-separated)')
  .option('--html', 'Send as HTML email')
  .action(async (opts) => {
    try {
      const gmail = requireAuth();
      const result = await gmail.messages.send({
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
        cc: opts.cc?.split(',').map((e: string) => e.trim()),
        bcc: opts.bcc?.split(',').map((e: string) => e.trim()),
        isHtml: opts.html,
      });

      success(`Email sent successfully!`);
      info(`Message ID: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('trash <messageId>')
  .description('Move a message to trash')
  .action(async (messageId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.messages.trash(messageId);
      success(`Message ${messageId} moved to trash`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('delete <messageId>')
  .description('Permanently delete a message')
  .action(async (messageId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.messages.delete(messageId);
      success(`Message ${messageId} permanently deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('mark-read <messageId>')
  .description('Mark a message as read')
  .action(async (messageId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.messages.markAsRead(messageId);
      success(`Message ${messageId} marked as read`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('mark-unread <messageId>')
  .description('Mark a message as unread')
  .action(async (messageId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.messages.markAsUnread(messageId);
      success(`Message ${messageId} marked as unread`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('star <messageId>')
  .description('Star a message')
  .action(async (messageId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.messages.star(messageId);
      success(`Message ${messageId} starred`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('archive <messageId>')
  .description('Archive a message')
  .action(async (messageId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.messages.archive(messageId);
      success(`Message ${messageId} archived`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('reply <messageId>')
  .description('Reply to a message (stays in the same thread)')
  .requiredOption('-b, --body <body>', 'Reply body (supports markdown)')
  .option('--cc <emails>', 'CC recipients (comma-separated)')
  .option('--html', 'Send as HTML email')
  .action(async (messageId: string, opts) => {
    try {
      const gmail = requireAuth();
      const result = await gmail.messages.reply(messageId, {
        body: opts.body,
        cc: opts.cc?.split(',').map((e: string) => e.trim()),
        isHtml: opts.html,
      });

      success(`Reply sent!`);
      info(`Message ID: ${result.id}`);
      info(`Thread ID: ${result.threadId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('add-label <messageId> <labelId>')
  .description('Add a label to a message')
  .action(async (messageId: string, labelId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.messages.addLabel(messageId, labelId);
      success(`Label ${labelId} added to message ${messageId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('remove-label <messageId> <labelId>')
  .description('Remove a label from a message')
  .action(async (messageId: string, labelId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.messages.removeLabel(messageId, labelId);
      success(`Label ${labelId} removed from message ${messageId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Labels Commands
// ============================================
const labelsCmd = program
  .command('labels')
  .description('Label management commands');

labelsCmd
  .command('list')
  .description('List all labels')
  .action(async () => {
    try {
      const gmail = requireAuth();
      const result = await gmail.labels.list();

      if (!result.labels || result.labels.length === 0) {
        info('No labels found');
        return;
      }

      success(`Found ${result.labels.length} labels:`);

      const labels = result.labels.map(l => ({
        id: l.id,
        name: l.name,
        type: l.type,
        messagesTotal: l.messagesTotal,
        messagesUnread: l.messagesUnread,
      }));

      print(labels, getFormat(labelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

labelsCmd
  .command('create <name>')
  .description('Create a new label')
  .action(async (name: string) => {
    try {
      const gmail = requireAuth();
      const label = await gmail.labels.create({ name });
      success(`Label "${name}" created`);
      info(`Label ID: ${label.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

labelsCmd
  .command('delete <labelId>')
  .description('Delete a label')
  .action(async (labelId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.labels.delete(labelId);
      success(`Label ${labelId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Threads Commands
// ============================================
const threadsCmd = program
  .command('threads')
  .description('Email thread commands');

threadsCmd
  .command('list')
  .description('List threads in your mailbox')
  .option('-n, --max <number>', 'Maximum threads to return', '10')
  .option('-q, --query <query>', 'Gmail search query')
  .action(async (opts) => {
    try {
      const gmail = requireAuth();
      const result = await gmail.threads.list({
        maxResults: parseInt(opts.max),
        q: opts.query,
      });

      if (!result.threads || result.threads.length === 0) {
        info('No threads found');
        return;
      }

      success(`Found ${result.threads.length} threads:`);
      print(result.threads, getFormat(threadsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

threadsCmd
  .command('read <threadId>')
  .description('Read a specific thread')
  .action(async (threadId: string) => {
    try {
      const gmail = requireAuth();
      const thread = await gmail.threads.get(threadId);

      const output = {
        id: thread.id,
        messagesCount: thread.messages?.length || 0,
        messages: thread.messages?.map(m => {
          const headers = m.payload?.headers || [];
          const getHeader = (name: string) =>
            headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

          return {
            id: m.id,
            from: getHeader('From'),
            subject: getHeader('Subject'),
            date: getHeader('Date'),
            snippet: m.snippet?.substring(0, 50) + '...',
          };
        }),
      };

      print(output, getFormat(threadsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Drafts Commands
// ============================================
const draftsCmd = program
  .command('drafts')
  .description('Draft management commands');

draftsCmd
  .command('list')
  .description('List drafts')
  .option('-n, --max <number>', 'Maximum drafts to return', '10')
  .action(async (opts) => {
    try {
      const gmail = requireAuth();
      const result = await gmail.drafts.list(parseInt(opts.max));

      if (!result.drafts || result.drafts.length === 0) {
        info('No drafts found');
        return;
      }

      success(`Found ${result.drafts.length} drafts:`);
      print(result.drafts, getFormat(draftsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

draftsCmd
  .command('create')
  .description('Create a new draft')
  .requiredOption('-t, --to <email>', 'Recipient email address')
  .requiredOption('-s, --subject <subject>', 'Email subject')
  .requiredOption('-b, --body <body>', 'Email body')
  .option('--cc <emails>', 'CC recipients (comma-separated)')
  .option('--html', 'Send as HTML email')
  .action(async (opts) => {
    try {
      const gmail = requireAuth();
      const draft = await gmail.drafts.create({
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
        cc: opts.cc?.split(',').map((e: string) => e.trim()),
        isHtml: opts.html,
      });

      success(`Draft created!`);
      info(`Draft ID: ${draft.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

draftsCmd
  .command('send <draftId>')
  .description('Send a draft')
  .action(async (draftId: string) => {
    try {
      const gmail = requireAuth();
      const result = await gmail.drafts.send(draftId);
      success(`Draft sent!`);
      info(`Message ID: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

draftsCmd
  .command('delete <draftId>')
  .description('Delete a draft')
  .action(async (draftId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.drafts.delete(draftId);
      success(`Draft ${draftId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

draftsCmd
  .command('update <draftId>')
  .description('Update an existing draft')
  .requiredOption('-t, --to <email>', 'Recipient email address')
  .requiredOption('-s, --subject <subject>', 'Email subject')
  .requiredOption('-b, --body <body>', 'Email body')
  .option('--cc <emails>', 'CC recipients (comma-separated)')
  .option('--html', 'Send as HTML email')
  .action(async (draftId: string, opts) => {
    try {
      const gmail = requireAuth();
      const draft = await gmail.drafts.update(draftId, {
        to: opts.to,
        subject: opts.subject,
        body: opts.body,
        cc: opts.cc?.split(',').map((e: string) => e.trim()),
        isHtml: opts.html,
      });

      success(`Draft updated!`);
      info(`Draft ID: ${draft.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Filters Commands
// ============================================
const filtersCmd = program
  .command('filters')
  .description('Email filter management commands');

filtersCmd
  .command('list')
  .description('List all email filters')
  .action(async () => {
    try {
      const gmail = requireAuth();
      const result = await gmail.filters.list();

      if (!result.filter || result.filter.length === 0) {
        info('No filters found');
        return;
      }

      success(`Found ${result.filter.length} filters:`);
      const output = result.filter.map(f => ({
        id: f.id,
        from: f.criteria?.from || '-',
        to: f.criteria?.to || '-',
        subject: f.criteria?.subject || '-',
        query: f.criteria?.query || '-',
        actions: Object.keys(f.action || {}).join(', '),
      }));
      print(output, getFormat(filtersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filtersCmd
  .command('get <filterId>')
  .description('Get details of a specific filter')
  .action(async (filterId: string) => {
    try {
      const gmail = requireAuth();
      const filter = await gmail.filters.get(filterId);
      print(filter, getFormat(filtersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filtersCmd
  .command('create')
  .description('Create a new filter')
  .option('--from <email>', 'Match emails from this address')
  .option('--to <email>', 'Match emails to this address')
  .option('--subject <text>', 'Match emails with this subject')
  .option('--query <query>', 'Match emails matching this Gmail search query')
  .option('--has-attachment', 'Match emails with attachments')
  .option('--add-label <labelId>', 'Add this label to matching emails')
  .option('--remove-label <labelId>', 'Remove this label from matching emails')
  .option('--archive', 'Archive matching emails')
  .option('--mark-read', 'Mark matching emails as read')
  .option('--star', 'Star matching emails')
  .option('--trash', 'Move matching emails to trash')
  .option('--important', 'Mark matching emails as important')
  .option('--never-spam', 'Never send matching emails to spam')
  .action(async (opts) => {
    try {
      // Build criteria
      const criteria: Record<string, unknown> = {};
      if (opts.from) criteria.from = opts.from;
      if (opts.to) criteria.to = opts.to;
      if (opts.subject) criteria.subject = opts.subject;
      if (opts.query) criteria.query = opts.query;
      if (opts.hasAttachment) criteria.hasAttachment = true;

      if (Object.keys(criteria).length === 0) {
        error('At least one filter criteria is required (--from, --to, --subject, --query, or --has-attachment)');
        process.exit(1);
      }

      // Build action
      const action: Record<string, unknown> = {};
      if (opts.addLabel) action.addLabelIds = [opts.addLabel];
      if (opts.removeLabel) action.removeLabelIds = [opts.removeLabel];
      if (opts.archive) action.archive = true;
      if (opts.markRead) action.markRead = true;
      if (opts.star) action.star = true;
      if (opts.trash) action.trash = true;
      if (opts.important) action.markImportant = true;
      if (opts.neverSpam) action.neverSpam = true;

      if (Object.keys(action).length === 0) {
        error('At least one filter action is required (--add-label, --archive, --mark-read, --star, --trash, --important, --never-spam)');
        process.exit(1);
      }

      const gmail = requireAuth();
      const filter = await gmail.filters.create({ criteria, action });

      success(`Filter created!`);
      info(`Filter ID: ${filter.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filtersCmd
  .command('delete <filterId>')
  .description('Delete a filter')
  .action(async (filterId: string) => {
    try {
      const gmail = requireAuth();
      await gmail.filters.delete(filterId);
      success(`Filter ${filterId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Attachments Commands
// ============================================
const attachmentsCmd = program
  .command('attachments')
  .description('Email attachment commands');

attachmentsCmd
  .command('list <messageId>')
  .description('List attachments in a message')
  .action(async (messageId: string) => {
    try {
      const gmail = requireAuth();
      const attachments = await gmail.attachments.list(messageId);

      if (attachments.length === 0) {
        info('No attachments found in this message');
        return;
      }

      success(`Found ${attachments.length} attachment(s):`);
      const output = attachments.map(a => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: `${Math.round(a.size / 1024)} KB`,
        attachmentId: a.attachmentId.substring(0, 20) + '...',
      }));
      print(output, getFormat(attachmentsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

attachmentsCmd
  .command('download <messageId>')
  .description('Download all attachments from a message')
  .option('-a, --attachment-id <id>', 'Download specific attachment by ID')
  .action(async (messageId: string, opts) => {
    try {
      const gmail = requireAuth();

      if (opts.attachmentId) {
        // Download specific attachment
        const attachments = await gmail.attachments.list(messageId);
        const attachment = attachments.find(a => a.attachmentId === opts.attachmentId);

        if (!attachment) {
          error('Attachment not found');
          process.exit(1);
        }

        info(`Downloading ${attachment.filename}...`);
        const result = await gmail.attachments.download(
          messageId,
          attachment.attachmentId,
          attachment.filename,
          attachment.mimeType
        );

        success(`Downloaded: ${result.filename}`);
        info(`Saved to: ${result.path}`);
        info(`Size: ${Math.round(result.size / 1024)} KB`);
      } else {
        // Download all attachments
        info('Downloading all attachments...');
        const results = await gmail.attachments.downloadAll(messageId);

        if (results.length === 0) {
          info('No attachments found in this message');
          return;
        }

        success(`Downloaded ${results.length} attachment(s):`);
        for (const result of results) {
          info(`  • ${result.filename} (${Math.round(result.size / 1024)} KB)`);
        }
        info(`\nSaved to: ${gmail.attachments.getStoragePath(messageId)}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

attachmentsCmd
  .command('path <messageId>')
  .description('Show where attachments are/would be stored')
  .action(async (messageId: string) => {
    const gmail = requireAuth();
    const path = gmail.attachments.getStoragePath(messageId);
    info(`Attachments path: ${path}`);
  });

// ============================================
// Search Command (shortcut)
// ============================================
program
  .command('search <query>')
  .description('Search messages (shortcut for "messages list -q")')
  .option('-n, --max <number>', 'Maximum messages to return', '10')
  .action(async (query: string, opts) => {
    try {
      const gmail = requireAuth();
      const result = await gmail.messages.list({
        maxResults: parseInt(opts.max),
        q: query,
      });

      if (!result.messages || result.messages.length === 0) {
        info(`No messages found for query: ${query}`);
        return;
      }

      success(`Found ${result.messages.length} messages:`);

      const messages = await Promise.all(
        result.messages.slice(0, 10).map(async (m) => {
          const msg = await gmail.messages.get(m.id, 'metadata');
          const headers = msg.payload?.headers || [];
          const getHeader = (name: string) =>
            headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

          return {
            id: m.id,
            from: getHeader('From'),
            subject: getHeader('Subject'),
            date: getHeader('Date'),
          };
        })
      );

      print(messages, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Contacts Commands
// ============================================
const contactsCmd = program
  .command('contacts')
  .description('Contact management commands');

contactsCmd
  .command('list')
  .description('List all saved contacts')
  .action(() => {
    try {
      const contacts = getAllContacts();
      if (contacts.length === 0) {
        info('No contacts saved');
        return;
      }
      success(`Found ${contacts.length} contacts:`);
      const output = contacts.map(c => ({
        email: c.email,
        name: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || '-',
        company: c.company || '-',
      }));
      print(output, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('add <email>')
  .description('Add a new contact')
  .option('-n, --name <name>', 'Full name')
  .option('-f, --first <firstName>', 'First name')
  .option('-l, --last <lastName>', 'Last name')
  .option('-c, --company <company>', 'Company name')
  .option('--notes <notes>', 'Notes')
  .action((email: string, opts) => {
    try {
      const contact: Partial<Contact> = {
        email,
        name: opts.name,
        firstName: opts.first,
        lastName: opts.last,
        company: opts.company,
        notes: opts.notes,
      };
      saveContact(contact as Contact);
      success(`Contact ${email} saved!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('show <email>')
  .description('Show a contact\'s details')
  .action((email: string) => {
    try {
      const contact = getContact(email);
      if (!contact) {
        warn(`Contact ${email} not found`);
        return;
      }
      print(contact, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('delete <email>')
  .description('Delete a contact')
  .action((email: string) => {
    try {
      const deleted = deleteContact(email);
      if (deleted) {
        success(`Contact ${email} deleted`);
      } else {
        warn(`Contact ${email} not found`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('search <query>')
  .description('Search contacts by name or email')
  .action((query: string) => {
    try {
      const results = searchContacts(query);
      if (results.length === 0) {
        info(`No contacts found matching "${query}"`);
        return;
      }
      success(`Found ${results.length} contacts:`);
      const output = results.map(c => ({
        email: c.email,
        name: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || '-',
        company: c.company || '-',
      }));
      print(output, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('import <query>')
  .description('Import contacts from email search results (e.g., "from:@company.com")')
  .option('-n, --max <number>', 'Maximum emails to search', '50')
  .action(async (query: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`Searching for emails matching: ${query}`);

      const result = await gmail.messages.list({
        maxResults: parseInt(opts.max),
        q: query,
      });

      if (!result.messages || result.messages.length === 0) {
        info('No messages found');
        return;
      }

      info(`Found ${result.messages.length} messages, extracting contacts...`);

      // Extract unique contacts from messages
      const contactsMap = new Map<string, { email: string; name?: string }>();

      for (const m of result.messages) {
        const msg = await gmail.messages.get(m.id, 'metadata');
        const headers = msg.payload?.headers || [];
        const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';

        // Parse "Name <email>" or just "email" format
        const match = fromHeader.match(/^(?:"?([^"<]+)"?\s*)?<?([^>]+@[^>]+)>?$/);
        if (match) {
          const name = match[1]?.trim();
          const email = match[2]?.trim().toLowerCase();
          if (email && !contactsMap.has(email)) {
            contactsMap.set(email, { email, name });
          }
        }
      }

      if (contactsMap.size === 0) {
        info('No contacts found in messages');
        return;
      }

      // Save contacts
      let savedCount = 0;
      for (const contact of contactsMap.values()) {
        // Extract domain for company name
        const domain = contact.email.split('@')[1];
        const company = domain?.split('.')[0];

        saveContact({
          email: contact.email,
          name: contact.name,
          company: company ? company.charAt(0).toUpperCase() + company.slice(1) : undefined,
        } as Contact);
        savedCount++;
        info(`  + ${contact.name || contact.email} <${contact.email}>`);
      }

      success(`Imported ${savedCount} contacts!`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command('from-message <messageId>')
  .description('Save the sender of a specific message as a contact')
  .action(async (messageId: string) => {
    try {
      const gmail = requireAuth();
      const msg = await gmail.messages.get(messageId, 'metadata');
      const headers = msg.payload?.headers || [];
      const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';

      // Parse "Name <email>" or just "email" format
      const match = fromHeader.match(/^(?:"?([^"<]+)"?\s*)?<?([^>]+@[^>]+)>?$/);
      if (!match) {
        error('Could not parse sender from message');
        process.exit(1);
      }

      const name = match[1]?.trim();
      const email = match[2]?.trim().toLowerCase();
      const domain = email.split('@')[1];
      const company = domain?.split('.')[0];

      saveContact({
        email,
        name,
        company: company ? company.charAt(0).toUpperCase() + company.slice(1) : undefined,
      } as Contact);

      success(`Contact saved: ${name || email} <${email}>`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Settings Commands
// ============================================
const settingsCmd = program
  .command('settings')
  .description('Manage CLI settings');

settingsCmd
  .command('show')
  .description('Show current settings')
  .action(() => {
    const settings = loadSettings();
    print(settings, getFormat(settingsCmd));
  });

settingsCmd
  .command('set <key> <value>')
  .description('Set a setting value (e.g., "markdownEnabled true")')
  .action((key: string, value: string) => {
    try {
      const settings = loadSettings();
      const validKeys = Object.keys(settings);
      if (!validKeys.includes(key)) {
        error(`Invalid setting: ${key}`);
        info(`Valid settings: ${validKeys.join(', ')}`);
        process.exit(1);
      }

      // Parse value based on type
      let parsedValue: string | boolean;
      if (value === 'true') parsedValue = true;
      else if (value === 'false') parsedValue = false;
      else parsedValue = value;

      setSetting(key as keyof Settings, parsedValue as Settings[keyof Settings]);
      success(`Setting ${key} = ${parsedValue}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

settingsCmd
  .command('set-signature <signature>')
  .description('Set a custom email signature')
  .action((signature: string) => {
    setSignature(signature);
    success('Signature saved');
  });

settingsCmd
  .command('sync-signature')
  .description('Fetch and save your Gmail signature')
  .action(async () => {
    try {
      const gmail = requireAuth();
      const signature = await gmail.profile.getSignature();
      if (signature) {
        setSignature(signature);
        success('Gmail signature synced!');
        info(`Signature: ${signature.substring(0, 50)}${signature.length > 50 ? '...' : ''}`);
      } else {
        warn('No signature found in Gmail settings');
      }
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
  .description('Export emails to EML or MBOX format');

exportCmd
  .command('messages')
  .description('Export messages to EML or MBOX format')
  .option('-q, --query <query>', 'Gmail search query')
  .option('-l, --label <labelId>', 'Filter by label ID')
  .option('-n, --max <number>', 'Maximum messages to export', '100')
  .option('--format <format>', 'Output format: eml or mbox', 'mbox')
  .option('-o, --output <dir>', 'Output directory')
  .option('-f, --filename <name>', 'Output filename')
  .action(async (opts) => {
    try {
      const gmail = requireAuth();
      info(`Exporting messages${opts.query ? ` matching "${opts.query}"` : ''}...`);

      const result = await gmail.export.exportMessages({
        query: opts.query,
        labelIds: opts.label ? [opts.label] : undefined,
        maxResults: parseInt(opts.max),
        format: opts.format,
        outputDir: opts.output,
        filename: opts.filename,
      });

      success(`Exported ${result.messageCount} message(s)`);
      info(`Format: ${result.format.toUpperCase()}`);
      info(`File: ${result.filePath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exportCmd
  .command('inbox')
  .description('Export inbox messages')
  .option('-n, --max <number>', 'Maximum messages to export', '100')
  .option('--format <format>', 'Output format: eml or mbox', 'mbox')
  .option('-o, --output <dir>', 'Output directory')
  .option('-f, --filename <name>', 'Output filename')
  .action(async (opts) => {
    try {
      const gmail = requireAuth();
      info('Exporting inbox messages...');

      const result = await gmail.export.exportInbox({
        maxResults: parseInt(opts.max),
        format: opts.format,
        outputDir: opts.output,
        filename: opts.filename,
      });

      success(`Exported ${result.messageCount} inbox message(s)`);
      info(`Format: ${result.format.toUpperCase()}`);
      info(`File: ${result.filePath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exportCmd
  .command('sent')
  .description('Export sent messages')
  .option('-n, --max <number>', 'Maximum messages to export', '100')
  .option('--format <format>', 'Output format: eml or mbox', 'mbox')
  .option('-o, --output <dir>', 'Output directory')
  .option('-f, --filename <name>', 'Output filename')
  .action(async (opts) => {
    try {
      const gmail = requireAuth();
      info('Exporting sent messages...');

      const result = await gmail.export.exportSent({
        maxResults: parseInt(opts.max),
        format: opts.format,
        outputDir: opts.output,
        filename: opts.filename,
      });

      success(`Exported ${result.messageCount} sent message(s)`);
      info(`Format: ${result.format.toUpperCase()}`);
      info(`File: ${result.filePath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exportCmd
  .command('starred')
  .description('Export starred messages')
  .option('-n, --max <number>', 'Maximum messages to export', '100')
  .option('--format <format>', 'Output format: eml or mbox', 'mbox')
  .option('-o, --output <dir>', 'Output directory')
  .option('-f, --filename <name>', 'Output filename')
  .action(async (opts) => {
    try {
      const gmail = requireAuth();
      info('Exporting starred messages...');

      const result = await gmail.export.exportStarred({
        maxResults: parseInt(opts.max),
        format: opts.format,
        outputDir: opts.output,
        filename: opts.filename,
      });

      success(`Exported ${result.messageCount} starred message(s)`);
      info(`Format: ${result.format.toUpperCase()}`);
      info(`File: ${result.filePath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exportCmd
  .command('label <labelId>')
  .description('Export messages from a specific label')
  .option('-n, --max <number>', 'Maximum messages to export', '100')
  .option('--format <format>', 'Output format: eml or mbox', 'mbox')
  .option('-o, --output <dir>', 'Output directory')
  .option('-f, --filename <name>', 'Output filename')
  .action(async (labelId: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`Exporting messages from label "${labelId}"...`);

      const result = await gmail.export.exportLabel(labelId, {
        maxResults: parseInt(opts.max),
        format: opts.format,
        outputDir: opts.output,
        filename: opts.filename,
      });

      success(`Exported ${result.messageCount} message(s)`);
      info(`Format: ${result.format.toUpperCase()}`);
      info(`File: ${result.filePath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exportCmd
  .command('message <messageId>')
  .description('Export a single message to EML format')
  .option('-o, --output <dir>', 'Output directory')
  .option('-f, --filename <name>', 'Output filename')
  .action(async (messageId: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`Exporting message ${messageId}...`);

      const result = await gmail.export.exportMessage(messageId, {
        outputDir: opts.output,
        filename: opts.filename,
      });

      success(`Message exported`);
      info(`File: ${result.filePath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

exportCmd
  .command('thread <threadId>')
  .description('Export an entire thread (conversation)')
  .option('--format <format>', 'Output format: eml or mbox', 'mbox')
  .option('-o, --output <dir>', 'Output directory')
  .option('-f, --filename <name>', 'Output filename')
  .action(async (threadId: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`Exporting thread ${threadId}...`);

      const result = await gmail.export.exportThread(threadId, {
        format: opts.format,
        outputDir: opts.output,
        filename: opts.filename,
      });

      success(`Exported ${result.messageCount} message(s) from thread`);
      info(`Format: ${result.format.toUpperCase()}`);
      info(`File: ${result.filePath}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Bulk Operations Commands
// ============================================
const bulkCmd = program
  .command('bulk')
  .description('Bulk operations on messages (using Gmail search queries)');

bulkCmd
  .command('preview <query>')
  .description('Preview messages matching a Gmail search query')
  .option('-n, --max <number>', 'Maximum messages to preview', '20')
  .action(async (query: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`Searching for messages matching: ${query}`);

      const result = await gmail.bulk.preview(query, parseInt(opts.max));

      if (result.messages.length === 0) {
        info('No messages found matching the query');
        return;
      }

      success(`Found ${result.total} message(s):`);
      const output = result.messages.map(m => ({
        id: m.id,
        from: m.from || '-',
        subject: m.subject || '(no subject)',
        date: m.date || '-',
      }));
      print(output, getFormat(bulkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('label <query>')
  .description('Add or remove labels from messages matching a query')
  .option('-a, --add <labels>', 'Labels to add (comma-separated names or IDs)')
  .option('-r, --remove <labels>', 'Labels to remove (comma-separated names or IDs)')
  .option('-n, --max <number>', 'Maximum messages to process', '100')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--batch', 'Use Gmail batch API for faster processing (recommended for large batches)')
  .action(async (query: string, opts) => {
    try {
      if (!opts.add && !opts.remove) {
        error('At least one of --add or --remove is required');
        process.exit(1);
      }

      const gmail = requireAuth();
      const addLabels = opts.add ? opts.add.split(',').map((l: string) => l.trim()) : [];
      const removeLabels = opts.remove ? opts.remove.split(',').map((l: string) => l.trim()) : [];

      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Modifying labels for messages matching: ${query}`);
      if (addLabels.length > 0) info(`  Adding: ${addLabels.join(', ')}`);
      if (removeLabels.length > 0) info(`  Removing: ${removeLabels.join(', ')}`);

      let result;
      if (opts.batch) {
        result = await gmail.bulk.batchModifyLabels({
          query,
          maxResults: parseInt(opts.max),
          addLabels,
          removeLabels,
          dryRun: opts.dryRun,
        });
      } else {
        result = await gmail.bulk.modifyLabels({
          query,
          maxResults: parseInt(opts.max),
          addLabels,
          removeLabels,
          dryRun: opts.dryRun,
          onProgress: (current, total) => {
            process.stdout.write(`\r  Progress: ${current}/${total}`);
          },
        });
        console.log(); // New line after progress
      }

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk label modification complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) {
        warn(`  Failed: ${result.failed}`);
        for (const err of result.errors.slice(0, 5)) {
          info(`    - ${err.messageId}: ${err.error}`);
        }
        if (result.errors.length > 5) {
          info(`    ... and ${result.errors.length - 5} more errors`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('archive <query>')
  .description('Archive messages matching a query (remove from INBOX)')
  .option('-n, --max <number>', 'Maximum messages to process', '100')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--batch', 'Use Gmail batch API for faster processing')
  .action(async (query: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Archiving messages matching: ${query}`);

      let result;
      if (opts.batch) {
        result = await gmail.bulk.batchModifyLabels({
          query,
          maxResults: parseInt(opts.max),
          removeLabelIds: ['INBOX'],
          dryRun: opts.dryRun,
        });
      } else {
        result = await gmail.bulk.archive({
          query,
          maxResults: parseInt(opts.max),
          dryRun: opts.dryRun,
          onProgress: (current, total) => {
            process.stdout.write(`\r  Progress: ${current}/${total}`);
          },
        });
        console.log();
      }

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk archive complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('trash <query>')
  .description('Move messages matching a query to trash')
  .option('-n, --max <number>', 'Maximum messages to process', '100')
  .option('--dry-run', 'Preview changes without applying them')
  .action(async (query: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Moving to trash messages matching: ${query}`);

      const result = await gmail.bulk.trash({
        query,
        maxResults: parseInt(opts.max),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk trash complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('delete <query>')
  .description('Permanently delete messages matching a query (DANGER!)')
  .option('-n, --max <number>', 'Maximum messages to process', '100')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--batch', 'Use Gmail batch API for faster processing')
  .option('--confirm', 'Confirm permanent deletion')
  .action(async (query: string, opts) => {
    try {
      if (!opts.dryRun && !opts.confirm) {
        error('Permanent deletion requires --confirm flag');
        info('Use --dry-run to preview what would be deleted');
        process.exit(1);
      }

      const gmail = requireAuth();
      warn(`${opts.dryRun ? '[DRY RUN] ' : ''}PERMANENTLY DELETING messages matching: ${query}`);

      let result;
      if (opts.batch) {
        result = await gmail.bulk.batchDelete({
          query,
          maxResults: parseInt(opts.max),
          dryRun: opts.dryRun,
        });
      } else {
        result = await gmail.bulk.delete({
          query,
          maxResults: parseInt(opts.max),
          dryRun: opts.dryRun,
          onProgress: (current, total) => {
            process.stdout.write(`\r  Progress: ${current}/${total}`);
          },
        });
        console.log();
      }

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk delete complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('mark-read <query>')
  .description('Mark messages matching a query as read')
  .option('-n, --max <number>', 'Maximum messages to process', '100')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--batch', 'Use Gmail batch API for faster processing')
  .action(async (query: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Marking as read messages matching: ${query}`);

      let result;
      if (opts.batch) {
        result = await gmail.bulk.batchModifyLabels({
          query,
          maxResults: parseInt(opts.max),
          removeLabelIds: ['UNREAD'],
          dryRun: opts.dryRun,
        });
      } else {
        result = await gmail.bulk.markAsRead({
          query,
          maxResults: parseInt(opts.max),
          dryRun: opts.dryRun,
          onProgress: (current, total) => {
            process.stdout.write(`\r  Progress: ${current}/${total}`);
          },
        });
        console.log();
      }

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk mark-read complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('mark-unread <query>')
  .description('Mark messages matching a query as unread')
  .option('-n, --max <number>', 'Maximum messages to process', '100')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--batch', 'Use Gmail batch API for faster processing')
  .action(async (query: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Marking as unread messages matching: ${query}`);

      let result;
      if (opts.batch) {
        result = await gmail.bulk.batchModifyLabels({
          query,
          maxResults: parseInt(opts.max),
          addLabelIds: ['UNREAD'],
          dryRun: opts.dryRun,
        });
      } else {
        result = await gmail.bulk.markAsUnread({
          query,
          maxResults: parseInt(opts.max),
          dryRun: opts.dryRun,
          onProgress: (current, total) => {
            process.stdout.write(`\r  Progress: ${current}/${total}`);
          },
        });
        console.log();
      }

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk mark-unread complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('star <query>')
  .description('Star messages matching a query')
  .option('-n, --max <number>', 'Maximum messages to process', '100')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--batch', 'Use Gmail batch API for faster processing')
  .action(async (query: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Starring messages matching: ${query}`);

      let result;
      if (opts.batch) {
        result = await gmail.bulk.batchModifyLabels({
          query,
          maxResults: parseInt(opts.max),
          addLabelIds: ['STARRED'],
          dryRun: opts.dryRun,
        });
      } else {
        result = await gmail.bulk.star({
          query,
          maxResults: parseInt(opts.max),
          dryRun: opts.dryRun,
          onProgress: (current, total) => {
            process.stdout.write(`\r  Progress: ${current}/${total}`);
          },
        });
        console.log();
      }

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk star complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('unstar <query>')
  .description('Remove stars from messages matching a query')
  .option('-n, --max <number>', 'Maximum messages to process', '100')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--batch', 'Use Gmail batch API for faster processing')
  .action(async (query: string, opts) => {
    try {
      const gmail = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Removing stars from messages matching: ${query}`);

      let result;
      if (opts.batch) {
        result = await gmail.bulk.batchModifyLabels({
          query,
          maxResults: parseInt(opts.max),
          removeLabelIds: ['STARRED'],
          dryRun: opts.dryRun,
        });
      } else {
        result = await gmail.bulk.unstar({
          query,
          maxResults: parseInt(opts.max),
          dryRun: opts.dryRun,
          onProgress: (current, total) => {
            process.stdout.write(`\r  Progress: ${current}/${total}`);
          },
        });
        console.log();
      }

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk unstar complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('help-query')
  .description('Show Gmail search query syntax examples')
  .action(() => {
    info(chalk.bold('\nGmail Search Query Syntax:\n'));

    info(chalk.cyan('Basic filters:'));
    info('  from:user@example.com      - Messages from a specific sender');
    info('  to:user@example.com        - Messages to a specific recipient');
    info('  subject:invoice            - Messages with "invoice" in subject');
    info('  "exact phrase"             - Messages containing exact phrase\n');

    info(chalk.cyan('Date filters:'));
    info('  after:2024/01/01           - Messages after a date');
    info('  before:2024/12/31          - Messages before a date');
    info('  older_than:7d              - Messages older than 7 days');
    info('  newer_than:1m              - Messages newer than 1 month\n');

    info(chalk.cyan('Label filters:'));
    info('  label:work                 - Messages with a specific label');
    info('  in:inbox                   - Messages in inbox');
    info('  in:sent                    - Messages in sent');
    info('  in:trash                   - Messages in trash');
    info('  in:spam                    - Messages in spam\n');

    info(chalk.cyan('Status filters:'));
    info('  is:unread                  - Unread messages');
    info('  is:read                    - Read messages');
    info('  is:starred                 - Starred messages');
    info('  is:important               - Important messages');
    info('  has:attachment             - Messages with attachments\n');

    info(chalk.cyan('Size filters:'));
    info('  larger:10M                 - Messages larger than 10MB');
    info('  smaller:1K                 - Messages smaller than 1KB\n');

    info(chalk.cyan('Combining filters:'));
    info('  from:boss@company.com is:unread');
    info('  subject:report after:2024/01/01 before:2024/06/01');
    info('  from:@newsletter.com older_than:30d');
    info('  {from:alice@ex.com from:bob@ex.com}  - OR operator');
    info('  -from:spam@ex.com          - NOT operator (exclude)\n');

    info(chalk.cyan('Examples:'));
    info('  bulk preview "from:newsletter@company.com older_than:30d"');
    info('  bulk archive "from:@notifications.com is:read"');
    info('  bulk trash "subject:unsubscribe older_than:90d" --dry-run');
    info('  bulk label "from:@client.com" --add "Work/Clients"');
    info('  bulk mark-read "is:unread older_than:7d" --batch');
  });

// Parse and execute
program.parse();
