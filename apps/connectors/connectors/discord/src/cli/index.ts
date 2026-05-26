#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Discord } from '../api';
import {
  getBotToken,
  getApplicationId,
  setBotToken,
  setApplicationId,
  setDefaultGuildId,
  getDefaultGuildId,
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

const CONNECTOR_NAME = 'connect-discord';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Discord API connector CLI - Guilds, Channels, Messages, Webhooks, and more')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-g, --guild <guildId>', 'Default guild ID')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
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
function getClient(): Discord {
  const botToken = getBotToken();
  const applicationId = getApplicationId();

  if (!botToken) {
    error(`No Discord bot token configured. Run "${CONNECTOR_NAME} config set-token" or set DISCORD_BOT_TOKEN environment variable.`);
    process.exit(1);
  }

  return new Discord({ botToken, applicationId });
}

// Helper to get guild ID
function getGuildId(cmd: Command, provided?: string): string {
  const guildId = provided || cmd.parent?.opts().guild || getDefaultGuildId();
  if (!guildId) {
    error('Guild ID is required. Use --guild flag, set default with "config set-guild", or set DISCORD_GUILD_ID.');
    process.exit(1);
  }
  return guildId;
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
  .option('--token <token>', 'Discord bot token')
  .option('--app-id <appId>', 'Discord application ID')
  .option('--guild <guildId>', 'Default guild ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      botToken: opts.token,
      applicationId: opts.appId,
      defaultGuildId: opts.guild,
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
    info(`Bot Token: ${config.botToken ? `${config.botToken.substring(0, 20)}...` : chalk.gray('not set')}`);
    info(`Application ID: ${config.applicationId || chalk.gray('not set')}`);
    info(`Default Guild ID: ${config.defaultGuildId || chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set Discord bot token')
  .action((token: string) => {
    setBotToken(token);
    success(`Bot token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-app-id <appId>')
  .description('Set Discord application ID')
  .action((appId: string) => {
    setApplicationId(appId);
    success(`Application ID set to: ${appId}`);
  });

configCmd
  .command('set-guild <guildId>')
  .description('Set default guild ID')
  .action((guildId: string) => {
    setDefaultGuildId(guildId);
    success(`Default guild ID set to: ${guildId}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const botToken = getBotToken();
    const applicationId = getApplicationId();
    const guildId = getDefaultGuildId();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Bot Token: ${botToken ? `${botToken.substring(0, 20)}...` : chalk.gray('not set')}`);
    info(`Application ID: ${applicationId || chalk.gray('not set')}`);
    info(`Default Guild ID: ${guildId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .description('User operations');

userCmd
  .command('me')
  .description('Get current user (bot) info')
  .action(async () => {
    try {
      const client = getClient();
      const user = await client.users.me();
      print(user, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('get <userId>')
  .description('Get a user by ID')
  .action(async (userId: string) => {
    try {
      const client = getClient();
      const user = await client.users.get(userId);
      print(user, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

userCmd
  .command('guilds')
  .description('List guilds the bot is in')
  .option('-n, --limit <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = getClient();
      const guilds = await client.users.getGuilds({
        limit: parseInt(opts.limit),
        with_counts: true,
      });
      print(guilds, getFormat(userCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Guild Commands
// ============================================
const guildCmd = program
  .command('guild')
  .description('Guild (server) operations');

guildCmd
  .command('get [guildId]')
  .description('Get guild info')
  .action(async (guildId?: string) => {
    try {
      const client = getClient();
      const id = getGuildId(guildCmd, guildId);
      const guild = await client.guilds.get(id, true);
      print(guild, getFormat(guildCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

guildCmd
  .command('channels [guildId]')
  .description('List guild channels')
  .action(async (guildId?: string) => {
    try {
      const client = getClient();
      const id = getGuildId(guildCmd, guildId);
      const channels = await client.guilds.getChannels(id);
      const simplified = channels.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        position: c.position,
        parent_id: c.parent_id,
      }));
      print(simplified, getFormat(guildCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

guildCmd
  .command('roles [guildId]')
  .description('List guild roles')
  .action(async (guildId?: string) => {
    try {
      const client = getClient();
      const id = getGuildId(guildCmd, guildId);
      const roles = await client.guilds.getRoles(id);
      const simplified = roles.map(r => ({
        id: r.id,
        name: r.name,
        color: r.color,
        position: r.position,
        mentionable: r.mentionable,
        managed: r.managed,
      }));
      print(simplified, getFormat(guildCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

guildCmd
  .command('members [guildId]')
  .description('List guild members')
  .option('-n, --limit <number>', 'Maximum results', '100')
  .action(async (guildId: string | undefined, opts) => {
    try {
      const client = getClient();
      const id = getGuildId(guildCmd, guildId);
      const members = await client.guilds.listMembers(id, {
        limit: parseInt(opts.limit),
      });
      const simplified = members.map(m => ({
        id: m.user?.id,
        username: m.user?.username,
        nick: m.nick,
        joined_at: m.joined_at,
        roles: m.roles.length,
      }));
      print(simplified, getFormat(guildCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

guildCmd
  .command('member <userId> [guildId]')
  .description('Get a specific guild member')
  .action(async (userId: string, guildId?: string) => {
    try {
      const client = getClient();
      const id = getGuildId(guildCmd, guildId);
      const member = await client.guilds.getMember(id, userId);
      print(member, getFormat(guildCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

guildCmd
  .command('search-members <query> [guildId]')
  .description('Search guild members')
  .option('-n, --limit <number>', 'Maximum results', '10')
  .action(async (query: string, guildId: string | undefined, opts) => {
    try {
      const client = getClient();
      const id = getGuildId(guildCmd, guildId);
      const members = await client.guilds.searchMembers(id, {
        query,
        limit: parseInt(opts.limit),
      });
      print(members, getFormat(guildCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

guildCmd
  .command('bans [guildId]')
  .description('List guild bans')
  .option('-n, --limit <number>', 'Maximum results', '100')
  .action(async (guildId: string | undefined, opts) => {
    try {
      const client = getClient();
      const id = getGuildId(guildCmd, guildId);
      const bans = await client.guilds.getBans(id, {
        limit: parseInt(opts.limit),
      });
      print(bans, getFormat(guildCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

guildCmd
  .command('emojis [guildId]')
  .description('List guild emojis')
  .action(async (guildId?: string) => {
    try {
      const client = getClient();
      const id = getGuildId(guildCmd, guildId);
      const emojis = await client.guilds.listEmojis(id);
      const simplified = emojis.map(e => ({
        id: e.id,
        name: e.name,
        animated: e.animated,
        available: e.available,
      }));
      print(simplified, getFormat(guildCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

guildCmd
  .command('invites [guildId]')
  .description('List guild invites')
  .action(async (guildId?: string) => {
    try {
      const client = getClient();
      const id = getGuildId(guildCmd, guildId);
      const invites = await client.guilds.getInvites(id);
      print(invites, getFormat(guildCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

guildCmd
  .command('webhooks [guildId]')
  .description('List guild webhooks')
  .action(async (guildId?: string) => {
    try {
      const client = getClient();
      const id = getGuildId(guildCmd, guildId);
      const webhooks = await client.guilds.getWebhooks(id);
      print(webhooks, getFormat(guildCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Channel Commands
// ============================================
const channelCmd = program
  .command('channel')
  .description('Channel operations');

channelCmd
  .command('get <channelId>')
  .description('Get channel info')
  .action(async (channelId: string) => {
    try {
      const client = getClient();
      const channel = await client.channels.get(channelId);
      print(channel, getFormat(channelCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelCmd
  .command('messages <channelId>')
  .description('Get channel messages')
  .option('-n, --limit <number>', 'Maximum results', '50')
  .option('--before <messageId>', 'Get messages before this ID')
  .option('--after <messageId>', 'Get messages after this ID')
  .action(async (channelId: string, opts) => {
    try {
      const client = getClient();
      const messages = await client.channels.getMessages(channelId, {
        limit: parseInt(opts.limit),
        before: opts.before,
        after: opts.after,
      });
      const simplified = messages.map(m => ({
        id: m.id,
        author: m.author.username,
        content: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : ''),
        timestamp: m.timestamp,
      }));
      print(simplified, getFormat(channelCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelCmd
  .command('send <channelId> <message>')
  .description('Send a message to a channel')
  .action(async (channelId: string, message: string) => {
    try {
      const client = getClient();
      const result = await client.channels.send(channelId, message);
      success(`Message sent (ID: ${result.id})`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelCmd
  .command('delete-message <channelId> <messageId>')
  .description('Delete a message')
  .action(async (channelId: string, messageId: string) => {
    try {
      const client = getClient();
      await client.channels.deleteMessage(channelId, messageId);
      success(`Message ${messageId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelCmd
  .command('pins <channelId>')
  .description('Get pinned messages')
  .action(async (channelId: string) => {
    try {
      const client = getClient();
      const pins = await client.channels.getPinnedMessages(channelId);
      print(pins, getFormat(channelCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelCmd
  .command('webhooks <channelId>')
  .description('Get channel webhooks')
  .action(async (channelId: string) => {
    try {
      const client = getClient();
      const webhooks = await client.channels.getWebhooks(channelId);
      print(webhooks, getFormat(channelCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelCmd
  .command('create-invite <channelId>')
  .description('Create a channel invite')
  .option('--max-age <seconds>', 'Max age in seconds (0 = never)', '86400')
  .option('--max-uses <number>', 'Max uses (0 = unlimited)', '0')
  .option('--temporary', 'Grant temporary membership')
  .action(async (channelId: string, opts) => {
    try {
      const client = getClient();
      const invite = await client.channels.createInvite(channelId, {
        max_age: parseInt(opts.maxAge),
        max_uses: parseInt(opts.maxUses),
        temporary: opts.temporary || false,
      });
      success(`Invite created: https://discord.gg/${invite.code}`);
      print(invite, getFormat(channelCmd));
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
  .description('Webhook operations');

webhookCmd
  .command('get <webhookId>')
  .description('Get a webhook by ID')
  .action(async (webhookId: string) => {
    try {
      const client = getClient();
      const webhook = await client.webhooks.get(webhookId);
      print(webhook, getFormat(webhookCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhookCmd
  .command('execute <webhookId> <token> <content>')
  .description('Execute a webhook')
  .option('--username <name>', 'Override username')
  .option('--avatar <url>', 'Override avatar URL')
  .option('--wait', 'Wait for message confirmation')
  .action(async (webhookId: string, token: string, content: string, opts) => {
    try {
      const client = getClient();
      const result = await client.webhooks.execute(
        webhookId,
        token,
        {
          content,
          username: opts.username,
          avatar_url: opts.avatar,
        },
        { wait: opts.wait }
      );
      if (opts.wait && result) {
        success(`Message sent (ID: ${(result as { id: string }).id})`);
      } else {
        success('Webhook executed');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webhookCmd
  .command('delete <webhookId>')
  .description('Delete a webhook')
  .action(async (webhookId: string) => {
    try {
      const client = getClient();
      await client.webhooks.delete(webhookId);
      success(`Webhook ${webhookId} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Invite Commands
// ============================================
const inviteCmd = program
  .command('invite')
  .description('Invite operations');

inviteCmd
  .command('get <code>')
  .description('Get invite info')
  .option('--with-counts', 'Include member counts')
  .action(async (code: string, opts) => {
    try {
      const client = getClient();
      const invite = await client.invites.get(code, {
        with_counts: opts.withCounts,
      });
      print(invite, getFormat(inviteCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

inviteCmd
  .command('delete <code>')
  .description('Delete an invite')
  .action(async (code: string) => {
    try {
      const client = getClient();
      await client.invites.delete(code);
      success(`Invite ${code} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Commands (Application Commands)
// ============================================
const commandsCmd = program
  .command('commands')
  .description('Application command operations');

commandsCmd
  .command('list')
  .description('List global application commands')
  .action(async () => {
    try {
      const client = getClient();
      const commands = await client.commands.getGlobalCommands();
      const simplified = commands.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        type: c.type,
      }));
      print(simplified, getFormat(commandsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commandsCmd
  .command('list-guild [guildId]')
  .description('List guild application commands')
  .action(async (guildId?: string) => {
    try {
      const client = getClient();
      const id = getGuildId(commandsCmd, guildId);
      const commands = await client.commands.getGuildCommands(id);
      const simplified = commands.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        type: c.type,
      }));
      print(simplified, getFormat(commandsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Gateway Commands
// ============================================
const gatewayCmd = program
  .command('gateway')
  .description('Gateway information');

gatewayCmd
  .command('info')
  .description('Get gateway info')
  .action(async () => {
    try {
      const client = getClient();
      const info = await client.gateway.getGatewayBot();
      print(info, getFormat(gatewayCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

gatewayCmd
  .command('regions')
  .description('List voice regions')
  .action(async () => {
    try {
      const client = getClient();
      const regions = await client.gateway.getVoiceRegions();
      print(regions, getFormat(gatewayCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
