#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { YouCom } from '../api';
import type { ResearchEffort, SearchPostBody } from '../types';
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-you-com';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('You.com Web Search and Research API connector')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(
          `Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`,
        );
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.YDC_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): YouCom {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set YDC_API_KEY environment variable.`,
    );
    process.exit(1);
  }
  return new YouCom({ apiKey });
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

    console.log(
      chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`),
    );
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
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program
  .command('search <query>')
  .description('Web search (GET /v1/search)')
  .option('-c, --count <count>', 'Max results per section', '5')
  .option('--freshness <freshness>', 'day, week, month, year')
  .option('--livecrawl <mode>', 'web, news, or all')
  .option('--livecrawl-formats <formats>', 'Comma-separated html or markdown')
  .action(async (query: string, opts, cmd) => {
    try {
      const client = getClient();
      const response = await client.search.get({
        query,
        count: parseInt(opts.count, 10),
        freshness: opts.freshness,
        livecrawl: opts.livecrawl,
        livecrawl_formats: opts.livecrawlFormats?.split(','),
      });
      print(response, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search-post <query>')
  .description('Web search with domain filters (POST /v1/search)')
  .option('-c, --count <count>', 'Max results per section', '5')
  .option('--include-domains <domains>', 'Comma-separated allowlist domains')
  .option('--exclude-domains <domains>', 'Comma-separated blocklist domains')
  .option('--boost-domains <domains>', 'Comma-separated boost domains')
  .option('--livecrawl <mode>', 'web, news, or all')
  .action(async (query: string, opts, cmd) => {
    try {
      const client = getClient();
      const body: SearchPostBody = {
        query,
        count: parseInt(opts.count, 10),
      };

      if (opts.includeDomains) {
        body.include_domains = opts.includeDomains.split(',').map((d: string) => d.trim());
      }
      if (opts.excludeDomains) {
        body.exclude_domains = opts.excludeDomains.split(',').map((d: string) => d.trim());
      }
      if (opts.boostDomains) {
        body.boost_domains = opts.boostDomains.split(',').map((d: string) => d.trim());
      }
      if (opts.livecrawl) {
        body.livecrawl = opts.livecrawl;
      }

      const response = await client.search.post(body);
      print(response, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('research <input>')
  .description('Deep research with citations (POST /v1/research)')
  .option('-e, --effort <effort>', 'lite, standard, deep, or exhaustive', 'standard')
  .option('--freshness <freshness>', 'Source freshness filter for research')
  .action(async (input: string, opts, cmd) => {
    try {
      info('Running research (this may take a moment)...');
      const client = getClient();
      const response = await client.research.create({
        input,
        research_effort: opts.effort as ResearchEffort,
        source_control: opts.freshness ? { freshness: opts.freshness } : undefined,
      });

      const format = getFormat(cmd);
      if (format === 'json') {
        print(response, format);
        return;
      }

      const content = response.output?.content;
      if (content) {
        console.log(chalk.cyan('\nResearch:\n'));
        console.log(content);
      } else {
        print(response, format);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
