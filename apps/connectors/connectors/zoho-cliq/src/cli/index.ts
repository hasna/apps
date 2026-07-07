#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoCliq } from '../api';
import type { OutputFormat } from '../types';
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getBaseUrl,
  getConfigDir,
  getCurrentProfile,
  getDataCenter,
  getToken,
  isAuthenticated,
  listProfiles,
  profileExists,
  setCurrentProfile,
  setDataCenter,
  setProfileOverride,
  setToken,
} from '../utils/config';
import { error, heading, info, print, success } from '../utils/output';

const program = new Command();

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoCliq {
  const token = getToken();
  if (!token) {
    error('No Zoho Cliq token configured.');
    console.error(chalk.yellow('Set token with: connect-zoho-cliq config set-token <token>'));
    console.error(chalk.yellow('Or set ZOHO_CLIQ_TOKEN environment variable'));
    process.exit(1);
  }

  return new ZohoCliq({
    token,
    dataCenter: getDataCenter(),
    baseUrl: getBaseUrl(),
  });
}

program
  .name('connect-zoho-cliq')
  .description('Zoho Cliq team chat and messaging API CLI')
  .version('0.0.1')
  .option('-p, --profile <name>', 'Use specific profile')
  .option('-f, --format <format>', 'Output format: json, table, pretty', 'pretty')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

const configCmd = program.command('config').description('Configuration commands');

configCmd
  .command('set-token <token>')
  .description('Set OAuth access token for current profile')
  .action((token: string) => {
    setToken(token);
    success(`Token saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-data-center <dc>')
  .description('Set data center (com, eu, in, com.au, jp, ca, sa)')
  .action((dc: string) => {
    setDataCenter(dc);
    success(`Data center set to "${dc}"`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    heading('Current Configuration');
    print({
      profile: getCurrentProfile(),
      authenticated: isAuthenticated(),
      token: getToken() ? `${getToken()!.substring(0, 8)}...` : 'Not set',
      dataCenter: getDataCenter(),
      configDir: getConfigDir(),
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
      info('No profiles found. Default profile will be created on first use.');
      return;
    }
    success('Profiles:');
    for (const name of profiles) {
      const active = name === current ? chalk.green(' (active)') : '';
      console.log(`  ${name}${active}`);
    }
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    createProfile(name);
    success(`Profile "${name}" created`);
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
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    if (name === 'default') {
      error('Cannot delete the default profile');
      process.exit(1);
    }
    deleteProfile(name);
    success(`Profile "${name}" deleted`);
  });

program
  .command('test')
  .description('Verify authentication (GET /users/me)')
  .action(async () => {
    try {
      const client = getClient();
      const me = await client.test();
      success('Authentication successful');
      print(me, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const usersCmd = program.command('users').description('User operations');

usersCmd
  .command('me')
  .description('Get current user')
  .action(async () => {
    try {
      print(await getClient().users.me(), getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('get <id>')
  .description('Get user by ID')
  .action(async (id: string) => {
    try {
      print(await getClient().users.get(id), getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('list')
  .description('List users')
  .option('--limit <n>', 'Limit', parseInt)
  .option('--offset <n>', 'Offset', parseInt)
  .option('--status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      print(
        await getClient().users.list({
          limit: opts.limit,
          offset: opts.offset,
          status: opts.status,
        }),
        getFormat(usersCmd)
      );
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('set-status <code>')
  .description('Set current user status (available|busy|invisible|offline)')
  .option('-m, --message <message>', 'Status message')
  .action(async (code: string, opts) => {
    try {
      print(await getClient().users.setStatus(code as 'available', opts.message), getFormat(usersCmd));
      success('Status updated');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('buddies')
  .description('List buddies')
  .option('--limit <n>', 'Limit', parseInt)
  .option('--offset <n>', 'Offset', parseInt)
  .action(async (opts) => {
    try {
      print(await getClient().buddies.list(opts), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const channelsCmd = program.command('channels').description('Channel operations');

channelsCmd
  .command('list')
  .description('List channels')
  .option('--limit <n>', 'Limit', parseInt)
  .option('--offset <n>', 'Offset', parseInt)
  .option('--type <type>', 'Channel type')
  .action(async (opts) => {
    try {
      print(await getClient().channels.list(opts), getFormat(channelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelsCmd
  .command('get <id>')
  .description('Get channel by ID')
  .action(async (id: string) => {
    try {
      print(await getClient().channels.get(id), getFormat(channelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelsCmd
  .command('create')
  .description('Create a channel')
  .requiredOption('-n, --name <name>', 'Channel name')
  .option('-d, --description <description>', 'Description')
  .option('--type <type>', 'Channel type')
  .action(async (opts) => {
    try {
      print(
        await getClient().channels.create({
          name: opts.name,
          description: opts.description,
          type: opts.type,
        }),
        getFormat(channelsCmd)
      );
      success('Channel created');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelsCmd
  .command('join <id>')
  .description('Join a channel')
  .action(async (id: string) => {
    try {
      print(await getClient().channels.join(id), getFormat(channelsCmd));
      success('Joined channel');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelsCmd
  .command('leave <id>')
  .description('Leave a channel')
  .action(async (id: string) => {
    try {
      print(await getClient().channels.leave(id), getFormat(channelsCmd));
      success('Left channel');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const messagesCmd = program.command('messages').description('Message operations');

messagesCmd
  .command('send-channel <channelName> <text>')
  .description('Send message to channel by name')
  .action(async (channelName: string, text: string) => {
    try {
      print(await getClient().messages.sendToChannelByName(channelName, { text }), getFormat(messagesCmd));
      success('Message sent');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('send-chat <chatId> <text>')
  .description('Send message to chat')
  .action(async (chatId: string, text: string) => {
    try {
      print(await getClient().messages.sendToChat(chatId, { text }), getFormat(messagesCmd));
      success('Message sent');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('list <chatId>')
  .description('List messages in a chat')
  .option('--limit <n>', 'Limit', parseInt)
  .option('--from <id>', 'Start from message ID')
  .action(async (chatId: string, opts) => {
    try {
      print(await getClient().messages.list(chatId, opts), getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const chatsCmd = program.command('chats').description('Chat operations');

chatsCmd
  .command('list')
  .description('List chats')
  .option('--limit <n>', 'Limit', parseInt)
  .option('--offset <n>', 'Offset', parseInt)
  .option('--type <type>', 'Chat type')
  .action(async (opts) => {
    try {
      print(await getClient().chats.list(opts), getFormat(chatsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

chatsCmd
  .command('get <id>')
  .description('Get chat by ID')
  .action(async (id: string) => {
    try {
      print(await getClient().chats.get(id), getFormat(chatsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('bots')
  .description('List bots')
  .action(async () => {
    try {
      print(await getClient().bots.list(), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('departments')
  .description('List organization departments')
  .action(async () => {
    try {
      print(await getClient().departments.list(), getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
