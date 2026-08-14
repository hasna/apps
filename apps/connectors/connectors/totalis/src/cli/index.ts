#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Totalis } from '../api';
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
import type { CommitQuoteRequestBody, CreateQuoteRequestBody } from '../types';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../../package.json'), 'utf-8'));
const CONNECTOR_NAME = 'connect-totalis';
const VERSION = pkg.version as string;

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Totalis connector - Prediction market parlays and quote requests')
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
      process.env.TOTALIS_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(requireAuth = true): Totalis {
  const apiKey = getApiKey();
  if (requireAuth && !apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TOTALIS_API_KEY.`);
    process.exit(1);
  }
  return new Totalis({ apiKey: apiKey || '' });
}

function parseJsonOption<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success('Profiles:');
  for (const p of profiles) {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  }
});

profileCmd
  .command('use <name>')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command('create <name>')
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

profileCmd.command('delete <name>').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Profile "${name}" could not be deleted`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const marketsCmd = program.command('markets').description('Prediction market data');

marketsCmd
  .command('list')
  .option('--category <category>', 'Market category filter')
  .option('--venue <venue>', 'kalshi or polymarket')
  .option('--search <query>', 'Full-text search')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--limit <limit>', 'Events per page', parseInt)
  .action(async (opts) => {
    try {
      const client = getClient(false);
      const result = await client.markets.list({
        category: opts.category,
        venue: opts.venue,
        search: opts.search,
        cursor: opts.cursor,
        limit: opts.limit,
      });
      print(result, getFormat(marketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

marketsCmd
  .command('list-flat')
  .option('--category <category>', 'Market category filter')
  .option('--venue <venue>', 'kalshi or polymarket')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--limit <limit>', 'Markets per page', parseInt)
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.markets.listFlat({
        category: opts.category,
        venue: opts.venue,
        cursor: opts.cursor,
        limit: opts.limit,
      });
      print(result, getFormat(marketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

marketsCmd
  .command('get <ticker>')
  .option('--venue <venue>', 'kalshi or polymarket')
  .action(async (ticker: string, opts: { venue?: string }) => {
    try {
      const client = getClient(false);
      const result = await client.markets.get(ticker, opts.venue as 'kalshi' | 'polymarket' | undefined);
      print(result, getFormat(marketsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const parlaysCmd = program.command('parlays').description('Settled and active parlays (RFQs)');

parlaysCmd
  .command('list')
  .option('--status <status>', 'Comma-separated status filter')
  .option('--include <include>', 'Include related data (quotes)')
  .option('--cursor <cursor>', 'Pagination cursor')
  .option('--limit <limit>', 'Results per page', parseInt)
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.parlays.list({
        status: opts.status,
        include: opts.include,
        cursor: opts.cursor,
        limit: opts.limit,
      });
      print(result, getFormat(parlaysCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

parlaysCmd.command('get <id>').action(async (id: string) => {
  try {
    const client = getClient();
    const result = await client.parlays.get(id);
    print(result, getFormat(parlaysCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const rfqCmd = program.command('quote-requests').description('Live quote request workflow');

rfqCmd
  .command('create')
  .requiredOption('--body <json>', 'JSON body with legs and bet_amount')
  .action(async (opts: { body: string }) => {
    try {
      const client = getClient();
      const body = parseJsonOption<CreateQuoteRequestBody>(opts.body, '--body');
      const result = await client.quoteRequests.create(body);
      print(result, getFormat(rfqCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

rfqCmd.command('get <id>').action(async (id: string) => {
  try {
    const client = getClient();
    const result = await client.quoteRequests.get(id);
    print(result, getFormat(rfqCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

rfqCmd
  .command('update <id>')
  .requiredOption('--body <json>', 'JSON body with legs and bet_amount')
  .action(async (id: string, opts: { body: string }) => {
    try {
      const client = getClient();
      const body = parseJsonOption<CreateQuoteRequestBody>(opts.body, '--body');
      const result = await client.quoteRequests.update(id, body);
      print(result, getFormat(rfqCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

rfqCmd.command('cancel <id>').action(async (id: string) => {
  try {
    const client = getClient();
    const result = await client.quoteRequests.cancel(id);
    print(result, getFormat(rfqCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

rfqCmd
  .command('commit <id>')
  .requiredOption('--body <json>', 'JSON commit protection body')
  .action(async (id: string, opts: { body: string }) => {
    try {
      const client = getClient();
      const body = parseJsonOption<CommitQuoteRequestBody>(opts.body, '--body');
      const result = await client.quoteRequests.commit(id, body);
      print(result, getFormat(rfqCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const walletCmd = program.command('wallet').description('Wallet balances');

walletCmd.command('get').action(async () => {
  try {
    const client = getClient();
    const result = await client.wallet.get();
    print(result, getFormat(walletCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.parse();
