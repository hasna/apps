#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Telnyx } from '../api';
import { TelnyxApiError } from '../types';
import {
  getApiKey,
  setApiKey,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  initConfigDir,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-telnyx';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Telnyx API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Telnyx API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.TELNYX_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  let node: Command | null = cmd;
  while (node) {
    const fmt = node.opts().format;
    if (fmt) return fmt as OutputFormat;
    node = node.parent;
  }
  return 'pretty';
}

// Helper to get authenticated client
function getClient(): Telnyx {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-api-key <key>" or set TELNYX_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Telnyx({ apiKey });
}

// Helper to run an API call and print the result
async function run(cmd: Command, fn: (client: Telnyx) => Promise<unknown>): Promise<void> {
  try {
    const client = getClient();
    const result = await fn(client);
    print(result, getFormat(cmd));
  } catch (err) {
    if (err instanceof TelnyxApiError) {
      error(`${err.message} (HTTP ${err.status}${err.code ? `, code ${err.code}` : ''})`);
    } else {
      error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
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
      result.created.forEach(path => console.log(`  ${chalk.green('+')} ${path}`));
    }
  });

// ============================================
// Profile Commands
// ============================================
const profileCmd = program.command('profile').description('Manage configuration profiles');

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
    success('Profiles:');
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
  .option('--api-key <key>', 'Telnyx API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    try {
      createProfile(name);
      success(`Profile "${name}" created`);
      if (opts.apiKey) {
        setProfileOverride(name);
        setApiKey(opts.apiKey);
        setProfileOverride(undefined);
      }
      if (opts.use) {
        setCurrentProfile(name);
        success(`Switched to profile: ${name}`);
      }
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
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
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

profileCmd
  .command('show')
  .description('Show the current profile')
  .action(() => {
    info(`Current profile: ${getCurrentProfile()}`);
    console.log(`  ${chalk.blue('Config:')} ${getConfigDir()}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage credentials');

configCmd
  .command('set-api-key <key>')
  .description('Set the Telnyx API key')
  .action((key: string) => {
    setApiKey(key);
    success('API key saved');
  });

configCmd
  .command('show')
  .description('Show current configuration (API key masked)')
  .action(() => {
    const apiKey = getApiKey();
    if (!apiKey) {
      info('No API key configured.');
      return;
    }
    const masked = apiKey.length > 10 ? `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}` : '***';
    success('Configuration:');
    console.log(`  ${chalk.blue('Profile:')} ${getCurrentProfile()}`);
    console.log(`  ${chalk.blue('API key:')} ${masked}`);
  });

configCmd
  .command('clear')
  .description('Clear the stored credentials for the current profile')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// Message Commands
// ============================================
const messageCmd = program.command('message').description('Send and retrieve messages');

messageCmd
  .command('send')
  .description('Send an SMS or MMS message')
  .requiredOption('-t, --to <number>', 'Recipient phone number (E.164)')
  .option('-F, --from <number>', 'Sender phone number (E.164)')
  .option('-b, --body <text>', 'Message text')
  .option('-m, --messaging-profile-id <id>', 'Messaging profile ID (for alphanumeric sender)')
  .option('-s, --subject <subject>', 'Subject line (MMS)')
  .option('--media-url <url...>', 'Media URL(s) for MMS')
  .action((opts, cmd) =>
    run(cmd, client =>
      client.messages.send({
        to: opts.to,
        from: opts.from,
        text: opts.body,
        messaging_profile_id: opts.messagingProfileId,
        subject: opts.subject,
        media_urls: opts.mediaUrl,
      })
    )
  );

messageCmd
  .command('get <id>')
  .description('Retrieve a message by ID')
  .action((id: string, _opts, cmd) => run(cmd, client => client.messages.get(id)));

// ============================================
// Numbers Commands
// ============================================
const numbersCmd = program.command('numbers').description('Manage and search phone numbers');

numbersCmd
  .command('list')
  .description('List phone numbers owned by the account')
  .option('--status <status>', 'Filter by status')
  .option('--tag <tag>', 'Filter by tag')
  .option('--number <number>', 'Filter by phone number')
  .option('--page <n>', 'Page number', (v) => parseInt(v, 10))
  .option('--page-size <n>', 'Page size', (v) => parseInt(v, 10))
  .action((opts, cmd) =>
    run(cmd, client =>
      client.phoneNumbers.list({
        status: opts.status,
        tag: opts.tag,
        phone_number: opts.number,
        page_number: opts.page,
        page_size: opts.pageSize,
      })
    )
  );

numbersCmd
  .command('get <id>')
  .description('Retrieve an owned phone number by ID')
  .action((id: string, _opts, cmd) => run(cmd, client => client.phoneNumbers.get(id)));

numbersCmd
  .command('search')
  .description('Search for available phone numbers to purchase')
  .requiredOption('-c, --country-code <code>', 'Country code (e.g. US)')
  .option('--starts-with <digits>', 'Number starts with')
  .option('--ends-with <digits>', 'Number ends with')
  .option('--contains <digits>', 'Number contains')
  .option('--locality <city>', 'Filter by city/locality')
  .option('--administrative-area <area>', 'Filter by state/province')
  .option('--national-destination-code <ndc>', 'Filter by area code (NANP)')
  .option('--type <type>', 'Phone number type (local, toll_free, mobile, ...)')
  .option('--feature <feature...>', 'Required feature(s): sms, mms, voice, fax, emergency')
  .option('--limit <n>', 'Max results', (v) => parseInt(v, 10))
  .action((opts, cmd) =>
    run(cmd, client =>
      client.availableNumbers.search({
        country_code: opts.countryCode,
        starts_with: opts.startsWith,
        ends_with: opts.endsWith,
        contains: opts.contains,
        locality: opts.locality,
        administrative_area: opts.administrativeArea,
        national_destination_code: opts.nationalDestinationCode,
        phone_number_type: opts.type,
        features: opts.feature,
        limit: opts.limit,
      })
    )
  );

// ============================================
// Messaging Profile Commands
// ============================================
const profilesCmd = program.command('profiles').description('Manage messaging profiles');

profilesCmd
  .command('list')
  .description('List messaging profiles')
  .option('--name <name>', 'Filter by name')
  .option('--page <n>', 'Page number', (v) => parseInt(v, 10))
  .option('--page-size <n>', 'Page size', (v) => parseInt(v, 10))
  .action((opts, cmd) =>
    run(cmd, client =>
      client.messagingProfiles.list({
        name: opts.name,
        page_number: opts.page,
        page_size: opts.pageSize,
      })
    )
  );

profilesCmd
  .command('get <id>')
  .description('Retrieve a messaging profile by ID')
  .action((id: string, _opts, cmd) => run(cmd, client => client.messagingProfiles.get(id)));

// ============================================
// Number Lookup Command
// ============================================
program
  .command('lookup <phoneNumber>')
  .description('Look up carrier / caller info for a phone number')
  .option('--type <type>', 'Enrichments to request (e.g. "carrier", "caller-name")')
  .action((phoneNumber: string, opts, cmd) =>
    run(cmd, client => client.numberLookup.lookup(phoneNumber, { type: opts.type }))
  );

program.parseAsync(process.argv);
