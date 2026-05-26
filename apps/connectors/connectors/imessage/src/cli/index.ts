#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { IMessage } from '../api/index';
import {
  getBridgeUrl,
  setBridgeUrl,
  setApiKey,
  setDeviceId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  getConfigDir,
} from '../utils/config';
import { output } from '../utils/output';

const program = new Command();

program
  .name('connect-imessage')
  .description('iMessage connector CLI - bridge-first iMessage transport')
  .version('0.0.1')
  .option('-p, --profile <name>', 'Profile to use')
  .option('-f, --format <format>', 'Output format: json, pretty', 'pretty');

// ============================================
// Profile
// ============================================

const profileCmd = program.command('profile').description('Manage profiles');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();
    for (const name of profiles) {
      const marker = name === current ? chalk.green('* ') : '  ';
      console.log(marker + name);
    }
    if (profiles.length === 0) {
      console.log(chalk.dim('No profiles found'));
    }
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    createProfile(name);
    console.log(chalk.green('Created profile: ' + name));
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (deleteProfile(name)) {
      console.log(chalk.green('Deleted profile: ' + name));
    } else {
      console.log(chalk.red('Failed to delete profile: ' + name));
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    setCurrentProfile(name);
    console.log(chalk.green('Now using profile: ' + name));
  });

// ============================================
// Config
// ============================================

const configCmd = program.command('config').description('Configure settings');

configCmd
  .command('set <key> <value>')
  .description('Set a config value (bridgeUrl, apiKey, deviceId)')
  .action((key: string, value: string) => {
    if (key === 'bridgeUrl') setBridgeUrl(value);
    else if (key === 'apiKey') setApiKey(value);
    else if (key === 'deviceId') setDeviceId(value);
    else {
      console.log(chalk.red('Unknown key: ' + key));
      process.exit(1);
    }
    console.log(chalk.green('Set ' + key));
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadProfile();
    const profile = getCurrentProfile();
    console.log(chalk.bold('Profile:'), profile);
    console.log(chalk.bold('Config dir:'), getConfigDir());
    console.log('');
    console.log(chalk.bold('Settings:'));
    console.log('  bridgeUrl:', config.bridgeUrl || '(not set)');
    console.log('  apiKey:', config.apiKey ? '****' : '(not set)');
    console.log('  deviceId:', config.deviceId || '(not set)');
  });

// ============================================
// Health
// ============================================

program
  .command('health')
  .description('Check bridge health')
  .action(async () => {
    const client = createClient();
    try {
      const health = await client.health.check();
      output(health, getFormat());
    } catch (error) {
      console.log(chalk.red('Health check failed: ' + (error as Error).message));
      process.exit(1);
    }
  });

// ============================================
// Conversations
// ============================================

const convCmd = program.command('conversation').description('Manage conversations');

convCmd
  .command('list')
  .description('List conversations')
  .option('-l, --limit <n>', 'Max conversations to return')
  .action(async (opts: { limit?: string }) => {
    const client = createClient();
    try {
      const convs = await client.conversations.list({
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      output(convs, getFormat());
    } catch (error) {
      console.log(chalk.red('Failed to list conversations: ' + (error as Error).message));
      process.exit(1);
    }
  });

convCmd
  .command('get <chatGuid>')
  .description('Get a conversation by GUID')
  .action(async (chatGuid: string) => {
    const client = createClient();
    try {
      const conv = await client.conversations.get(chatGuid);
      output(conv, getFormat());
    } catch (error) {
      console.log(chalk.red('Failed to get conversation: ' + (error as Error).message));
      process.exit(1);
    }
  });

// ============================================
// Messages
// ============================================

const msgCmd = program.command('message').description('Manage messages');

msgCmd
  .command('list <chatGuid>')
  .description('List messages in a conversation')
  .option('-l, --limit <n>', 'Max messages to return')
  .action(async (chatGuid: string, opts: { limit?: string }) => {
    const client = createClient();
    try {
      const msgs = await client.messages.list({
        chatGuid,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });
      output(msgs, getFormat());
    } catch (error) {
      console.log(chalk.red('Failed to list messages: ' + (error as Error).message));
      process.exit(1);
    }
  });

msgCmd
  .command('send')
  .description('Send a message')
  .requiredOption('-r, --recipient <handle>', 'Recipient handle or chat GUID')
  .requiredOption('-t, --text <text>', 'Message text')
  .action(async (opts: { recipient: string; text: string }) => {
    const client = createClient();
    try {
      const msg = await client.messages.send({
        chatGuid: opts.recipient.includes('chat=') ? opts.recipient : undefined,
        recipient: opts.recipient.includes('chat=') ? undefined : opts.recipient,
        text: opts.text,
      });
      output(msg, getFormat());
    } catch (error) {
      console.log(chalk.red('Failed to send message: ' + (error as Error).message));
      process.exit(1);
    }
  });

msgCmd
  .command('reply <messageGuid>')
  .description('Reply to a specific message')
  .requiredOption('-t, --text <text>', 'Reply text')
  .action(async (messageGuid: string, opts: { text: string }) => {
    const client = createClient();
    try {
      const msg = await client.messages.reply(messageGuid, {
        text: opts.text,
        selectedMessageGuid: messageGuid,
      });
      output(msg, getFormat());
    } catch (error) {
      console.log(chalk.red('Failed to reply: ' + (error as Error).message));
      process.exit(1);
    }
  });

// ============================================
// Helpers
// ============================================

function createClient(): IMessage {
  const bridgeUrl = getBridgeUrl();
  if (!bridgeUrl) {
    console.log(chalk.red('Error: bridgeUrl not configured'));
    console.log('  Set it with: connect-imessage config set bridgeUrl <url>');
    console.log('  Or set IMESSAGE_BRIDGE_URL env var');
    process.exit(1);
  }

  return new IMessage({
    bridgeUrl,
    apiKey: process.env.IMESSAGE_API_KEY,
    deviceId: process.env.IMESSAGE_DEVICE_ID,
  });
}

function getFormat(): 'json' | 'pretty' {
  const format = program.opts().format;
  return format === 'json' ? 'json' : 'pretty';
}

// Parse async
program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
