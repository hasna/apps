#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Connector } from '../api';
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
  loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'connect-zerobounce';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('ZeroBounce email validation and enrichment connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.apiKey) {
      process.env.ZERO_BOUNCE_API_KEY = opts.apiKey;
      debug('API key set from command line flag');
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Connector {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ZERO_BOUNCE_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Connector({ apiKey });
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
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

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Validation commands
const validateCmd = program.command('validate').description('Email validation');

validateCmd
  .command('email <email>')
  .description('Validate a single email address')
  .option('--ip <address>', 'Signup IP address')
  .option('--timeout <seconds>', 'Validation timeout (3-60)', parseInt)
  .option('--activity-data', 'Include activity data')
  .option('--verify-plus', 'Use Verify+ validation')
  .action(async (email: string, opts) => {
    try {
      const client = getClient();
      const result = await client.validation.validate({
        email,
        ip_address: opts.ip,
        timeout: opts.timeout,
        activity_data: opts.activityData,
        verify_plus: opts.verifyPlus,
      });
      print(result, getFormat(validateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

validateCmd
  .command('sandbox <email>')
  .description('Validate an email in sandbox mode (no credits consumed)')
  .option('--ip <address>', 'Signup IP address')
  .action(async (email: string, opts) => {
    try {
      const client = getClient();
      const result = await client.validation.validateSandbox({ email, ip_address: opts.ip });
      print(result, getFormat(validateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

validateCmd
  .command('batch')
  .description('Validate a batch of emails (max ~200)')
  .requiredOption('--emails <list>', 'Comma-separated email addresses')
  .option('--activity-data', 'Include activity data')
  .option('--verify-plus', 'Use Verify+ validation')
  .action(async (opts) => {
    try {
      const client = getClient();
      const email_batch = opts.emails.split(',').map((e: string) => ({
        email_address: e.trim(),
      }));
      const result = await client.validation.validateBatch({
        email_batch,
        activity_data: opts.activityData,
        verify_plus: opts.verifyPlus,
      });
      print(result, getFormat(validateCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Account commands
const accountCmd = program.command('account').description('Account and usage');

accountCmd.command('credits').description('Get remaining credit balance').action(async () => {
  try {
    const client = getClient();
    const result = await client.account.getCredits();
    print(result, getFormat(accountCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

accountCmd
  .command('usage')
  .description('Get API usage for a date range')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.account.getApiUsage({
        start_date: opts.start,
        end_date: opts.end,
      });
      print(result, getFormat(accountCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Bulk file commands
const bulkCmd = program.command('bulk').description('Bulk file validation');

bulkCmd
  .command('send <file>')
  .description('Upload a CSV/TXT file for bulk validation')
  .requiredOption('--email-column <n>', 'Email address column index (1-based)', parseInt)
  .option('--return-url <url>', 'Callback URL when complete')
  .option('--header-row', 'First row is a header')
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const contents = readFileSync(file);
      const result = await client.bulk.sendFile({
        file: contents,
        fileName: file.split('/').pop() || 'upload.csv',
        email_address_column: opts.emailColumn,
        return_url: opts.returnUrl,
        has_header_row: opts.headerRow,
      });
      print(result, getFormat(bulkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('status <fileId>')
  .description('Check bulk file processing status')
  .action(async (fileId: string) => {
    try {
      const client = getClient();
      const result = await client.bulk.getFileStatus({ file_id: fileId });
      print(result, getFormat(bulkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('get <fileId>')
  .description('Download validated bulk file results')
  .action(async (fileId: string) => {
    try {
      const client = getClient();
      const result = await client.bulk.getFile({ file_id: fileId });
      console.log(result);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('delete <fileId>')
  .description('Delete a bulk validation file')
  .action(async (fileId: string) => {
    try {
      const client = getClient();
      const result = await client.bulk.deleteFile({ file_id: fileId });
      print(result, getFormat(bulkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Scoring commands
const scoringCmd = program.command('scoring').description('AI email scoring');

scoringCmd
  .command('score <email>')
  .description('Get AI scoring for a single email')
  .option('--ip <address>', 'Signup IP address')
  .action(async (email: string, opts) => {
    try {
      const client = getClient();
      const result = await client.scoring.aiScoringScore({ email, ip_address: opts.ip });
      print(result, getFormat(scoringCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

scoringCmd
  .command('send <file>')
  .description('Upload a file for bulk AI scoring')
  .requiredOption('--email-column <n>', 'Email address column index (1-based)', parseInt)
  .action(async (file: string, opts) => {
    try {
      const client = getClient();
      const contents = readFileSync(file);
      const result = await client.scoring.sendScoringFile({
        file: contents,
        fileName: file.split('/').pop() || 'upload.csv',
        email_address_column: opts.emailColumn,
      });
      print(result, getFormat(scoringCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

scoringCmd
  .command('status <fileId>')
  .description('Check scoring file status')
  .action(async (fileId: string) => {
    try {
      const client = getClient();
      const result = await client.scoring.getScoringFileStatus({ file_id: fileId });
      print(result, getFormat(scoringCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Enrichment commands
const enrichCmd = program.command('enrich').description('Email enrichment');

enrichCmd
  .command('guess-format <email>')
  .description('Guess email format for a domain')
  .action(async (email: string) => {
    try {
      const client = getClient();
      const result = await client.enrichment.guessFormat({ email });
      print(result, getFormat(enrichCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

enrichCmd
  .command('domain-search <domain>')
  .description('Search for emails on a domain')
  .option('--page <n>', 'Page number', parseInt)
  .option('--limit <n>', 'Results per page', parseInt)
  .action(async (domain: string, opts) => {
    try {
      const client = getClient();
      const result = await client.enrichment.domainSearch({
        domain,
        page: opts.page,
        limit: opts.limit,
      });
      print(result, getFormat(enrichCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

enrichCmd
  .command('activity <email>')
  .description('Get email activity data')
  .action(async (email: string) => {
    try {
      const client = getClient();
      const result = await client.enrichment.getActivity({ email });
      print(result, getFormat(enrichCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
