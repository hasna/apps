#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { Vivenu } from '../api';
import type { CreateCheckoutRequest } from '../types';
import {
  getApiKey,
  setApiKey,
  getDistributorType,
  setDistributorType,
  getBaseUrl,
  setBaseUrl,
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

const CONNECTOR_NAME = 'connect-vivenu';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vivenu Distribution API connector - event ticketing sellers, events, availabilities, and checkouts')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
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

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Vivenu {
  const apiKey = getApiKey();
  const distributorType = getDistributorType();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VIVENU_API_KEY`);
    process.exit(1);
  }
  if (!distributorType) {
    error(`No distributor type configured. Run "${CONNECTOR_NAME} config set-distributor-type <type>" or set VIVENU_DISTRIBUTOR_TYPE`);
    process.exit(1);
  }
  return new Vivenu({ apiKey, distributorType, baseUrl: getBaseUrl() });
}

// Profile Commands
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found');
    return;
  }
  profiles.forEach(p => {
    const marker = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${marker}`);
  });
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--distributor-type <type>', 'Distributor type')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, distributorType: opts.distributorType });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') {
    error('Cannot delete default profile');
    process.exit(1);
  }
  if (deleteProfile(name)) {
    success(`Profile "${name}" deleted`);
  } else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Distributor Type: ${config.distributorType || chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default (https://vivenu.com)')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success('API key saved');
});

configCmd.command('set-distributor-type <type>').description('Set distributor type').action((type: string) => {
  setDistributorType(type);
  success('Distributor type saved');
});

configCmd.command('set-base-url <url>').description('Set custom base URL').action((url: string) => {
  setBaseUrl(url);
  success('Base URL saved');
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const apiKey = getApiKey();
  info(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
  info(`Distributor Type: ${getDistributorType() || chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://vivenu.com)')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Distribution Commands
const distributionCmd = program.command('distribution').description('Vivenu Distribution API');

distributionCmd.command('list-sellers')
  .description('List available sellers')
  .option('--type <type>', 'Distributor type filter')
  .option('--skip <n>', 'Skip sellers', parseInt)
  .option('--top <n>', 'Max sellers to return', parseInt)
  .option('--seller-id <id>', 'Filter by seller ID')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.distribution.listSellers({
        type: opts.type,
        skip: opts.skip,
        top: opts.top,
        sellerId: opts.sellerId,
      });
      print(getFormat(cmd) === 'json' ? result : result.docs, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

distributionCmd.command('list-events')
  .description('List events for a seller')
  .requiredOption('--distributor-id <id>', 'Seller distributor ID')
  .option('--start <date>', 'Start date filter')
  .option('--end <date>', 'End date filter')
  .option('--top <n>', 'Max events to return', parseInt)
  .option('--skip <n>', 'Events to skip', parseInt)
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.distribution.listEvents({
        distributorId: opts.distributorId,
        start: opts.start,
        end: opts.end,
        top: opts.top,
        skip: opts.skip,
      });
      print(getFormat(cmd) === 'json' ? result : result.docs, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

distributionCmd.command('get-event')
  .description('Get a single event')
  .requiredOption('--id <eventId>', 'Event ID')
  .requiredOption('--distributor-id <id>', 'Seller distributor ID')
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.distribution.getEvent(opts.id, {
        distributorId: opts.distributorId,
      });
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

distributionCmd.command('list-availabilities')
  .description('List availabilities for an event')
  .requiredOption('--id <eventId>', 'Event ID')
  .requiredOption('--distributor-id <id>', 'Seller distributor ID')
  .option('--start <date>', 'Start date filter')
  .option('--end <date>', 'End date filter')
  .option('--top <n>', 'Max availabilities to return', parseInt)
  .option('--skip <n>', 'Availabilities to skip', parseInt)
  .action(async (opts, cmd) => {
    try {
      const client = getClient();
      const result = await client.distribution.listAvailabilities(opts.id, {
        distributorId: opts.distributorId,
        start: opts.start,
        end: opts.end,
        top: opts.top,
        skip: opts.skip,
      });
      print(getFormat(cmd) === 'json' ? result : result.docs, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

distributionCmd.command('create-checkout')
  .description('Create a checkout')
  .option('--body <json>', 'Full checkout JSON body')
  .option('--body-file <path>', 'Path to JSON file with checkout body')
  .option('--distributor-id <id>', 'Seller distributor ID')
  .option('--external-reference-id <ref>', 'External reference ID')
  .action(async (opts, cmd) => {
    try {
      let body: CreateCheckoutRequest;

      if (opts.bodyFile) {
        body = JSON.parse(readFileSync(opts.bodyFile, 'utf-8'));
      } else if (opts.body) {
        body = JSON.parse(opts.body);
      } else if (opts.distributorId) {
        error('Provide --body or --body-file with a full checkout payload including tickets');
        process.exit(1);
      } else {
        error('Provide --body <json> or --body-file <path>');
        process.exit(1);
      }

      if (opts.distributorId && !body.distributorId) {
        body.distributorId = opts.distributorId;
      }
      if (opts.externalReferenceId && !body.externalReferenceId) {
        body.externalReferenceId = opts.externalReferenceId;
      }

      const client = getClient();
      const result = await client.distribution.createCheckout(body);
      print(result, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
