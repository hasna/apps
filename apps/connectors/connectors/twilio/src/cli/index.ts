#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Twilio } from '../api';
import {
  getAccountSid,
  setAccountSid,
  getAuthToken,
  setAuthToken,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadConfig,
  initConfigDir,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-twilio';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Twilio API connector CLI')
  .version(VERSION)
  .option('-s, --account-sid <sid>', 'Account SID (overrides config)')
  .option('-t, --auth-token <token>', 'Auth Token (overrides config)')
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
    // Set credentials from flags if provided
    if (opts.accountSid) {
      process.env.TWILIO_ACCOUNT_SID = opts.accountSid;
    }
    if (opts.authToken) {
      process.env.TWILIO_AUTH_TOKEN = opts.authToken;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Twilio {
  const accountSid = getAccountSid();
  const authToken = getAuthToken();

  if (!accountSid) {
    error(`No Account SID configured. Run "${CONNECTOR_NAME} config set-account-sid <sid>" or set TWILIO_ACCOUNT_SID environment variable.`);
    process.exit(1);
  }
  if (!authToken) {
    error(`No Auth Token configured. Run "${CONNECTOR_NAME} config set-auth-token <token>" or set TWILIO_AUTH_TOKEN environment variable.`);
    process.exit(1);
  }

  return new Twilio({ accountSid, authToken });
}

// ============================================
// Init Command
// ============================================
program
  .command('init')
  .description('Initialize configuration directory')
  .action(() => {
    const result = initConfigDir();

    if (result.created.length === 0) {
      info('Configuration directory already initialized.');
      console.log(`  ${chalk.blue('Location:')} ${getConfigDir()}`);
    } else {
      success('Configuration directory initialized:');
      result.created.forEach(path => {
        console.log(`  ${chalk.green('+')} ${path}`);
      });
    }
  });

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
  .option('--account-sid <sid>', 'Account SID')
  .option('--auth-token <token>', 'Auth Token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    try {
      createProfile(name);
      success(`Profile "${name}" created`);

      // Set credentials if provided
      if (opts.accountSid || opts.authToken) {
        setProfileOverride(name);
        if (opts.accountSid) {
          setAccountSid(opts.accountSid);
        }
        if (opts.authToken) {
          setAuthToken(opts.authToken);
        }
        setProfileOverride(undefined);
      }

      if (opts.use) {
        setCurrentProfile(name);
        info(`Switched to profile: ${name}`);
      }
    } catch (err) {
      error(String(err));
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
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profileCmd
  .command('show [name]')
  .description('Show profile configuration')
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();

    if (name && !profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }

    setProfileOverride(name);
    const config = loadConfig();
    const active = getCurrentProfile();
    setProfileOverride(undefined);

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Account SID: ${config.accountSid ? `${config.accountSid.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Auth Token: ${config.authToken ? `${config.authToken.substring(0, 4)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-account-sid <accountSid>')
  .description('Set Account SID')
  .action((accountSid: string) => {
    if (!accountSid.startsWith('AC')) {
      warn('Account SID typically starts with "AC"');
    }
    setAccountSid(accountSid);
    success(`Account SID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-auth-token <authToken>')
  .description('Set Auth Token')
  .action((authToken: string) => {
    setAuthToken(authToken);
    success(`Auth Token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accountSid = getAccountSid();
    const authToken = getAuthToken();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Account SID: ${accountSid ? `${accountSid.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Auth Token: ${authToken ? `${authToken.substring(0, 4)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Messages Commands
// ============================================
const messagesCmd = program
  .command('messages')
  .description('SMS/MMS messages');

messagesCmd
  .command('send')
  .description('Send an SMS or MMS message')
  .requiredOption('--to <phone>', 'Recipient phone number (E.164 format)')
  .option('--from <phone>', 'Sender phone number')
  .option('--messaging-service-sid <sid>', 'Messaging Service SID')
  .option('--body <text>', 'Message body')
  .option('--media-url <url>', 'Media URL for MMS')
  .action(async (opts) => {
    try {
      if (!opts.from && !opts.messagingServiceSid) {
        error('Either --from or --messaging-service-sid is required');
        process.exit(1);
      }
      if (!opts.body && !opts.mediaUrl) {
        error('Either --body or --media-url is required');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.messages.send({
        To: opts.to,
        From: opts.from,
        MessagingServiceSid: opts.messagingServiceSid,
        Body: opts.body,
        MediaUrl: opts.mediaUrl ? [opts.mediaUrl] : undefined,
      });

      success('Message sent!');
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('list')
  .description('List messages')
  .option('--to <phone>', 'Filter by recipient')
  .option('--from <phone>', 'Filter by sender')
  .option('--date-sent <date>', 'Filter by date sent (YYYY-MM-DD)')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.messages.list({
        To: opts.to,
        From: opts.from,
        DateSent: opts.dateSent,
        PageSize: parseInt(opts.limit),
      });

      print(result.messages, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('get <sid>')
  .description('Get a message by SID')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      const result = await client.messages.get(sid);
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command('delete <sid>')
  .description('Delete a message')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      await client.messages.delete(sid);
      success('Message deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Calls Commands
// ============================================
const callsCmd = program
  .command('calls')
  .description('Voice calls');

callsCmd
  .command('make')
  .description('Make an outbound call')
  .requiredOption('--to <phone>', 'Recipient phone number')
  .requiredOption('--from <phone>', 'Caller ID phone number')
  .option('--url <url>', 'TwiML URL')
  .option('--twiml <xml>', 'TwiML instructions')
  .action(async (opts) => {
    try {
      if (!opts.url && !opts.twiml) {
        error('Either --url or --twiml is required');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.calls.create({
        To: opts.to,
        From: opts.from,
        Url: opts.url,
        Twiml: opts.twiml,
      });

      success('Call initiated!');
      print(result, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd
  .command('list')
  .description('List calls')
  .option('--to <phone>', 'Filter by recipient')
  .option('--from <phone>', 'Filter by caller')
  .option('--status <status>', 'Filter by status')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.calls.list({
        To: opts.to,
        From: opts.from,
        Status: opts.status,
        PageSize: parseInt(opts.limit),
      });

      print(result.calls, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd
  .command('get <sid>')
  .description('Get a call by SID')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      const result = await client.calls.get(sid);
      print(result, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd
  .command('cancel <sid>')
  .description('Cancel a queued call')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      const result = await client.calls.cancel(sid);
      success('Call canceled');
      print(result, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd
  .command('complete <sid>')
  .description('Complete (hang up) an in-progress call')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      const result = await client.calls.complete(sid);
      success('Call completed');
      print(result, getFormat(callsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

callsCmd
  .command('delete <sid>')
  .description('Delete a call record')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      await client.calls.delete(sid);
      success('Call record deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Numbers Commands
// ============================================
const numbersCmd = program
  .command('numbers')
  .description('Phone numbers');

numbersCmd
  .command('list')
  .description('List owned phone numbers')
  .option('--phone-number <number>', 'Filter by phone number')
  .option('--friendly-name <name>', 'Filter by friendly name')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.numbers.list({
        PhoneNumber: opts.phoneNumber,
        FriendlyName: opts.friendlyName,
        PageSize: parseInt(opts.limit),
      });

      print(result.incoming_phone_numbers, getFormat(numbersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

numbersCmd
  .command('get <sid>')
  .description('Get a phone number by SID')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      const result = await client.numbers.get(sid);
      print(result, getFormat(numbersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

numbersCmd
  .command('search')
  .description('Search for available phone numbers')
  .requiredOption('--country <code>', 'Country code (e.g., US)')
  .option('--type <type>', 'Number type: local, toll-free, mobile', 'local')
  .option('--area-code <code>', 'Area code')
  .option('--contains <pattern>', 'Number pattern to match')
  .option('--sms', 'SMS enabled')
  .option('--mms', 'MMS enabled')
  .option('--voice', 'Voice enabled')
  .option('-n, --limit <number>', 'Maximum results', '10')
  .action(async (opts) => {
    try {
      const client = getClient();
      const params = {
        AreaCode: opts.areaCode,
        Contains: opts.contains,
        SmsEnabled: opts.sms,
        MmsEnabled: opts.mms,
        VoiceEnabled: opts.voice,
        PageSize: parseInt(opts.limit),
      };

      let result;
      switch (opts.type) {
        case 'toll-free':
          result = await client.numbers.searchTollFree(opts.country, params);
          break;
        case 'mobile':
          result = await client.numbers.searchMobile(opts.country, params);
          break;
        default:
          result = await client.numbers.searchLocal(opts.country, params);
      }

      print(result.available_phone_numbers, getFormat(numbersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

numbersCmd
  .command('buy')
  .description('Buy a phone number')
  .option('--phone-number <number>', 'Specific phone number to buy')
  .option('--area-code <code>', 'Area code (alternative to specific number)')
  .option('--friendly-name <name>', 'Friendly name')
  .action(async (opts) => {
    try {
      if (!opts.phoneNumber && !opts.areaCode) {
        error('Either --phone-number or --area-code is required');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.numbers.buy({
        PhoneNumber: opts.phoneNumber,
        AreaCode: opts.areaCode,
        FriendlyName: opts.friendlyName,
      });

      success('Phone number purchased!');
      print(result, getFormat(numbersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

numbersCmd
  .command('update <sid>')
  .description('Update a phone number')
  .option('--friendly-name <name>', 'Friendly name')
  .option('--sms-url <url>', 'SMS webhook URL')
  .option('--voice-url <url>', 'Voice webhook URL')
  .action(async (sid: string, opts) => {
    try {
      const client = getClient();
      const result = await client.numbers.update(sid, {
        FriendlyName: opts.friendlyName,
        SmsUrl: opts.smsUrl,
        VoiceUrl: opts.voiceUrl,
      });

      success('Phone number updated');
      print(result, getFormat(numbersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

numbersCmd
  .command('release <sid>')
  .description('Release (delete) a phone number')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      await client.numbers.release(sid);
      success('Phone number released');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Verify Commands
// ============================================
const verifyCmd = program
  .command('verify')
  .description('2FA verification');

verifyCmd
  .command('services')
  .description('List Verify services')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.verify.listServices({
        PageSize: parseInt(opts.limit),
      });

      print(result.services, getFormat(verifyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

verifyCmd
  .command('create-service')
  .description('Create a Verify service')
  .requiredOption('--name <name>', 'Service friendly name')
  .option('--code-length <length>', 'Verification code length', '6')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.verify.createService({
        FriendlyName: opts.name,
        CodeLength: parseInt(opts.codeLength),
      });

      success('Verify service created!');
      print(result, getFormat(verifyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

verifyCmd
  .command('send')
  .description('Send a verification code')
  .requiredOption('--service <sid>', 'Verify Service SID')
  .requiredOption('--to <phone>', 'Recipient phone number or email')
  .option('--channel <channel>', 'Channel: sms, call, email, whatsapp', 'sms')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.verify.create(opts.service, {
        To: opts.to,
        Channel: opts.channel,
      });

      success('Verification code sent!');
      print(result, getFormat(verifyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

verifyCmd
  .command('check')
  .description('Check a verification code')
  .requiredOption('--service <sid>', 'Verify Service SID')
  .requiredOption('--to <phone>', 'Recipient phone number or email')
  .requiredOption('--code <code>', 'Verification code')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.verify.check(opts.service, {
        To: opts.to,
        Code: opts.code,
      });

      if (result.valid) {
        success('Verification successful!');
      } else {
        warn('Verification failed');
      }
      print(result, getFormat(verifyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Conversations Commands
// ============================================
const conversationsCmd = program
  .command('conversations')
  .description('Conversations API');

conversationsCmd
  .command('list')
  .description('List conversations')
  .option('--state <state>', 'Filter by state: active, inactive, closed')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.conversations.list({
        State: opts.state,
        PageSize: parseInt(opts.limit),
      });

      print(result.conversations, getFormat(conversationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationsCmd
  .command('create')
  .description('Create a conversation')
  .option('--friendly-name <name>', 'Friendly name')
  .option('--unique-name <name>', 'Unique name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.conversations.create({
        FriendlyName: opts.friendlyName,
        UniqueName: opts.uniqueName,
      });

      success('Conversation created!');
      print(result, getFormat(conversationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationsCmd
  .command('get <sid>')
  .description('Get a conversation by SID')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      const result = await client.conversations.get(sid);
      print(result, getFormat(conversationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationsCmd
  .command('close <sid>')
  .description('Close a conversation')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      const result = await client.conversations.close(sid);
      success('Conversation closed');
      print(result, getFormat(conversationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationsCmd
  .command('delete <sid>')
  .description('Delete a conversation')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      await client.conversations.delete(sid);
      success('Conversation deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationsCmd
  .command('send-message <conversationSid>')
  .description('Send a message to a conversation')
  .requiredOption('--body <text>', 'Message body')
  .option('--author <author>', 'Message author')
  .action(async (conversationSid: string, opts) => {
    try {
      const client = getClient();
      const result = await client.conversations.sendMessage(conversationSid, {
        Body: opts.body,
        Author: opts.author,
      });

      success('Message sent!');
      print(result, getFormat(conversationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

conversationsCmd
  .command('list-messages <conversationSid>')
  .description('List messages in a conversation')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .action(async (conversationSid: string, opts) => {
    try {
      const client = getClient();
      const result = await client.conversations.listMessages(conversationSid, {
        PageSize: parseInt(opts.limit),
      });

      print(result.messages, getFormat(conversationsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Video Commands
// ============================================
const videoCmd = program
  .command('video')
  .description('Video rooms');

videoCmd
  .command('list')
  .description('List video rooms')
  .option('--status <status>', 'Filter by status: in-progress, completed')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.video.list({
        Status: opts.status,
        PageSize: parseInt(opts.limit),
      });

      print(result.rooms, getFormat(videoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videoCmd
  .command('create')
  .description('Create a video room')
  .option('--name <name>', 'Unique room name')
  .option('--type <type>', 'Room type: go, peer-to-peer, group, group-small', 'group')
  .option('--max-participants <number>', 'Maximum participants')
  .option('--record', 'Record participants on connect')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.video.create({
        UniqueName: opts.name,
        Type: opts.type,
        MaxParticipants: opts.maxParticipants ? parseInt(opts.maxParticipants) : undefined,
        RecordParticipantsOnConnect: opts.record,
      });

      success('Video room created!');
      print(result, getFormat(videoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videoCmd
  .command('get <sid>')
  .description('Get a video room by SID')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      const result = await client.video.get(sid);
      print(result, getFormat(videoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videoCmd
  .command('complete <sid>')
  .description('Complete (end) a video room')
  .action(async (sid: string) => {
    try {
      const client = getClient();
      const result = await client.video.complete(sid);
      success('Video room completed');
      print(result, getFormat(videoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Lookup Commands
// ============================================
const lookupCmd = program
  .command('lookup')
  .description('Phone number lookup');

lookupCmd
  .command('number <phoneNumber>')
  .description('Look up a phone number')
  .option('--fields <fields>', 'Fields to return (comma-separated)')
  .option('--country <code>', 'Country code for parsing')
  .action(async (phoneNumber: string, opts) => {
    try {
      const client = getClient();
      const result = await client.lookup.lookup(phoneNumber, {
        Fields: opts.fields,
        CountryCode: opts.country,
      });

      print(result, getFormat(lookupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

lookupCmd
  .command('validate <phoneNumber>')
  .description('Validate a phone number')
  .option('--country <code>', 'Country code for parsing')
  .action(async (phoneNumber: string, opts) => {
    try {
      const client = getClient();
      const result = await client.lookup.validate(phoneNumber, opts.country);

      if (result.valid) {
        success('Phone number is valid');
      } else {
        warn('Phone number is invalid');
      }
      print(result, getFormat(lookupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

lookupCmd
  .command('carrier <phoneNumber>')
  .description('Get carrier information')
  .action(async (phoneNumber: string) => {
    try {
      const client = getClient();
      const result = await client.lookup.getLineType(phoneNumber);
      print(result, getFormat(lookupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

lookupCmd
  .command('caller-name <phoneNumber>')
  .description('Get caller name (CNAM)')
  .action(async (phoneNumber: string) => {
    try {
      const client = getClient();
      const result = await client.lookup.getCallerName(phoneNumber);
      print(result, getFormat(lookupCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Account Commands
// ============================================
const accountCmd = program
  .command('account')
  .description('Account management');

accountCmd
  .command('info')
  .description('Get account information')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.accounts.get();
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('balance')
  .description('Get account balance')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.accounts.getBalance();
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('usage')
  .description('Get account usage')
  .option('--category <category>', 'Filter by category')
  .option('--start-date <date>', 'Start date (YYYY-MM-DD)')
  .option('--end-date <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.getUsage({
        Category: opts.category,
        StartDate: opts.startDate,
        EndDate: opts.endDate,
      });

      print(result.usage_records, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('subaccounts')
  .description('List subaccounts')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.listSubAccounts({
        PageSize: parseInt(opts.limit),
      });

      print(result.accounts, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

accountCmd
  .command('create-subaccount')
  .description('Create a subaccount')
  .option('--name <name>', 'Friendly name')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.accounts.createSubAccount({
        FriendlyName: opts.name,
      });

      success('Subaccount created!');
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
