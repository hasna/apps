#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Sprig } from '../api';
import {
  getApiKey,
  setApiKey,
  getBaseUrl,
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
import { success, error, info, print } from '../utils/output';
import type { SurveyStatus } from '../types';

const CONNECTOR_NAME = 'connect-sprig';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Sprig connector CLI - user management, surveys, responses, and themes')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
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
      process.env.SPRIG_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Sprig {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SPRIG_API_KEY.`);
    process.exit(1);
  }

  const baseUrl = getBaseUrl();
  return new Sprig({ apiKey, baseUrl });
}

function parseCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseStatuses(value: string): SurveyStatus[] {
  return parseCsv(value) as SurveyStatus[];
}

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
    profiles.forEach((p) => {
      const isActive = p === current ? chalk.green(' (active)') : '';
      console.log(`  ${p}${isActive}`);
    });
  });

profileCmd
  .command('use <name>')
  .description('Switch to a profile')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist.`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, { apiKey: opts.apiKey });
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || 'https://api.sprig.com (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const usersCmd = program.command('users').description('Manage Sprig users (v2 API)');

usersCmd
  .command('get <userId>')
  .description('Retrieve a user by ID')
  .action(async (userId: string) => {
    try {
      const client = getClient();
      const result = await client.users.get(userId);
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

usersCmd
  .command('upsert')
  .description('Upsert a user (async, returns 202 Accepted)')
  .requiredOption('--user-id <userId>', 'User ID')
  .option('--email <email>', 'Email address')
  .option('--attributes <json>', 'Attributes JSON object')
  .option('--events <json>', 'Events JSON array')
  .action(async (opts: { userId: string; email?: string; attributes?: string; events?: string }) => {
    try {
      const client = getClient();
      const result = await client.users.upsert({
        userId: opts.userId,
        emailAddress: opts.email,
        attributes: opts.attributes ? JSON.parse(opts.attributes) : undefined,
        events: opts.events ? JSON.parse(opts.events) : undefined,
      });
      success('User upsert accepted');
      print(result, getFormat(usersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const purgeCmd = program.command('purge').description('Purge visitor data (v2 API)');

purgeCmd
  .command('visitors')
  .description('Purge visitors by email, user ID, or visitor ID')
  .option('--emails <csv>', 'Comma-separated emails')
  .option('--user-ids <csv>', 'Comma-separated user IDs')
  .option('--visitor-ids <csv>', 'Comma-separated visitor IDs')
  .action(async (opts: { emails?: string; userIds?: string; visitorIds?: string }) => {
    try {
      const emails = opts.emails ? parseCsv(opts.emails) : undefined;
      const userIds = opts.userIds ? parseCsv(opts.userIds) : undefined;
      const visitorIds = opts.visitorIds ? parseCsv(opts.visitorIds) : undefined;

      if (!emails?.length && !userIds?.length && !visitorIds?.length) {
        error('At least one of --emails, --user-ids, or --visitor-ids is required');
        process.exit(1);
      }

      const client = getClient();
      const result = await client.purge.visitors({ emails, userIds, visitorIds });
      success('Purge request submitted');
      print(result, getFormat(purgeCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const surveysCmd = program.command('surveys').description('List survey/study configurations (v1 API)');

surveysCmd
  .command('list')
  .description('List surveys')
  .option('--start <ms>', 'Start timestamp (ms since epoch)')
  .option('--end <ms>', 'End timestamp (ms since epoch)')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--limit <n>', 'Result limit (1-1000)', parseInt)
  .option('--status <csv>', 'Status filter (IN_PROGRESS,PAUSED,COMPLETED,...)')
  .action(async (opts: { start?: string; end?: string; cursor?: string; limit?: number; status?: string }) => {
    try {
      const client = getClient();
      const result = await client.surveys.list({
        start: opts.start ? Number(opts.start) : undefined,
        end: opts.end ? Number(opts.end) : undefined,
        cursor: opts.cursor,
        limit: opts.limit,
        status: opts.status ? parseStatuses(opts.status) : undefined,
      });
      print(result, getFormat(surveysCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const responsesCmd = program.command('responses').description('List survey responses (v1 API)');

responsesCmd
  .command('list')
  .description('List responses')
  .option('--start <ms>', 'Start timestamp (ms since epoch)')
  .option('--end <ms>', 'End timestamp (ms since epoch)')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--limit <n>', 'Result limit (1-1000)', parseInt)
  .option('--sid <id>', 'Survey ID', parseInt)
  .option('--with-snapshots', 'Include visitor snapshots')
  .option('--with-urls', 'Include page URLs')
  .option('--with-meta', 'Include metadata')
  .option('--with-custom-metadata', 'Include custom metadata')
  .option('--with-deleted-responses', 'Include deleted responses')
  .action(async (opts: {
    start?: string;
    end?: string;
    cursor?: string;
    limit?: number;
    sid?: number;
    withSnapshots?: boolean;
    withUrls?: boolean;
    withMeta?: boolean;
    withCustomMetadata?: boolean;
    withDeletedResponses?: boolean;
  }) => {
    try {
      const client = getClient();
      const result = await client.responses.list({
        start: opts.start ? Number(opts.start) : undefined,
        end: opts.end ? Number(opts.end) : undefined,
        cursor: opts.cursor,
        limit: opts.limit,
        sid: opts.sid,
        with_snapshots: opts.withSnapshots,
        with_urls: opts.withUrls,
        with_meta: opts.withMeta,
        with_custom_metadata: opts.withCustomMetadata,
        with_deleted_responses: opts.withDeletedResponses,
      });
      print(result, getFormat(responsesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const themesCmd = program.command('themes').description('List survey themes (v1 API)');

themesCmd
  .command('list')
  .description('List themes')
  .option('--start <ms>', 'Start timestamp (ms since epoch)')
  .option('--end <ms>', 'End timestamp (ms since epoch)')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--limit <n>', 'Result limit (1-1000)', parseInt)
  .option('--sid <id>', 'Survey ID', parseInt)
  .action(async (opts: { start?: string; end?: string; cursor?: string; limit?: number; sid?: number }) => {
    try {
      const client = getClient();
      const result = await client.themes.list({
        start: opts.start ? Number(opts.start) : undefined,
        end: opts.end ? Number(opts.end) : undefined,
        cursor: opts.cursor,
        limit: opts.limit,
        sid: opts.sid,
      });
      print(result, getFormat(themesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
