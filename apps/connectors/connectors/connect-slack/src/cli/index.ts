#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Slack } from '../api';
import type { OutputFormat } from '../types';
import {
  getBotToken,
  setBotToken,
  setUserToken,
  getDefaultChannel,
  setDefaultChannel,
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

// Helper to get authenticated client
function getClient(): Slack {
  const token = getBotToken();
  if (!token) {
    console.error(chalk.red('Error: No Slack token configured.'));
    console.error(chalk.yellow('Set token with: connect-slack config set-token <token>'));
    console.error(chalk.yellow('Or set SLACK_BOT_TOKEN environment variable'));
    process.exit(1);
  }
  return new Slack({ accessToken: token });
}

// Global options
program
  .name('connect-slack')
  .description('Slack API CLI')
  .version('0.0.1')
  .option('-p, --profile <name>', 'Use specific profile')
  .option('-f, --format <format>', 'Output format: json, table, pretty', 'pretty')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

// ============================================
// Auth/Config Commands
// ============================================

const configCmd = program
  .command('config')
  .description('Configuration commands');

configCmd
  .command('set-token <token>')
  .description('Set bot token for current profile')
  .action((token: string) => {
    setBotToken(token);
    success(`Bot token saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-user-token <token>')
  .description('Set user token for current profile')
  .action((token: string) => {
    setUserToken(token);
    success(`User token saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-channel <channel>')
  .description('Set default channel')
  .action((channel: string) => {
    setDefaultChannel(channel);
    success(`Default channel set to "${channel}"`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profile = getCurrentProfile();
    const token = getBotToken();
    const channel = getDefaultChannel();

    heading('Current Configuration');
    print({
      profile,
      authenticated: isAuthenticated(),
      token: token ? `${token.substring(0, 10)}...` : 'Not set',
      defaultChannel: channel || 'Not set',
    });
  });

configCmd
  .command('clear')
  .description('Clear configuration for current profile')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// Profile Commands
// ============================================

const profileCmd = program
  .command('profile')
  .description('Profile management');

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
    try {
      createProfile(name);
      success(`Profile "${name}" created`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    try {
      deleteProfile(name);
      success(`Profile "${name}" deleted`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

profileCmd
  .command('show')
  .description('Show current profile name')
  .action(() => {
    console.log(getCurrentProfile());
  });

// ============================================
// Test/Auth Commands
// ============================================

program
  .command('test')
  .alias('whoami')
  .description('Test authentication and show current user')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.test();
      print({
        user: result.user,
        userId: result.user_id,
        team: result.team,
        teamId: result.team_id,
        url: result.url,
      });
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ============================================
// Channel Commands
// ============================================

const channelsCmd = program
  .command('channels')
  .description('Channel commands');

channelsCmd
  .command('list')
  .description('List channels')
  .option('-t, --types <types>', 'Channel types (public_channel,private_channel)', 'public_channel,private_channel')
  .option('-a, --all', 'Include archived channels')
  .option('-l, --limit <n>', 'Maximum number to return', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const channels = await client.channels.list({
        types: opts.types,
        exclude_archived: !opts.all,
        limit: parseInt(opts.limit, 10),
      });

      if (format === 'json') {
        print(channels, format);
      } else {
        print(channels.map(c => ({
          id: c.id,
          name: c.name,
          private: c.is_private ? 'yes' : 'no',
          members: c.num_members,
          archived: c.is_archived ? 'yes' : 'no',
        })), format);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

channelsCmd
  .command('info <channel>')
  .description('Get channel info')
  .action(async (channel: string) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;

      // Try to find by name if not an ID
      let channelId = channel;
      if (!channel.startsWith('C')) {
        const found = await client.channels.findByName(channel);
        if (!found) {
          error(`Channel "${channel}" not found`);
          process.exit(1);
        }
        channelId = found.id;
      }

      const info = await client.channels.info(channelId);
      print(info, format);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

channelsCmd
  .command('join <channel>')
  .description('Join a channel')
  .action(async (channel: string) => {
    try {
      const client = getClient();
      const result = await client.channels.join(channel);
      success(`Joined channel #${result.name}`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

channelsCmd
  .command('leave <channel>')
  .description('Leave a channel')
  .action(async (channel: string) => {
    try {
      const client = getClient();
      await client.channels.leave(channel);
      success('Left channel');
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ============================================
// Message Commands
// ============================================

const messagesCmd = program
  .command('messages')
  .alias('msg')
  .description('Message commands');

messagesCmd
  .command('send <channel> <text>')
  .description('Send a message to a channel')
  .option('-t, --thread <ts>', 'Reply to thread')
  .action(async (channel: string, text: string, opts) => {
    try {
      const client = getClient();

      // Resolve channel name to ID if needed
      let channelId = channel;
      if (!channel.startsWith('C') && !channel.startsWith('D')) {
        const found = await client.channels.findByName(channel);
        if (!found) {
          error(`Channel "${channel}" not found`);
          process.exit(1);
        }
        channelId = found.id;
      }

      const result = await client.messages.send({
        channel: channelId,
        text,
        thread_ts: opts.thread,
      });

      success(`Message sent (ts: ${result.ts})`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

messagesCmd
  .command('history <channel>')
  .description('Get message history')
  .option('-l, --limit <n>', 'Number of messages', '20')
  .action(async (channel: string, opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;

      // Resolve channel name to ID if needed
      let channelId = channel;
      if (!channel.startsWith('C') && !channel.startsWith('D')) {
        const found = await client.channels.findByName(channel);
        if (!found) {
          error(`Channel "${channel}" not found`);
          process.exit(1);
        }
        channelId = found.id;
      }

      const messages = await client.messages.history({
        channel: channelId,
        limit: parseInt(opts.limit, 10),
      });

      if (format === 'json') {
        print(messages, format);
      } else {
        print(messages.map(m => ({
          ts: m.ts,
          user: m.user || m.bot_id || 'unknown',
          text: m.text?.substring(0, 100) + (m.text && m.text.length > 100 ? '...' : ''),
        })), format);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

messagesCmd
  .command('search <query>')
  .description('Search messages')
  .option('-l, --limit <n>', 'Number of results', '20')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const messages = await client.messages.search(query, parseInt(opts.limit, 10));
      print(messages, format);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ============================================
// User Commands
// ============================================

const usersCmd = program
  .command('users')
  .description('User commands');

usersCmd
  .command('list')
  .description('List users')
  .option('-l, --limit <n>', 'Maximum number to return', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;
      const users = await client.users.list(parseInt(opts.limit, 10));

      // Filter out bots and deleted users by default
      const activeUsers = users.filter(u => !u.is_bot && !u.deleted);

      if (format === 'json') {
        print(activeUsers, format);
      } else {
        print(activeUsers.map(u => ({
          id: u.id,
          name: u.name,
          realName: u.real_name,
          email: u.profile.email,
          admin: u.is_admin ? 'yes' : 'no',
        })), format);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

usersCmd
  .command('info <user>')
  .description('Get user info')
  .action(async (user: string) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;

      // Try to find by name if not an ID
      let userInfo;
      if (user.startsWith('U')) {
        userInfo = await client.users.info(user);
      } else {
        userInfo = await client.users.findByName(user);
        if (!userInfo) {
          error(`User "${user}" not found`);
          process.exit(1);
        }
      }

      print(userInfo, format);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ============================================
// Quick Send Command
// ============================================

program
  .command('send <channel> <text>')
  .description('Quick send a message')
  .action(async (channel: string, text: string) => {
    try {
      const client = getClient();

      // Resolve channel name to ID if needed
      let channelId = channel;
      if (!channel.startsWith('C') && !channel.startsWith('D')) {
        const found = await client.channels.findByName(channel);
        if (!found) {
          error(`Channel "${channel}" not found`);
          process.exit(1);
        }
        channelId = found.id;
      }

      const result = await client.send(channelId, text);
      success(`Message sent to #${channel} (ts: ${result.ts})`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ============================================
// Bulk Operations
// ============================================

const bulkCmd = program
  .command('bulk')
  .description('Bulk operations');

bulkCmd
  .command('channels')
  .description('Bulk archive/unarchive channels')
  .option('--ids <ids>', 'Comma-separated channel IDs')
  .option('--action <action>', 'Action: archive or unarchive', 'archive')
  .option('--concurrency <n>', 'Max concurrent requests', '10')
  .option('--dry-run', 'Preview without executing')
  .action(async (opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;

      if (!opts.ids) {
        error('--ids is required (comma-separated channel IDs)');
        process.exit(1);
      }

      const channelIds = opts.ids.split(',').map((id: string) => id.trim()).filter(Boolean);

      info(`Bulk ${opts.action} ${channelIds.length} channels (concurrency: ${opts.concurrency}, dry-run: ${!!opts.dryRun})`);

      const result = await client.bulk.channels({
        channelIds,
        action: opts.action as 'archive' | 'unarchive',
        concurrency: parseInt(opts.concurrency, 10),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\rProgress: ${current}/${total}`);
        },
      });

      console.log();
      if (format === 'json') {
        print(result, format);
      } else {
        info(`Done: ${result.success} succeeded, ${result.failed} failed out of ${result.total}`);
        if (result.errors.length > 0) {
          error('Failures:');
          result.errors.forEach((e: { channelId: string; error: string }) => {
            console.error(`  - ${e.channelId}: ${e.error}`);
          });
        }
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

bulkCmd
  .command('messages')
  .description('Bulk delete messages')
  .option('--messages <msgs>', 'Messages as "channel:ts" pairs, comma-separated')
  .option('--concurrency <n>', 'Max concurrent requests', '10')
  .option('--dry-run', 'Preview without executing')
  .action(async (opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;

      if (!opts.messages) {
        error('--messages is required (comma-separated "channel:ts" pairs)');
        process.exit(1);
      }

      const messages = opts.messages.split(',').map((pair: string) => {
        const [channel, ts] = pair.trim().split(':');
        return { channel, ts };
      });

      info(`Bulk delete ${messages.length} messages (concurrency: ${opts.concurrency}, dry-run: ${!!opts.dryRun})`);

      const result = await client.bulk.messages({
        messages,
        concurrency: parseInt(opts.concurrency, 10),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\rProgress: ${current}/${total}`);
        },
      });

      console.log();
      if (format === 'json') {
        print(result, format);
      } else {
        info(`Done: ${result.success} succeeded, ${result.failed} failed out of ${result.total}`);
        if (result.errors.length > 0) {
          error('Failures:');
          result.errors.forEach((e: { channel: string; ts: string; error: string }) => {
            console.error(`  - ${e.channel}@${e.ts}: ${e.error}`);
          });
        }
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

bulkCmd
  .command('users')
  .description('Bulk set user presence')
  .option('--ids <ids>', 'Comma-separated user IDs')
  .option('--presence <value>', 'Presence: auto or away', 'auto')
  .option('--concurrency <n>', 'Max concurrent requests', '10')
  .option('--dry-run', 'Preview without executing')
  .action(async (opts) => {
    try {
      const client = getClient();
      const format = program.opts().format as OutputFormat;

      if (!opts.ids) {
        error('--ids is required (comma-separated user IDs)');
        process.exit(1);
      }

      const userIds = opts.ids.split(',').map((id: string) => id.trim()).filter(Boolean);

      info(`Bulk set presence for ${userIds.length} users (concurrency: ${opts.concurrency}, dry-run: ${!!opts.dryRun})`);

      const result = await client.bulk.users({
        userIds,
        action: 'set_presence',
        presence: opts.presence as 'auto' | 'away',
        concurrency: parseInt(opts.concurrency, 10),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\rProgress: ${current}/${total}`);
        },
      });

      console.log();
      if (format === 'json') {
        print(result, format);
      } else {
        info(`Done: ${result.success} succeeded, ${result.failed} failed out of ${result.total}`);
        if (result.errors.length > 0) {
          error('Failures:');
          result.errors.forEach((e: { userId: string; error: string }) => {
            console.error(`  - ${e.userId}: ${e.error}`);
          });
        }
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

program.parse();
