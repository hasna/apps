#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Firecrawl } from '../api';
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
import { success, error, info, print, warn } from '../utils/output';
import type { ScrapeFormat } from '../types';

const CONNECTOR_NAME = 'connect-firecrawl';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Firecrawl web scraping API connector - Scrape, crawl, and map websites')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
    // Set API key from flag if provided
    if (opts.apiKey) {
      process.env.FIRECRAWL_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get root command format
function getRootFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Firecrawl {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set FIRECRAWL_API_KEY environment variable.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new Firecrawl({ apiKey, baseUrl });
}

// ============================================
// Scrape Command
// ============================================
program
  .command('scrape <url>')
  .description('Scrape a single URL')
  .option('--formats <formats>', 'Output formats (comma-separated: markdown,html,rawHtml,links,screenshot)', 'markdown')
  .option('--main-content', 'Only extract main content')
  .option('--include-tags <tags>', 'Include only these HTML tags (comma-separated)')
  .option('--exclude-tags <tags>', 'Exclude these HTML tags (comma-separated)')
  .option('--wait <ms>', 'Wait for page to load (milliseconds)')
  .option('--mobile', 'Emulate mobile device')
  .option('--timeout <ms>', 'Request timeout (milliseconds)')
  .option('--screenshot', 'Include screenshot')
  .option('--full-page', 'Capture full page screenshot')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();

      let formats = opts.formats.split(',').map((f: string) => f.trim()) as ScrapeFormat[];

      // Handle screenshot options
      if (opts.screenshot) {
        if (opts.fullPage) {
          formats = formats.filter(f => f !== 'screenshot');
          formats.push('screenshot@fullPage');
        } else if (!formats.includes('screenshot')) {
          formats.push('screenshot');
        }
      }

      const result = await client.scrape.scrape(url, {
        formats,
        onlyMainContent: opts.mainContent,
        includeTags: opts.includeTags?.split(','),
        excludeTags: opts.excludeTags?.split(','),
        waitFor: opts.wait ? parseInt(opts.wait) : undefined,
        mobile: opts.mobile,
        timeout: opts.timeout ? parseInt(opts.timeout) : undefined,
      });

      if (result.success) {
        success('Page scraped successfully');
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Scrape failed');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Crawl Commands
// ============================================
const crawlCmd = program
  .command('crawl')
  .description('Crawl a website');

crawlCmd
  .command('start <url>')
  .description('Start a crawl job')
  .option('--max-depth <depth>', 'Maximum crawl depth', '2')
  .option('--limit <limit>', 'Maximum pages to crawl', '10')
  .option('--include <paths>', 'Include paths (comma-separated)')
  .option('--exclude <paths>', 'Exclude paths (comma-separated)')
  .option('--ignore-sitemap', 'Ignore sitemap')
  .option('--allow-external', 'Allow external links')
  .option('--wait', 'Wait for crawl to complete')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();

      const options = {
        maxDepth: parseInt(opts.maxDepth),
        limit: parseInt(opts.limit),
        includePaths: opts.include?.split(','),
        excludePaths: opts.exclude?.split(','),
        ignoreSitemap: opts.ignoreSitemap,
        allowExternalLinks: opts.allowExternal,
      };

      if (opts.wait) {
        info(`Starting crawl and waiting for completion...`);
        const result = await client.crawl.crawlAndWait(url, options);
        if (result.status === 'completed') {
          success(`Crawl completed! ${result.completed}/${result.total} pages scraped`);
          print(result, getRootFormat());
        } else {
          error(`Crawl ${result.status}: ${result.error || 'Unknown error'}`);
          process.exit(1);
        }
      } else {
        const result = await client.crawl.start(url, options);
        if (result.success && result.id) {
          success(`Crawl job started: ${result.id}`);
          info(`Check status with: ${CONNECTOR_NAME} crawl status ${result.id}`);
          print(result, getRootFormat());
        } else {
          error(result.error || 'Failed to start crawl');
          process.exit(1);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

crawlCmd
  .command('status <jobId>')
  .description('Get crawl job status')
  .action(async (jobId: string) => {
    try {
      const client = getClient();
      const result = await client.crawl.getStatus(jobId);

      if (result.status === 'completed') {
        success(`Crawl completed: ${result.completed}/${result.total} pages`);
      } else if (result.status === 'scraping') {
        info(`Crawl in progress: ${result.completed}/${result.total} pages`);
      } else {
        warn(`Crawl status: ${result.status}`);
      }

      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

crawlCmd
  .command('cancel <jobId>')
  .description('Cancel a crawl job')
  .action(async (jobId: string) => {
    try {
      const client = getClient();
      const result = await client.crawl.cancel(jobId);

      if (result.success) {
        success('Crawl cancelled');
      } else {
        error(result.error || 'Failed to cancel crawl');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Map Command
// ============================================
program
  .command('map <url>')
  .description('Discover URLs on a website')
  .option('--search <query>', 'Filter URLs by search query')
  .option('--limit <limit>', 'Maximum URLs to return', '100')
  .option('--sitemap-only', 'Only use sitemap URLs')
  .option('--include-subdomains', 'Include subdomains')
  .option('--ignore-sitemap', 'Ignore sitemap')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();

      const result = await client.map.map(url, {
        search: opts.search,
        limit: parseInt(opts.limit),
        sitemapOnly: opts.sitemapOnly,
        includeSubdomains: opts.includeSubdomains,
        ignoreSitemap: opts.ignoreSitemap,
      });

      if (result.success) {
        success(`Found ${result.links?.length || 0} URLs`);
        print(result.links, getRootFormat());
      } else {
        error(result.error || 'Map failed');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Search Command
// ============================================
program
  .command('search <query>')
  .description('Search the web and scrape results (Beta)')
  .option('--limit <limit>', 'Maximum results', '5')
  .option('--lang <lang>', 'Language code (e.g., en, es, fr)')
  .option('--country <country>', 'Country code (e.g., us, gb, de)')
  .option('--time <time>', 'Time filter: day, week, month, year')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();

      const tbsMap: Record<string, string> = {
        day: 'qdr:d',
        week: 'qdr:w',
        month: 'qdr:m',
        year: 'qdr:y',
      };

      const result = await client.search.search(query, {
        limit: parseInt(opts.limit),
        lang: opts.lang,
        country: opts.country,
        tbs: opts.time ? tbsMap[opts.time] : undefined,
      });

      if (result.success) {
        success(`Found ${result.data?.length || 0} results`);
        print(result.data, getRootFormat());
      } else {
        error(result.error || 'Search failed');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.firecrawl.dev/v1)')}`);
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
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.firecrawl.dev/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Parse and execute
program.parse();
