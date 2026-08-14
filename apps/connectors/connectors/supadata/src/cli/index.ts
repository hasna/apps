#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Supadata } from '../api';
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

const CONNECTOR_NAME = 'connect-supadata';
const VERSION = '0.1.0';

const program = new Command();
let apiKeyOverride: string | undefined;

program
  .name(CONNECTOR_NAME)
  .description('Supadata web scraping, transcript, and YouTube metadata API connector')
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
      apiKeyOverride = opts.apiKey;
    }
  });

function getRootFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Supadata {
  const apiKey = apiKeyOverride || getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SUPADATA_API_KEY.`);
    process.exit(1);
  }
  return new Supadata({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonOption(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    error('Invalid JSON');
    process.exit(1);
  }
}

// Account
program
  .command('me')
  .description('Get account information and credit usage')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.account.me();
      success('Account info retrieved');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Web commands
const webCmd = program.command('web').description('Web scraping and crawling');

webCmd
  .command('scrape <url>')
  .description('Scrape a single URL to markdown')
  .option('--no-links', 'Exclude markdown links from response')
  .option('--lang <code>', 'Content language (ISO 639-1)')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const result = await client.web.scrape({ url, noLinks: opts.noLinks, lang: opts.lang });
      success('Page scraped');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

webCmd
  .command('map <url>')
  .description('Map all URLs on a website')
  .action(async (url: string) => {
    try {
      const client = getClient();
      const result = await client.web.map({ url });
      success(`Found ${result.urls?.length ?? 0} URLs`);
      print(result.urls, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const crawlCmd = webCmd.command('crawl').description('Crawl a website');

crawlCmd
  .command('start <url>')
  .description('Start a crawl job')
  .option('--limit <n>', 'Maximum pages to crawl', '100')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const result = await client.web.startCrawl({ url, limit: parseInt(opts.limit, 10) });
      success(`Crawl job started: ${result.jobId}`);
      print(result, getRootFormat());
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
      const result = await client.web.getCrawl(jobId);
      if (result.status === 'completed') {
        success(`Crawl completed: ${result.pages?.length ?? 0} pages`);
      } else {
        info(`Crawl status: ${result.status}`);
      }
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

crawlCmd
  .command('wait <url>')
  .description('Start crawl and wait for completion')
  .option('--limit <n>', 'Maximum pages to crawl', '100')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      info('Starting crawl and waiting for completion...');
      const result = await client.web.crawlAndWait({ url, limit: parseInt(opts.limit, 10) });
      if (result.status === 'completed') {
        success(`Crawl completed: ${result.pages?.length ?? 0} pages`);
      } else {
        warn(`Crawl ended with status: ${result.status}`);
      }
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Transcript
const transcriptCmd = program.command('transcript').description('Video transcript operations');

transcriptCmd
  .command('get <url>')
  .description('Get transcript from a video URL')
  .option('--lang <code>', 'Preferred language (ISO 639-1)')
  .option('--text', 'Return plain text transcript')
  .option('--chunk-size <n>', 'Max characters per chunk')
  .option('--mode <mode>', 'native, auto, or generate', 'auto')
  .option('--wait', 'Poll if async job is returned')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const options = {
        url,
        lang: opts.lang,
        text: opts.text,
        chunkSize: opts.chunkSize ? parseInt(opts.chunkSize, 10) : undefined,
        mode: opts.mode as 'native' | 'auto' | 'generate',
      };
      const result = opts.wait
        ? await client.transcript.getAndWait(options)
        : await client.transcript.get(options);
      success('Transcript retrieved');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

transcriptCmd
  .command('job <jobId>')
  .description('Get transcript job status')
  .action(async (jobId: string) => {
    try {
      const client = getClient();
      const result = await client.transcript.getJob(jobId);
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Metadata
program
  .command('metadata <url>')
  .description('Get metadata from a social media or video URL')
  .action(async (url: string) => {
    try {
      const client = getClient();
      const result = await client.metadata.get({ url });
      success('Metadata retrieved');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Extract
const extractCmd = program.command('extract').description('AI video data extraction');

extractCmd
  .command('start <url>')
  .description('Start an extract job')
  .option('--prompt <text>', 'Extraction prompt')
  .option('--schema <json>', 'JSON schema for output structure')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      const result = await client.extract.start({
        url,
        prompt: opts.prompt,
        schema: parseJsonOption(opts.schema),
      });
      success(`Extract job started: ${result.jobId}`);
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

extractCmd
  .command('status <jobId>')
  .description('Get extract job status')
  .action(async (jobId: string) => {
    try {
      const client = getClient();
      const result = await client.extract.getJob(jobId);
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

extractCmd
  .command('wait <url>')
  .description('Start extract job and wait for completion')
  .option('--prompt <text>', 'Extraction prompt')
  .option('--schema <json>', 'JSON schema for output structure')
  .action(async (url: string, opts) => {
    try {
      const client = getClient();
      info('Starting extract job and waiting...');
      const result = await client.extract.extractAndWait({
        url,
        prompt: opts.prompt,
        schema: parseJsonOption(opts.schema),
      });
      if (result.status === 'completed') {
        success('Extract completed');
      } else {
        warn(`Extract ended with status: ${result.status}`);
      }
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// YouTube
const ytCmd = program.command('youtube').description('YouTube-specific endpoints');

ytCmd
  .command('channel <id>')
  .description('Get YouTube channel metadata')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.youtube.channel({ id });
      success('Channel metadata retrieved');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ytCmd
  .command('channel-videos <id>')
  .description('List video IDs from a channel')
  .option('--limit <n>', 'Maximum videos', '30')
  .option('--type <type>', 'all, video, short, or live', 'all')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.youtube.channelVideos({
        id,
        limit: parseInt(opts.limit, 10),
        type: opts.type,
      });
      success('Channel videos retrieved');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ytCmd
  .command('playlist <id>')
  .description('Get YouTube playlist metadata')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const result = await client.youtube.playlist({ id });
      success('Playlist metadata retrieved');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ytCmd
  .command('playlist-videos <id>')
  .description('List video IDs from a playlist')
  .option('--limit <n>', 'Maximum videos')
  .action(async (id: string, opts) => {
    try {
      const client = getClient();
      const result = await client.youtube.playlistVideos({
        id,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      });
      success('Playlist videos retrieved');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ytCmd
  .command('video')
  .description('Get YouTube video metadata')
  .option('--id <id>', 'Video ID')
  .option('--url <url>', 'Video URL')
  .action(async (opts) => {
    if (!opts.id && !opts.url) {
      error('Provide --id or --url');
      process.exit(1);
    }
    try {
      const client = getClient();
      const result = await client.youtube.video({ id: opts.id, url: opts.url });
      success('Video metadata retrieved');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ytCmd
  .command('search <query>')
  .description('Search YouTube')
  .option('--limit <n>', 'Maximum results')
  .option('--type <type>', 'video, channel, or playlist')
  .action(async (query: string, opts) => {
    try {
      const client = getClient();
      const result = await client.youtube.search({
        query,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        type: opts.type,
      });
      success('Search completed');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ytCmd
  .command('transcript')
  .description('Get YouTube video transcript')
  .option('--id <id>', 'Video ID')
  .option('--url <url>', 'Video URL')
  .option('--lang <code>', 'Preferred language')
  .option('--text', 'Return plain text')
  .action(async (opts) => {
    if (!opts.id && !opts.url) {
      error('Provide --id or --url');
      process.exit(1);
    }
    try {
      const client = getClient();
      const result = await client.youtube.transcript({
        videoId: opts.id,
        url: opts.url,
        lang: opts.lang,
        text: opts.text,
      });
      success('Transcript retrieved');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ytCmd
  .command('translate')
  .description('Translate YouTube transcript')
  .requiredOption('--lang <code>', 'Target language (ISO 639-1)')
  .option('--id <id>', 'Video ID')
  .option('--url <url>', 'Video URL')
  .option('--text', 'Return plain text')
  .action(async (opts) => {
    if (!opts.id && !opts.url) {
      error('Provide --id or --url');
      process.exit(1);
    }
    try {
      const client = getClient();
      const result = await client.youtube.translateTranscript({
        videoId: opts.id,
        url: opts.url,
        lang: opts.lang,
        text: opts.text,
      });
      success('Translated transcript retrieved');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const ytBatchCmd = ytCmd.command('batch').description('YouTube batch jobs');

ytBatchCmd
  .command('transcript')
  .description('Start transcript batch job')
  .option('--video-ids <ids>', 'Comma-separated video IDs or URLs')
  .option('--playlist-id <id>', 'Playlist ID or URL')
  .option('--channel-id <id>', 'Channel ID, handle, or URL')
  .option('--limit <n>', 'Max videos for playlist/channel')
  .option('--lang <code>', 'Preferred language')
  .option('--text', 'Return plain text transcripts')
  .option('--wait', 'Wait for job completion')
  .action(async (opts) => {
    try {
      const client = getClient();
      const options = {
        videoIds: opts.videoIds?.split(',').map((s: string) => s.trim()),
        playlistId: opts.playlistId,
        channelId: opts.channelId,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        lang: opts.lang,
        text: opts.text,
      };
      const result = opts.wait
        ? await client.youtube.transcriptBatchAndWait(options)
        : await client.youtube.transcriptBatch(options);
      success(opts.wait ? 'Transcript batch completed' : 'Transcript batch started');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ytBatchCmd
  .command('video')
  .description('Start video metadata batch job')
  .option('--video-ids <ids>', 'Comma-separated video IDs or URLs')
  .option('--playlist-id <id>', 'Playlist ID or URL')
  .option('--channel-id <id>', 'Channel ID, handle, or URL')
  .option('--limit <n>', 'Max videos for playlist/channel')
  .option('--wait', 'Wait for job completion')
  .action(async (opts) => {
    try {
      const client = getClient();
      const options = {
        videoIds: opts.videoIds?.split(',').map((s: string) => s.trim()),
        playlistId: opts.playlistId,
        channelId: opts.channelId,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      };
      const result = opts.wait
        ? await client.youtube.videoBatchAndWait(options)
        : await client.youtube.videoBatch(options);
      success(opts.wait ? 'Video batch completed' : 'Video batch started');
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

ytBatchCmd
  .command('status <jobId>')
  .description('Get batch job status')
  .action(async (jobId: string) => {
    try {
      const client = getClient();
      const result = await client.youtube.getBatchJob(jobId);
      print(result, getRootFormat());
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Profile commands
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
      error(`Profile "${name}" does not exist`);
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
    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.supadata.ai/v1)')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key for active profile')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = apiKeyOverride || getApiKey();
    const baseUrl = getBaseUrl();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl || chalk.gray('default (https://api.supadata.ai/v1)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program.parse();
