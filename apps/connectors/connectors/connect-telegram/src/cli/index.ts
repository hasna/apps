#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
import { Telegram } from '../api';
import {
  getBotToken,
  setBotToken,
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

const CONNECTOR_NAME = 'connect-telegram';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Telegram Bot API connector CLI - send messages, photos, documents with multi-profile support')
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
function getClient(): Telegram {
  const botToken = getBotToken();

  if (!botToken) {
    error(`No Telegram Bot Token configured. Run "${CONNECTOR_NAME} config set-token <botToken>" or set TELEGRAM_BOT_TOKEN environment variable.`);
    process.exit(1);
  }

  return new Telegram({ botToken });
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
  .option('--bot-token <token>', 'Telegram Bot Token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      botToken: opts.botToken,
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
  .command('current')
  .description('Show current active profile')
  .action(() => {
    console.log(getCurrentProfile());
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Bot Token: ${config.botToken ? `${config.botToken.split(':')[0]}:****` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <botToken>')
  .description('Set Telegram Bot Token')
  .action((botToken: string) => {
    setBotToken(botToken);
    success(`Bot token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const botToken = getBotToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Bot Token: ${botToken ? `${botToken.split(':')[0]}:****` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('path')
  .description('Show configuration directory path')
  .action(() => {
    console.log(getConfigDir());
  });

// ============================================
// Bot Commands
// ============================================
program
  .command('me')
  .description('Get bot information')
  .action(async () => {
    try {
      const client = getClient();
      const botInfo = await client.bot.getMe();
      print(botInfo, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Send Commands
// ============================================
program
  .command('send <chatId> <text>')
  .description('Send a text message')
  .option('--parse-mode <mode>', 'Parse mode (HTML, Markdown, MarkdownV2)')
  .option('--disable-preview', 'Disable link preview')
  .option('--silent', 'Send without notification')
  .action(async (chatId: string, text: string, opts: { parseMode?: string; disablePreview?: boolean; silent?: boolean }) => {
    try {
      const client = getClient();
      const message = await client.messages.sendMessage({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
        text,
        parseMode: opts.parseMode as 'HTML' | 'Markdown' | 'MarkdownV2' | undefined,
        disableWebPagePreview: opts.disablePreview,
        disableNotification: opts.silent,
      });
      success(`Message sent (ID: ${message.message_id})`);
      print({
        message_id: message.message_id,
        chat_id: message.chat.id,
        date: new Date(message.date * 1000).toISOString(),
      }, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('send-photo <chatId> <photoPath>')
  .description('Send a photo')
  .option('--caption <text>', 'Photo caption')
  .option('--parse-mode <mode>', 'Caption parse mode (HTML, Markdown, MarkdownV2)')
  .option('--silent', 'Send without notification')
  .action(async (chatId: string, photoPath: string, opts: { caption?: string; parseMode?: string; silent?: boolean }) => {
    try {
      // Check if it's a URL or file path
      let photo: string | Uint8Array;
      if (photoPath.startsWith('http://') || photoPath.startsWith('https://')) {
        photo = photoPath;
      } else {
        if (!existsSync(photoPath)) {
          error(`File not found: ${photoPath}`);
          process.exit(1);
        }
        photo = new Uint8Array(readFileSync(photoPath));
      }

      const client = getClient();
      const message = await client.messages.sendPhoto({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
        photo,
        caption: opts.caption,
        parseMode: opts.parseMode as 'HTML' | 'Markdown' | 'MarkdownV2' | undefined,
        disableNotification: opts.silent,
      });
      success(`Photo sent (ID: ${message.message_id})`);
      print({
        message_id: message.message_id,
        chat_id: message.chat.id,
        date: new Date(message.date * 1000).toISOString(),
      }, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('send-document <chatId> <filePath>')
  .description('Send a document')
  .option('--caption <text>', 'Document caption')
  .option('--parse-mode <mode>', 'Caption parse mode (HTML, Markdown, MarkdownV2)')
  .option('--silent', 'Send without notification')
  .action(async (chatId: string, filePath: string, opts: { caption?: string; parseMode?: string; silent?: boolean }) => {
    try {
      // Check if it's a URL or file path
      let document: string | Uint8Array;
      let fileName: string | undefined;

      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        document = filePath;
      } else {
        if (!existsSync(filePath)) {
          error(`File not found: ${filePath}`);
          process.exit(1);
        }
        document = new Uint8Array(readFileSync(filePath));
        fileName = basename(filePath);
      }

      const client = getClient();
      const message = await client.messages.sendDocument({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
        document,
        fileName,
        caption: opts.caption,
        parseMode: opts.parseMode as 'HTML' | 'Markdown' | 'MarkdownV2' | undefined,
        disableNotification: opts.silent,
      });
      success(`Document sent (ID: ${message.message_id})`);
      print({
        message_id: message.message_id,
        chat_id: message.chat.id,
        date: new Date(message.date * 1000).toISOString(),
        document: message.document?.file_name,
      }, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('forward <toChatId> <fromChatId> <messageId>')
  .description('Forward a message')
  .option('--silent', 'Send without notification')
  .action(async (toChatId: string, fromChatId: string, messageId: string, opts: { silent?: boolean }) => {
    try {
      const client = getClient();
      const message = await client.messages.forwardMessage({
        chatId: isNaN(Number(toChatId)) ? toChatId : Number(toChatId),
        fromChatId: isNaN(Number(fromChatId)) ? fromChatId : Number(fromChatId),
        messageId: Number(messageId),
        disableNotification: opts.silent,
      });
      success(`Message forwarded (ID: ${message.message_id})`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('delete <chatId> <messageId>')
  .description('Delete a message')
  .action(async (chatId: string, messageId: string) => {
    try {
      const client = getClient();
      await client.messages.deleteMessage({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
        messageId: Number(messageId),
      });
      success('Message deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('edit <chatId> <messageId> <text>')
  .description('Edit a message text')
  .option('--parse-mode <mode>', 'Parse mode (HTML, Markdown, MarkdownV2)')
  .action(async (chatId: string, messageId: string, text: string, opts: { parseMode?: string }) => {
    try {
      const client = getClient();
      await client.messages.editMessageText({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
        messageId: Number(messageId),
        text,
        parseMode: opts.parseMode as 'HTML' | 'Markdown' | 'MarkdownV2' | undefined,
      });
      success('Message edited');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('send-location <chatId> <latitude> <longitude>')
  .description('Send a location')
  .option('--silent', 'Send without notification')
  .action(async (chatId: string, latitude: string, longitude: string, opts: { silent?: boolean }) => {
    try {
      const client = getClient();
      const message = await client.messages.sendLocation({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
        latitude: Number(latitude),
        longitude: Number(longitude),
        disableNotification: opts.silent,
      });
      success(`Location sent (ID: ${message.message_id})`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('send-poll <chatId> <question>')
  .description('Send a poll')
  .requiredOption('-o, --options <options>', 'Poll options (comma-separated)')
  .option('--anonymous', 'Make poll anonymous')
  .option('--silent', 'Send without notification')
  .action(async (chatId: string, question: string, opts: { options: string; anonymous?: boolean; silent?: boolean }) => {
    try {
      const client = getClient();
      const message = await client.messages.sendPoll({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
        question,
        options: opts.options.split(',').map((o: string) => o.trim()),
        isAnonymous: opts.anonymous,
        disableNotification: opts.silent,
      });
      success(`Poll sent (ID: ${message.message_id})`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Updates Commands
// ============================================
program
  .command('updates')
  .description('Get recent updates (messages, etc.)')
  .option('-l, --limit <number>', 'Maximum number of updates', '10')
  .option('-o, --offset <number>', 'Offset for updates')
  .option('-t, --timeout <number>', 'Long polling timeout in seconds')
  .action(async (opts: { limit: string; offset?: string; timeout?: string }) => {
    try {
      const client = getClient();
      const updates = await client.updates.getUpdates({
        limit: parseInt(opts.limit),
        offset: opts.offset ? parseInt(opts.offset) : undefined,
        timeout: opts.timeout ? parseInt(opts.timeout) : undefined,
      });

      if (updates.length === 0) {
        info('No updates available');
        return;
      }

      // Format updates for display
      const formatted = updates.map(u => {
        const result: Record<string, unknown> = {
          update_id: u.update_id,
        };

        if (u.message) {
          result.type = 'message';
          result.from = u.message.from?.username || u.message.from?.first_name || 'unknown';
          result.chat_id = u.message.chat.id;
          result.text = u.message.text || '[media]';
          result.date = new Date(u.message.date * 1000).toISOString();
        } else if (u.callback_query) {
          result.type = 'callback_query';
          result.from = u.callback_query.from.username || u.callback_query.from.first_name;
          result.data = u.callback_query.data;
        } else if (u.inline_query) {
          result.type = 'inline_query';
          result.from = u.inline_query.from.username || u.inline_query.from.first_name;
          result.query = u.inline_query.query;
        } else if (u.edited_message) {
          result.type = 'edited_message';
          result.chat_id = u.edited_message.chat.id;
        } else if (u.channel_post) {
          result.type = 'channel_post';
          result.chat_id = u.channel_post.chat.id;
        }

        return result;
      });

      print(formatted, getFormat(program));
      info(`Showing ${updates.length} update(s). Last update_id: ${updates[updates.length - 1].update_id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Chat Commands
// ============================================
program
  .command('chat <chatId>')
  .description('Get chat information')
  .action(async (chatId: string) => {
    try {
      const client = getClient();
      const chat = await client.chats.getChat({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
      });
      print(chat, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('chat-members <chatId>')
  .description('Get chat member count')
  .action(async (chatId: string) => {
    try {
      const client = getClient();
      const count = await client.chats.getChatMemberCount({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
      });
      success(`Chat has ${count} member(s)`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('chat-admins <chatId>')
  .description('Get chat administrators')
  .action(async (chatId: string) => {
    try {
      const client = getClient();
      const admins = await client.chats.getChatAdministrators({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
      });

      const formatted = admins.map(a => ({
        user_id: a.user.id,
        username: a.user.username || a.user.first_name,
        status: a.status,
        is_anonymous: a.is_anonymous,
        custom_title: a.custom_title,
      }));

      print(formatted, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('chat-leave <chatId>')
  .description('Leave a chat')
  .action(async (chatId: string) => {
    try {
      const client = getClient();
      await client.chats.leaveChat({
        chatId: isNaN(Number(chatId)) ? chatId : Number(chatId),
      });
      success('Left chat');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Webhook Commands
// ============================================
const webhookCmd = program
  .command('webhook')
  .description('Manage webhooks');

webhookCmd
  .command('info')
  .description('Get webhook information')
  .action(async () => {
    try {
      const client = getClient();
      const info = await client.updates.getWebhookInfo();
      print(info, getFormat(webhookCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhookCmd
  .command('set <url>')
  .description('Set webhook URL')
  .option('--max-connections <number>', 'Maximum allowed connections')
  .option('--drop-pending', 'Drop pending updates')
  .option('--secret-token <token>', 'Secret token for verification')
  .action(async (url: string, opts: { maxConnections?: string; dropPending?: boolean; secretToken?: string }) => {
    try {
      const client = getClient();
      await client.updates.setWebhook({
        url,
        maxConnections: opts.maxConnections ? parseInt(opts.maxConnections) : undefined,
        dropPendingUpdates: opts.dropPending,
        secretToken: opts.secretToken,
      });
      success(`Webhook set to: ${url}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhookCmd
  .command('delete')
  .description('Delete webhook and switch to long polling')
  .option('--drop-pending', 'Drop pending updates')
  .action(async (opts: { dropPending?: boolean }) => {
    try {
      const client = getClient();
      await client.updates.deleteWebhook({
        dropPendingUpdates: opts.dropPending,
      });
      success('Webhook deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Commands management
// ============================================
const commandsCmd = program
  .command('commands')
  .description('Manage bot commands');

commandsCmd
  .command('list')
  .description('List bot commands')
  .action(async () => {
    try {
      const client = getClient();
      const commands = await client.bot.getMyCommands();

      if (commands.length === 0) {
        info('No commands configured');
        return;
      }

      print(commands, getFormat(commandsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commandsCmd
  .command('set <commandsJson>')
  .description('Set bot commands (JSON array: [{"command":"start","description":"Start the bot"}])')
  .action(async (commandsJson: string) => {
    try {
      const commands = JSON.parse(commandsJson);
      const client = getClient();
      await client.bot.setMyCommands({ commands });
      success('Commands updated');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commandsCmd
  .command('clear')
  .description('Clear all bot commands')
  .action(async () => {
    try {
      const client = getClient();
      await client.bot.deleteMyCommands();
      success('Commands cleared');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
