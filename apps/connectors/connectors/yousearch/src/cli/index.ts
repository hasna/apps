#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { YouSearch } from '../api';
import type { ResearchEffort } from '../types';
import {
  getApiKey,
  setApiKey,
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

const CONNECTOR_NAME = 'connect-yousearch';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('You.com Search API connector - Web search and research')
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
      process.env.YOUSEARCH_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): YouSearch {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set YOUSEARCH_API_KEY environment variable.`);
    process.exit(1);
  }
  return new YouSearch({ apiKey, baseUrl: getBaseUrl() });
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
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('https://api.you.com (default)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL set to: ${url}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('https://api.you.com (default)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Search Commands
// ============================================
program
  .command('search <query>')
  .description('Search the web via GET /v1/search')
  .option('-c, --count <count>', 'Number of results per section', '10')
  .option('--freshness <value>', 'Freshness filter (day, week, month, year, or date range)')
  .option('--country <code>', 'Country code (e.g. US, GB)')
  .option('--language <code>', 'Language code (BCP 47, default EN)')
  .action(async (query: string, opts, cmd) => {
    try {
      const client = getClient();
      const response = await client.search.search({
        query,
        count: parseInt(opts.count, 10),
        freshness: opts.freshness,
        country: opts.country,
        language: opts.language,
      });
      print(response, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('search-post <query>')
  .description('Search the web via POST /v1/search (for complex domain filters)')
  .option('-c, --count <count>', 'Number of results per section', '10')
  .option('--include-domains <domains>', 'Comma-separated domains to include')
  .option('--exclude-domains <domains>', 'Comma-separated domains to exclude')
  .option('--boost-domains <domains>', 'Comma-separated domains to boost')
  .option('--freshness <value>', 'Freshness filter')
  .action(async (query: string, opts, cmd) => {
    try {
      const client = getClient();
      const response = await client.search.searchPost({
        query,
        count: parseInt(opts.count, 10),
        freshness: opts.freshness,
        include_domains: opts.includeDomains?.split(',').map((d: string) => d.trim()).filter(Boolean),
        exclude_domains: opts.excludeDomains?.split(',').map((d: string) => d.trim()).filter(Boolean),
        boost_domains: opts.boostDomains?.split(',').map((d: string) => d.trim()).filter(Boolean),
      });
      print(response, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('research <input>')
  .description('Run multi-step research via POST /v1/research')
  .option('-e, --effort <level>', 'Research effort (lite, standard, deep, exhaustive)', 'standard')
  .action(async (input: string, opts, cmd) => {
    try {
      info('Starting research (this may take a moment)...');
      const client = getClient();
      const response = await client.research.research({
        input,
        research_effort: opts.effort as ResearchEffort,
      });

      const format = getFormat(cmd);
      if (format === 'json') {
        print(response, format);
      } else {
        const content = response.output?.content || '';
        console.log(chalk.cyan('\nResearch:\n'));
        console.log(content);

        if (response.output?.citations?.length) {
          console.log(chalk.cyan('\nCitations:'));
          response.output.citations.forEach((citation, i) => {
            console.log(chalk.gray(`  [${i + 1}] ${citation.title || citation.url}`));
            if (citation.url) {
              console.log(chalk.gray(`      ${citation.url}`));
            }
          });
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request <path>')
  .description('Make a raw authenticated API request')
  .option('-X, --method <method>', 'HTTP method', 'GET')
  .option('-d, --data <json>', 'JSON request body')
  .action(async (path: string, opts, cmd) => {
    try {
      const client = getClient();
      const body = opts.data ? JSON.parse(opts.data) : undefined;
      const response = await client.rawRequest(path, {
        method: opts.method,
        body,
      });
      print(response, getFormat(cmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
