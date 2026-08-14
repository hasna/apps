#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { TrustpilotBusiness } from '../api';
import {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getBaseUrl,
  getInvitationsBaseUrl,
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

const CONNECTOR_NAME = 'connect-trustpilot-business';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Trustpilot Business connector - Reviews, invitations, and business unit search')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-s, --api-secret <secret>', 'API secret (overrides config)')
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
      process.env.TRUSTPILOT_BUSINESS_API_KEY = opts.apiKey;
    }
    if (opts.apiSecret) {
      process.env.TRUSTPILOT_BUSINESS_API_SECRET = opts.apiSecret;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TrustpilotBusiness {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRUSTPILOT_BUSINESS_API_KEY.`);
    process.exit(1);
  }

  return new TrustpilotBusiness({
    apiKey,
    apiSecret: getApiSecret(),
    baseUrl: getBaseUrl(),
    invitationsBaseUrl: getInvitationsBaseUrl(),
  });
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
  .option('--api-secret <secret>', 'API secret')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      apiSecret: opts.apiSecret,
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Secret: ${config.apiSecret ? chalk.green('set') : chalk.gray('not set')}`);
  });

const configCmd = program.command('config').description('Manage connector configuration');

configCmd
  .command('set-key <key>')
  .description('Set API key for current profile')
  .action((key: string) => {
    setApiKey(key);
    success('API key saved');
  });

configCmd
  .command('set-secret <secret>')
  .description('Set API secret for current profile')
  .action((secret: string) => {
    setApiSecret(secret);
    success('API secret saved');
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const apiKey = getApiKey();
    info(`Profile: ${getCurrentProfile()}`);
    info(`Config dir: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Secret: ${getApiSecret() ? chalk.green('set') : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || 'https://api.trustpilot.com/v1 (default)'}`);
  });

configCmd
  .command('clear')
  .description('Clear current profile credentials')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

const reviewsCmd = program.command('reviews').description('Service review operations');

reviewsCmd
  .command('list <businessUnitId>')
  .description('List reviews for a business unit')
  .option('--page <page>', 'Page number', parseInt)
  .option('--per-page <count>', 'Reviews per page', parseInt)
  .option('--private', 'Use private reviews endpoint (requires API secret)')
  .option('--page-token <token>', 'Pagination token for all-reviews endpoint')
  .action(async (businessUnitId: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.listReviews(businessUnitId, {
        page: opts.page,
        perPage: opts.perPage,
        pageToken: opts.pageToken,
        private: opts.private,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

reviewsCmd
  .command('get <reviewId>')
  .description('Get a review by ID')
  .option('--private', 'Use private review endpoint (requires API secret)')
  .action(async (reviewId: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.getReview(reviewId, { private: opts.private });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

reviewsCmd
  .command('create-invitation <businessUnitId>')
  .description('Create a service review email invitation')
  .option('--body-file <path>', 'JSON request body file')
  .option('--consumer-email <email>', 'Consumer email')
  .option('--consumer-name <name>', 'Consumer name')
  .option('--reference-number <ref>', 'Reference number')
  .option('--locale <locale>', 'Locale', 'en-US')
  .action(async (businessUnitId: string, opts, cmd) => {
    try {
      const client = getClient();
      let body: Record<string, unknown> = {};

      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else {
        if (!opts.consumerEmail) {
          error('Provide --consumer-email or --body-file');
          process.exit(1);
        }
        body = {
          consumerEmail: opts.consumerEmail,
          consumerName: opts.consumerName,
          referenceNumber: opts.referenceNumber,
          locale: opts.locale,
          type: 'email',
          serviceReviewInvitation: {},
        };
      }

      const result = await client.createEmailInvitation(businessUnitId, body);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

reviewsCmd
  .command('create-link <businessUnitId>')
  .description('Generate a service review invitation link')
  .option('--email <email>', 'Consumer email')
  .option('--name <name>', 'Consumer name')
  .option('--reference-id <ref>', 'Reference ID')
  .option('--locale <locale>', 'Locale', 'en-US')
  .action(async (businessUnitId: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.createInvitationLink(businessUnitId, {
        email: opts.email,
        name: opts.name,
        referenceId: opts.referenceId,
        locale: opts.locale,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const eventsCmd = program.command('events').description('Webhook event subscriptions');

eventsCmd
  .command('list')
  .description('List webhook subscriptions (requires API secret)')
  .action(async (_opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.listEvents();
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

const searchCmd = program.command('search').description('Business unit search');

searchCmd
  .command('business-units <query>')
  .description('Search business units by name or domain')
  .option('--country <code>', 'Two-letter country code')
  .option('--page <page>', 'Page number', parseInt)
  .option('--perpage <count>', 'Results per page', parseInt)
  .action(async (query: string, opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.searchBusinessUnits({
        query,
        country: opts.country,
        page: opts.page,
        perpage: opts.perpage,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('find <name>')
  .description('Find a business unit by domain name')
  .action(async (name: string, _opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.findBusinessUnit(name);
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Make a raw API request')
  .requiredOption('--path <path>', 'API path (e.g. /reviews/{id})')
  .option('--method <method>', 'HTTP method', 'GET')
  .option('--query <json>', 'Query parameters as JSON object')
  .option('--body <json>', 'Request body as JSON')
  .option('--body-file <path>', 'Request body JSON file')
  .option('--private', 'Use private API authentication')
  .option('--base-url <url>', 'Override base URL for this request')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const query = opts.query ? JSON.parse(opts.query) : undefined;
      let body: Record<string, unknown> | string | undefined;
      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else if (opts.body) {
        body = JSON.parse(opts.body);
      }

      const result = await client.rawRequest(opts.path, {
        method: opts.method,
        query,
        body,
        privateAuth: opts.private,
        baseUrl: opts.baseUrl,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
