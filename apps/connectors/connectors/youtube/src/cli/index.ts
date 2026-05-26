#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { YouTube } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getApiKey,
  setApiKey,
  clearConfig,
  getConfigDir,
  getBaseConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
  getChannelId,
  getDefaultChannelId,
  setDefaultChannelId,
  setNamedChannel,
  removeNamedChannel,
  listNamedChannels,
  getExportsDir,
  getImportsDir,
  getDownloadsDir,
  ensureDownloadsDir,
  getClientId,
  getClientSecret,
  setCredentials,
  saveTokens,
  clearTokens,
  isAuthenticated,
  loadTokens,
} from '../utils/config';
import { getAuthUrl, startCallbackServer, getValidAccessToken } from '../utils/auth';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, formatDuration, formatCount, formatDate } from '../utils/output';

const CONNECTOR_NAME = 'connect-youtube';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('YouTube Data API v3 and Analytics API CLI - Videos, channels, playlists, comments, live streams, and analytics')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
  .option('-k, --api-key <key>', 'API key for read-only operations (overrides config)')
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
    if (opts.token) {
      process.env.YOUTUBE_ACCESS_TOKEN = opts.token;
    }
    if (opts.apiKey) {
      process.env.YOUTUBE_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

async function getClient(): Promise<YouTube> {
  let accessToken = getAccessToken();
  const apiKey = getApiKey();

  // Try to refresh token if using OAuth and token is expired
  if (!accessToken && isAuthenticated()) {
    try {
      accessToken = await getValidAccessToken();
    } catch {
      // Fall through to error below
    }
  }

  if (!accessToken && !apiKey) {
    error(`No credentials configured. Run "${CONNECTOR_NAME} auth login" or "${CONNECTOR_NAME} config set-api-key <key>"`);
    process.exit(1);
  }
  return new YouTube({ accessToken, apiKey });
}

async function requireOAuth(): Promise<YouTube> {
  let accessToken = getAccessToken();

  // Try to refresh token if using OAuth and token is expired
  if (!accessToken && isAuthenticated()) {
    try {
      accessToken = await getValidAccessToken();
    } catch {
      // Fall through to error below
    }
  }

  if (!accessToken) {
    error('This operation requires OAuth authentication. Run "' + CONNECTOR_NAME + ' auth login"');
    process.exit(1);
  }
  return new YouTube({ accessToken });
}

function resolveChannelId(nameOrId?: string): string {
  const resolved = getChannelId(nameOrId);
  if (!resolved) {
    error(`No channel specified. Use --channel or set default with "${CONNECTOR_NAME} config set-channel <id>"`);
    process.exit(1);
  }
  return resolved;
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
  .option('--token <token>', 'OAuth access token')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
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
    const tokens = loadTokens();

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`Authenticated: ${isAuthenticated() ? chalk.green('yes') : chalk.gray('no')}`);
    if (tokens) {
      info(`Token expires: ${new Date(tokens.expiresAt).toLocaleString()}`);
    }
    info(`Manual Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Manage OAuth authentication');

authCmd
  .command('setup')
  .description('Set up OAuth credentials from a JSON file')
  .argument('<path>', 'Path to Google OAuth client secret JSON file')
  .action(async (path: string) => {
    try {
      const { readFileSync } = await import('fs');
      const content = readFileSync(path, 'utf-8');
      const data = JSON.parse(content);

      // Support both "installed" and "web" client types
      const client = data.installed || data.web;
      if (!client || !client.client_id || !client.client_secret) {
        error('Invalid OAuth client secret file');
        process.exit(1);
      }

      setCredentials(client.client_id, client.client_secret);
      success('OAuth credentials configured!');
      info(`Client ID: ${client.client_id.substring(0, 20)}...`);
      info('Now run "connect-youtube auth login" to authenticate.');
    } catch (err) {
      error(`Failed to read credentials file: ${String(err)}`);
      process.exit(1);
    }
  });

authCmd
  .command('login')
  .description('Authenticate with YouTube via OAuth (auto-creates profile from channel name)')
  .action(async () => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (!clientId || !clientSecret) {
      error('OAuth credentials not configured. Run "connect-youtube auth setup <path-to-credentials.json>" first.');
      process.exit(1);
    }

    try {
      const authUrl = getAuthUrl();
      info('Opening browser for authentication...');
      info(`If browser doesn't open, visit: ${authUrl}`);

      // Try to open browser
      const { exec } = await import('child_process');
      const openCmd = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${openCmd} "${authUrl}"`);

      info('Waiting for authentication callback...');
      const result = await startCallbackServer();

      if (result.success && result.tokens) {
        success('Authentication successful!');

        // Get channel info to create profile name
        try {
          const client = new YouTube({ accessToken: result.tokens.accessToken });
          const channel = await client.channels.getMine(['snippet']);

          if (channel && channel.snippet?.title) {
            const channelTitle = channel.snippet.title;

            // Convert channel name to profile slug: "My Channel" → "mychannel"
            const profileSlug = channelTitle.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

            // Create profile if it doesn't exist
            if (!profileExists(profileSlug)) {
              createProfile(profileSlug);
              info(`Created profile: ${profileSlug}`);
            }

            // Switch to the profile
            setCurrentProfile(profileSlug);
            setProfileOverride(profileSlug);

            // Save tokens to the new profile
            saveTokens(result.tokens);

            success(`Profile: ${profileSlug}`);
            info(`Channel: ${channelTitle}`);
            info(`Channel ID: ${channel.id}`);
            info(`Access token expires: ${new Date(result.tokens.expiresAt).toLocaleString()}`);
          } else {
            // Fallback: save to current profile if channel info unavailable
            saveTokens(result.tokens);
            info(`Access token expires: ${new Date(result.tokens.expiresAt).toLocaleString()}`);
          }
        } catch (err) {
          // Channel fetch failed but auth succeeded - save to current profile
          saveTokens(result.tokens);
          error(`Could not fetch channel info: ${String(err)}`);
          info('Tokens saved to current profile. You may need to enable YouTube Data API.');
        }
      } else {
        error(`Authentication failed: ${result.error}`);
        process.exit(1);
      }
    } catch (err) {
      error(`Authentication failed: ${String(err)}`);
      process.exit(1);
    }
  });

authCmd
  .command('logout')
  .description('Clear OAuth tokens for current profile')
  .action(() => {
    clearTokens();
    success('Logged out successfully');
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(async () => {
    const clientId = getClientId();
    const tokens = loadTokens();

    console.log(chalk.bold('Authentication Status:'));
    info(`Profile: ${getCurrentProfile()}`);
    info(`OAuth configured: ${clientId ? chalk.green('yes') : chalk.red('no')}`);
    info(`Logged in: ${tokens ? chalk.green('yes') : chalk.red('no')}`);

    if (tokens) {
      const expired = Date.now() >= tokens.expiresAt;
      info(`Token status: ${expired ? chalk.yellow('expired (will refresh)') : chalk.green('valid')}`);
      info(`Expires: ${new Date(tokens.expiresAt).toLocaleString()}`);

      // Try to get channel info
      try {
        const accessToken = await getValidAccessToken();
        const client = new YouTube({ accessToken });
        const channel = await client.channels.getMine(['snippet']);
        if (channel) {
          info(`Channel: ${channel.snippet?.title}`);
          info(`Channel ID: ${channel.id}`);
        }
      } catch (err) {
        info(`Channel: ${chalk.red('Unable to fetch - ' + String(err))}`);
      }
    }
  });

authCmd
  .command('refresh')
  .description('Manually refresh OAuth access token')
  .action(async () => {
    if (!isAuthenticated()) {
      error('Not authenticated. Run "connect-youtube auth login" first.');
      process.exit(1);
    }

    try {
      const accessToken = await getValidAccessToken();
      success('Token refreshed successfully!');
      const tokens = loadTokens();
      if (tokens) {
        info(`New token expires: ${new Date(tokens.expiresAt).toLocaleString()}`);
      }
    } catch (err) {
      error(`Failed to refresh token: ${String(err)}`);
      process.exit(1);
    }
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set OAuth access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-api-key <apiKey>')
  .description('Set API key (for read-only operations)')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const apiKey = getApiKey();
    const defaultChannel = getDefaultChannelId();
    const namedChannels = listNamedChannels();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    console.log();
    info(`Base directory: ${getBaseConfigDir()}`);
    info(`Profile directory: ${getConfigDir()}`);
    info(`Downloads directory: ${getDownloadsDir()}`);
    info(`Exports directory: ${getExportsDir()}`);
    info(`Imports directory: ${getImportsDir()}`);
    console.log();
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Default Channel: ${defaultChannel || chalk.gray('not set')}`);

    const channelNames = Object.keys(namedChannels);
    if (channelNames.length > 0) {
      console.log();
      info(`Named Channels:`);
      channelNames.forEach(name => {
        console.log(`  ${chalk.cyan(name)}: ${namedChannels[name]}`);
      });
    }
  });

configCmd
  .command('set-channel <channelId>')
  .description('Set default channel ID')
  .action((channelId: string) => {
    setDefaultChannelId(channelId);
    success(`Default channel set: ${channelId}`);
  });

configCmd
  .command('set-named-channel <name> <channelId>')
  .description('Set a named channel (e.g., main, vlog)')
  .action((name: string, channelId: string) => {
    setNamedChannel(name, channelId);
    success(`Channel "${name}" set to: ${channelId}`);
  });

configCmd
  .command('remove-named-channel <name>')
  .description('Remove a named channel')
  .action((name: string) => {
    if (removeNamedChannel(name)) {
      success(`Named channel "${name}" removed`);
    } else {
      error(`Named channel "${name}" not found`);
      process.exit(1);
    }
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Channels Commands
// ============================================
const channelsCmd = program
  .command('channels')
  .description('Manage YouTube channels');

channelsCmd
  .command('get [channelId]')
  .description('Get channel details (defaults to authenticated user\'s channel)')
  .option('--parts <parts>', 'Parts to include (comma-separated)', 'snippet,statistics,contentDetails')
  .action(async (channelId: string | undefined, opts) => {
    try {
      const client = await getClient();
      const parts = opts.parts.split(',');

      let result;
      if (channelId) {
        result = await client.channels.get(channelId, parts);
      } else {
        result = await client.channels.getMine(parts);
      }

      if (!result) {
        error('Channel not found');
        process.exit(1);
      }

      if (getFormat(channelsCmd) === 'json') {
        print(result, 'json');
      } else {
        console.log(chalk.bold(result.snippet?.title || 'Unknown'));
        if (result.snippet?.customUrl) {
          console.log(`  URL: youtube.com/${result.snippet.customUrl}`);
        }
        console.log(`  ID: ${result.id}`);
        if (result.statistics) {
          console.log(`  Subscribers: ${formatCount(result.statistics.subscriberCount)}`);
          console.log(`  Videos: ${formatCount(result.statistics.videoCount)}`);
          console.log(`  Views: ${formatCount(result.statistics.viewCount)}`);
        }
        if (result.snippet?.description) {
          console.log(`  Description: ${result.snippet.description.substring(0, 100)}...`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

channelsCmd
  .command('sections <channelId>')
  .description('List channel sections')
  .action(async (channelId: string) => {
    try {
      const client = await getClient();
      const result = await client.channels.listSections({
        part: ['snippet', 'contentDetails'],
        channelId,
      });
      print(result.items, getFormat(channelsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Videos Commands
// ============================================
const videosCmd = program
  .command('videos')
  .description('Manage YouTube videos');

videosCmd
  .command('list')
  .description('List videos')
  .option('--id <ids>', 'Video IDs (comma-separated)')
  .option('--chart <chart>', 'Chart to retrieve (mostPopular)')
  .option('--region <code>', 'Region code (e.g., US)')
  .option('--category <id>', 'Video category ID')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('--parts <parts>', 'Parts to include (comma-separated)', 'snippet,statistics,contentDetails')
  .action(async (opts) => {
    try {
      const client = await getClient();
      const parts = opts.parts.split(',');

      const result = await client.videos.list({
        part: parts,
        id: opts.id?.split(','),
        chart: opts.chart,
        regionCode: opts.region,
        videoCategoryId: opts.category,
        maxResults: parseInt(opts.limit),
      });

      if (getFormat(videosCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Videos (${result.pageInfo.totalResults} total):`);
        result.items.forEach(video => {
          console.log(`  ${chalk.bold(video.snippet?.title || 'Unknown')}`);
          console.log(`    ID: ${video.id}`);
          if (video.contentDetails?.duration) {
            console.log(`    Duration: ${formatDuration(video.contentDetails.duration)}`);
          }
          if (video.statistics) {
            console.log(`    Views: ${formatCount(video.statistics.viewCount)} | Likes: ${formatCount(video.statistics.likeCount || '0')}`);
          }
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('get <videoId>')
  .description('Get video details')
  .option('--parts <parts>', 'Parts to include (comma-separated)', 'snippet,statistics,contentDetails,status')
  .action(async (videoId: string, opts) => {
    try {
      const client = await getClient();
      const parts = opts.parts.split(',');
      const result = await client.videos.get(videoId, parts);

      if (!result) {
        error('Video not found');
        process.exit(1);
      }

      print(result, getFormat(videosCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('mine')
  .description('List my uploaded videos')
  .option('-l, --limit <number>', 'Maximum results', '25')
  .option('--parts <parts>', 'Parts to include (comma-separated)', 'snippet,statistics,contentDetails')
  .action(async (opts) => {
    try {
      const client = await requireOAuth();

      // Get user's channel to find uploads playlist
      const channel = await client.channels.getMine(['contentDetails']);
      if (!channel?.contentDetails?.relatedPlaylists?.uploads) {
        error('Could not find uploads playlist');
        process.exit(1);
      }

      const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;

      // Get videos from uploads playlist
      const playlistItems = await client.playlistItems.getAll(uploadsPlaylistId, parseInt(opts.limit));

      if (playlistItems.items.length === 0) {
        info('No videos found on your channel.');
        return;
      }

      // Get full video details
      const videoIds = playlistItems.items
        .map(item => item.contentDetails?.videoId)
        .filter(Boolean) as string[];

      const videos = await client.videos.list({
        part: opts.parts.split(','),
        id: videoIds,
      });

      if (getFormat(videosCmd) === 'json') {
        print(videos, 'json');
      } else {
        success(`Your videos (${playlistItems.pageInfo.totalResults} total):`);
        videos.items.forEach((video, i) => {
          console.log(`  ${i + 1}. ${chalk.bold(video.snippet?.title || 'Unknown')}`);
          console.log(`     ID: ${video.id}`);
          if (video.contentDetails?.duration) {
            console.log(`     Duration: ${formatDuration(video.contentDetails.duration)}`);
          }
          if (video.statistics) {
            console.log(`     Views: ${formatCount(video.statistics.viewCount)} | Likes: ${formatCount(video.statistics.likeCount || '0')}`);
          }
          console.log(`     Privacy: ${video.status?.privacyStatus || 'unknown'}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('download <videoId>')
  .description('Download a video using yt-dlp')
  .option('-o, --output <path>', 'Output file path or directory (default: profile downloads dir)')
  .option('--format <format>', 'Video format (e.g., best, mp4, 720p, 1080p)', 'best')
  .option('--audio-only', 'Download audio only (mp3)')
  .option('--list-formats', 'List available formats without downloading')
  .action(async (videoId: string, opts) => {
    try {
      const { execSync, spawn } = await import('child_process');

      // Check if yt-dlp is installed
      try {
        execSync('which yt-dlp', { stdio: 'ignore' });
      } catch {
        error('yt-dlp is not installed. Install it with: brew install yt-dlp');
        process.exit(1);
      }

      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      // List formats mode
      if (opts.listFormats) {
        info(`Available formats for ${videoId}:`);
        const result = execSync(`yt-dlp -F "${videoUrl}"`, { encoding: 'utf-8' });
        console.log(result);
        return;
      }

      // Use profile downloads directory as default
      const outputDir = opts.output || ensureDownloadsDir();

      // Build yt-dlp command
      const args: string[] = [];

      if (opts.audioOnly) {
        args.push('-x', '--audio-format', 'mp3');
      } else if (opts.format === 'mp4') {
        args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
      } else if (opts.format === '720p') {
        args.push('-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]');
      } else if (opts.format === '1080p') {
        args.push('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]');
      } else if (opts.format !== 'best') {
        args.push('-f', opts.format);
      }

      // Set output template
      args.push('-o', `${outputDir}/%(title)s.%(ext)s`);

      args.push('--progress', videoUrl);

      info(`Downloading video ${videoId} to ${outputDir}...`);

      const proc = spawn('yt-dlp', args, { stdio: 'inherit' });

      proc.on('close', (code) => {
        if (code === 0) {
          success('Download complete!');
        } else {
          error(`Download failed with code ${code}`);
          process.exit(1);
        }
      });

      proc.on('error', (err) => {
        error(`Download failed: ${err.message}`);
        process.exit(1);
      });
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('download-mine')
  .description('Download all videos from your channel')
  .option('-o, --output <dir>', 'Output directory (default: profile downloads dir)')
  .option('--format <format>', 'Video format (best, mp4, 720p, 1080p)', 'best')
  .option('--limit <number>', 'Maximum videos to download')
  .option('--dry-run', 'Show what would be downloaded without downloading')
  .action(async (opts) => {
    try {
      const { execSync } = await import('child_process');

      // Check if yt-dlp is installed
      try {
        execSync('which yt-dlp', { stdio: 'ignore' });
      } catch {
        error('yt-dlp is not installed. Install it with: brew install yt-dlp');
        process.exit(1);
      }

      const client = await requireOAuth();

      // Get user's channel to find uploads playlist
      const channel = await client.channels.getMine(['contentDetails', 'snippet']);
      if (!channel?.contentDetails?.relatedPlaylists?.uploads) {
        error('Could not find uploads playlist');
        process.exit(1);
      }

      info(`Channel: ${channel.snippet?.title}`);

      const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
      const limit = opts.limit ? parseInt(opts.limit) : 500;

      // Get videos from uploads playlist
      const playlistItems = await client.playlistItems.getAll(uploadsPlaylistId, limit);

      if (playlistItems.items.length === 0) {
        info('No videos found on your channel.');
        return;
      }

      info(`Found ${playlistItems.items.length} videos`);

      // Use profile downloads directory as default
      const outputDir = opts.output || ensureDownloadsDir();
      info(`Download directory: ${outputDir}`);

      if (opts.dryRun) {
        success('Videos that would be downloaded:');
        playlistItems.items.forEach((item, i) => {
          console.log(`  ${i + 1}. ${item.snippet?.title} (${item.contentDetails?.videoId})`);
        });
        return;
      }

      // Build format string
      let formatStr = '';
      if (opts.format === 'mp4') {
        formatStr = '-f bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
      } else if (opts.format === '720p') {
        formatStr = '-f bestvideo[height<=720]+bestaudio/best[height<=720]';
      } else if (opts.format === '1080p') {
        formatStr = '-f bestvideo[height<=1080]+bestaudio/best[height<=1080]';
      }

      // Download each video
      for (let i = 0; i < playlistItems.items.length; i++) {
        const item = playlistItems.items[i];
        const videoId = item.contentDetails?.videoId;
        const title = item.snippet?.title || 'Unknown';

        if (!videoId) continue;

        info(`[${i + 1}/${playlistItems.items.length}] Downloading: ${title}`);

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const outputTemplate = `${outputDir}/%(title)s.%(ext)s`;

        try {
          execSync(
            `yt-dlp ${formatStr} -o "${outputTemplate}" --no-overwrites "${videoUrl}"`,
            { stdio: 'inherit' }
          );
          success(`Downloaded: ${title}`);
        } catch (err) {
          error(`Failed to download: ${title}`);
        }
      }

      success(`\nDownload complete! ${playlistItems.items.length} videos processed.`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('upload <filePath>')
  .description('Upload a video')
  .requiredOption('--title <title>', 'Video title')
  .option('--description <description>', 'Video description')
  .option('--tags <tags>', 'Tags (comma-separated)')
  .option('--category <id>', 'Category ID', '22')
  .option('--privacy <status>', 'Privacy status (public, private, unlisted)', 'private')
  .action(async (filePath: string, opts) => {
    try {
      const client = await requireOAuth();
      const { readFileSync } = await import('fs');

      info(`Reading file: ${filePath}`);
      const videoData = readFileSync(filePath);

      info(`Uploading video (${(videoData.length / 1024 / 1024).toFixed(1)} MB)...`);

      const metadata = {
        snippet: {
          title: opts.title,
          description: opts.description || '',
          tags: opts.tags?.split(','),
          categoryId: opts.category,
        },
        status: {
          privacyStatus: opts.privacy,
        },
      };
      const result = await client.videos.uploadResumable(
        videoData,
        metadata as any,
        { part: ['snippet', 'status'] },
        (progress) => {
          process.stdout.write(`\rProgress: ${progress.percentage}%`);
        }
      );

      console.log();
      success('Video uploaded!');
      console.log(`  ID: ${result.id}`);
      console.log(`  URL: https://youtube.com/watch?v=${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('update <videoId>')
  .description('Update video metadata')
  .option('--title <title>', 'New title')
  .option('--description <description>', 'New description')
  .option('--tags <tags>', 'New tags (comma-separated)')
  .option('--privacy <status>', 'Privacy status (public, private, unlisted)')
  .action(async (videoId: string, opts) => {
    try {
      const client = await requireOAuth();
      const parts: string[] = [];
      const video: Record<string, unknown> = { id: videoId };

      if (opts.title || opts.description || opts.tags) {
        parts.push('snippet');
        video.snippet = {};
        if (opts.title) (video.snippet as Record<string, unknown>).title = opts.title;
        if (opts.description) (video.snippet as Record<string, unknown>).description = opts.description;
        if (opts.tags) (video.snippet as Record<string, unknown>).tags = opts.tags.split(',');
      }

      if (opts.privacy) {
        parts.push('status');
        video.status = { privacyStatus: opts.privacy };
      }

      if (parts.length === 0) {
        error('No updates specified');
        process.exit(1);
      }

      const result = await client.videos.update(video as any, { part: parts });
      success('Video updated!');
      print(result, getFormat(videosCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('delete <videoId>')
  .description('Delete a video')
  .action(async (videoId: string) => {
    try {
      const client = await requireOAuth();
      await client.videos.delete(videoId);
      success('Video deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

videosCmd
  .command('rate <videoId>')
  .description('Rate a video')
  .requiredOption('-r, --rating <rating>', 'Rating (like, dislike, none)')
  .action(async (videoId: string, opts) => {
    try {
      const client = await requireOAuth();
      await client.videos.rate(videoId, opts.rating);
      success(`Video rated: ${opts.rating}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Playlists Commands
// ============================================
const playlistsCmd = program
  .command('playlists')
  .description('Manage YouTube playlists');

playlistsCmd
  .command('list')
  .description('List playlists')
  .option('--mine', 'List my playlists')
  .option('--channel <channelId>', 'List playlists for a channel')
  .option('-l, --limit <number>', 'Maximum results', '25')
  .action(async (opts) => {
    try {
      const client = await getClient();

      let result;
      if (opts.mine) {
        result = await client.playlists.getMine(parseInt(opts.limit));
      } else if (opts.channel) {
        result = await client.playlists.getByChannel(opts.channel, parseInt(opts.limit));
      } else {
        error('Specify --mine or --channel <channelId>');
        process.exit(1);
      }

      if (getFormat(playlistsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Playlists (${result.pageInfo.totalResults} total):`);
        result.items.forEach(playlist => {
          console.log(`  ${chalk.bold(playlist.snippet?.title || 'Unknown')}`);
          console.log(`    ID: ${playlist.id}`);
          console.log(`    Items: ${playlist.contentDetails?.itemCount || 0}`);
          console.log(`    Privacy: ${playlist.status?.privacyStatus || 'unknown'}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

playlistsCmd
  .command('create')
  .description('Create a new playlist')
  .requiredOption('--title <title>', 'Playlist title')
  .option('--description <description>', 'Playlist description')
  .option('--privacy <status>', 'Privacy status (public, private, unlisted)', 'private')
  .action(async (opts) => {
    try {
      const client = await requireOAuth();
      const result = await client.playlists.create(
        opts.title,
        opts.description,
        opts.privacy
      );
      success('Playlist created!');
      console.log(`  ID: ${result.id}`);
      console.log(`  URL: https://youtube.com/playlist?list=${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

playlistsCmd
  .command('update <playlistId>')
  .description('Update a playlist')
  .option('--title <title>', 'New title')
  .option('--description <description>', 'New description')
  .option('--privacy <status>', 'Privacy status (public, private, unlisted)')
  .action(async (playlistId: string, opts) => {
    try {
      const client = await requireOAuth();
      const result = await client.playlists.updateMetadata(
        playlistId,
        opts.title,
        opts.description,
        opts.privacy
      );
      success('Playlist updated!');
      print(result, getFormat(playlistsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

playlistsCmd
  .command('delete <playlistId>')
  .description('Delete a playlist')
  .action(async (playlistId: string) => {
    try {
      const client = await requireOAuth();
      await client.playlists.delete(playlistId);
      success('Playlist deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Playlist Items Commands
// ============================================
const playlistItemsCmd = program
  .command('playlist-items')
  .description('Manage playlist items');

playlistItemsCmd
  .command('list <playlistId>')
  .description('List items in a playlist')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .action(async (playlistId: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.playlistItems.getAll(playlistId, parseInt(opts.limit));

      if (getFormat(playlistItemsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Playlist items (${result.pageInfo.totalResults} total):`);
        result.items.forEach((item, i) => {
          console.log(`  ${i + 1}. ${chalk.bold(item.snippet?.title || 'Unknown')}`);
          console.log(`     Video ID: ${item.contentDetails?.videoId}`);
          console.log(`     Item ID: ${item.id}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

playlistItemsCmd
  .command('add <playlistId> <videoId>')
  .description('Add a video to a playlist')
  .option('--position <number>', 'Position in playlist')
  .action(async (playlistId: string, videoId: string, opts) => {
    try {
      const client = await requireOAuth();
      const result = await client.playlistItems.add(
        playlistId,
        videoId,
        opts.position ? parseInt(opts.position) : undefined
      );
      success('Video added to playlist!');
      console.log(`  Item ID: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

playlistItemsCmd
  .command('remove <playlistItemId>')
  .description('Remove an item from a playlist')
  .action(async (playlistItemId: string) => {
    try {
      const client = await requireOAuth();
      await client.playlistItems.delete(playlistItemId);
      success('Item removed from playlist');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Search Commands
// ============================================
const searchCmd = program
  .command('search')
  .description('Search YouTube');

searchCmd
  .command('videos <query>')
  .description('Search for videos')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('--order <order>', 'Sort order (date, rating, relevance, title, viewCount)', 'relevance')
  .option('--region <code>', 'Region code (e.g., US)')
  .option('--duration <duration>', 'Duration filter (short, medium, long)')
  .option('--definition <def>', 'Definition filter (high, standard)')
  .action(async (query: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.search.videos(query, {
        maxResults: parseInt(opts.limit),
        order: opts.order,
        regionCode: opts.region,
        videoDuration: opts.duration,
        videoDefinition: opts.definition,
      });

      if (getFormat(searchCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Search results for "${query}":`);
        result.items.forEach(item => {
          console.log(`  ${chalk.bold(item.snippet?.title || 'Unknown')}`);
          console.log(`    ID: ${item.id.videoId}`);
          console.log(`    Channel: ${item.snippet?.channelTitle}`);
          console.log(`    Published: ${formatDate(item.snippet?.publishedAt || '')}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('channels <query>')
  .description('Search for channels')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .action(async (query: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.search.channels(query, {
        maxResults: parseInt(opts.limit),
      });

      if (getFormat(searchCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Channels matching "${query}":`);
        result.items.forEach(item => {
          console.log(`  ${chalk.bold(item.snippet?.title || 'Unknown')}`);
          console.log(`    ID: ${item.id.channelId}`);
          console.log(`    Description: ${(item.snippet?.description || '').substring(0, 80)}...`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

searchCmd
  .command('playlists <query>')
  .description('Search for playlists')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .action(async (query: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.search.playlists(query, {
        maxResults: parseInt(opts.limit),
      });

      if (getFormat(searchCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Playlists matching "${query}":`);
        result.items.forEach(item => {
          console.log(`  ${chalk.bold(item.snippet?.title || 'Unknown')}`);
          console.log(`    ID: ${item.id.playlistId}`);
          console.log(`    Channel: ${item.snippet?.channelTitle}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Comments Commands
// ============================================
const commentsCmd = program
  .command('comments')
  .description('Manage comments');

commentsCmd
  .command('list <videoId>')
  .description('List comments on a video')
  .option('-l, --limit <number>', 'Maximum results', '20')
  .option('--order <order>', 'Sort order (relevance, time)', 'relevance')
  .action(async (videoId: string, opts) => {
    try {
      const client = await getClient();
      const result = await client.commentThreads.getForVideo(videoId, {
        maxResults: parseInt(opts.limit),
        order: opts.order,
      });

      if (getFormat(commentsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Comments (${result.pageInfo.totalResults} total):`);
        result.items.forEach(thread => {
          const comment = thread.snippet.topLevelComment;
          console.log(`  ${chalk.bold(comment.snippet.authorDisplayName)}`);
          console.log(`    ${comment.snippet.textDisplay.substring(0, 100)}...`);
          console.log(`    Likes: ${comment.snippet.likeCount} | Replies: ${thread.snippet.totalReplyCount}`);
          console.log(`    ID: ${thread.id}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentsCmd
  .command('reply <commentId> <text>')
  .description('Reply to a comment')
  .action(async (commentId: string, text: string) => {
    try {
      const client = await requireOAuth();
      const result = await client.comments.reply(commentId, text);
      success('Reply posted!');
      console.log(`  ID: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentsCmd
  .command('delete <commentId>')
  .description('Delete a comment')
  .action(async (commentId: string) => {
    try {
      const client = await requireOAuth();
      await client.comments.delete(commentId);
      success('Comment deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

commentsCmd
  .command('moderate <commentIds>')
  .description('Moderate comments')
  .requiredOption('--status <status>', 'Moderation status (heldForReview, published, rejected, likelySpam)')
  .option('--ban', 'Ban the author (for rejected)')
  .action(async (commentIds: string, opts) => {
    try {
      const client = await requireOAuth();
      const ids = commentIds.split(',');
      await client.comments.setModerationStatus(ids, opts.status, opts.ban);
      success(`Comments moderation status set to: ${opts.status}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Subscriptions Commands
// ============================================
const subscriptionsCmd = program
  .command('subscriptions')
  .description('Manage subscriptions');

subscriptionsCmd
  .command('list')
  .description('List my subscriptions')
  .option('-l, --limit <number>', 'Maximum results', '25')
  .option('--order <order>', 'Sort order (alphabetical, relevance, unread)', 'relevance')
  .action(async (opts) => {
    try {
      const client = await requireOAuth();
      const result = await client.subscriptions.getMine(parseInt(opts.limit), opts.order);

      if (getFormat(subscriptionsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Subscriptions (${result.pageInfo.totalResults} total):`);
        result.items.forEach(sub => {
          console.log(`  ${chalk.bold(sub.snippet?.title || 'Unknown')}`);
          console.log(`    Channel: ${sub.snippet?.resourceId.channelId}`);
          console.log(`    Videos: ${sub.contentDetails?.totalItemCount || 0}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionsCmd
  .command('subscribe <channelId>')
  .description('Subscribe to a channel')
  .action(async (channelId: string) => {
    try {
      const client = await requireOAuth();
      const result = await client.subscriptions.subscribe(channelId);
      success('Subscribed!');
      console.log(`  Subscription ID: ${result.id}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

subscriptionsCmd
  .command('unsubscribe <channelId>')
  .description('Unsubscribe from a channel')
  .action(async (channelId: string) => {
    try {
      const client = await requireOAuth();
      const unsubscribed = await client.subscriptions.unsubscribe(channelId);
      if (unsubscribed) {
        success('Unsubscribed');
      } else {
        info('Not subscribed to this channel');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Captions Commands
// ============================================
const captionsCmd = program
  .command('captions')
  .description('Manage video captions');

captionsCmd
  .command('list <videoId>')
  .description('List captions for a video')
  .action(async (videoId: string) => {
    try {
      const client = await requireOAuth();
      const result = await client.captions.getForVideo(videoId);

      if (getFormat(captionsCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Captions:`);
        result.items.forEach(caption => {
          console.log(`  ${chalk.bold(caption.snippet.name || caption.snippet.language)}`);
          console.log(`    ID: ${caption.id}`);
          console.log(`    Language: ${caption.snippet.language}`);
          console.log(`    Kind: ${caption.snippet.trackKind}`);
          console.log(`    Status: ${caption.snippet.status}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

captionsCmd
  .command('download <captionId>')
  .description('Download a caption track')
  .option('--format <format>', 'Format (srt, vtt, ttml, sbv, scc)', 'srt')
  .option('-o, --output <file>', 'Output file')
  .action(async (captionId: string, opts) => {
    try {
      const client = await requireOAuth();
      const content = await client.captions.download(captionId, { tfmt: opts.format });

      if (opts.output) {
        const { writeFileSync } = await import('fs');
        writeFileSync(opts.output, content);
        success(`Caption saved to: ${opts.output}`);
      } else {
        console.log(content);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

captionsCmd
  .command('delete <captionId>')
  .description('Delete a caption track')
  .action(async (captionId: string) => {
    try {
      const client = await requireOAuth();
      await client.captions.delete(captionId);
      success('Caption deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Thumbnails Commands
// ============================================
const thumbnailsCmd = program
  .command('thumbnails')
  .description('Manage video thumbnails');

thumbnailsCmd
  .command('set <videoId> <imagePath>')
  .description('Set a custom thumbnail for a video')
  .action(async (videoId: string, imagePath: string) => {
    try {
      const client = await requireOAuth();
      const result = await client.thumbnails.setFromFile(videoId, imagePath);
      success('Thumbnail set!');
      print(result.items[0], getFormat(thumbnailsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Live Commands
// ============================================
const liveCmd = program
  .command('live')
  .description('Manage live broadcasts and streams');

liveCmd
  .command('broadcasts')
  .description('List my live broadcasts')
  .option('--status <status>', 'Filter by status (active, all, completed, upcoming)')
  .option('-l, --limit <number>', 'Maximum results', '25')
  .action(async (opts) => {
    try {
      const client = await requireOAuth();
      const result = await client.live.getMyBroadcasts(opts.status, parseInt(opts.limit));

      if (getFormat(liveCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Broadcasts (${result.pageInfo.totalResults} total):`);
        result.items.forEach(broadcast => {
          console.log(`  ${chalk.bold(broadcast.snippet?.title || 'Unknown')}`);
          console.log(`    ID: ${broadcast.id}`);
          console.log(`    Status: ${broadcast.status?.lifeCycleStatus}`);
          console.log(`    Scheduled: ${broadcast.snippet?.scheduledStartTime}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

liveCmd
  .command('streams')
  .description('List my live streams')
  .option('-l, --limit <number>', 'Maximum results', '25')
  .action(async (opts) => {
    try {
      const client = await requireOAuth();
      const result = await client.live.getMyStreams(parseInt(opts.limit));

      if (getFormat(liveCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Streams (${result.pageInfo.totalResults} total):`);
        result.items.forEach(stream => {
          console.log(`  ${chalk.bold(stream.snippet?.title || 'Unknown')}`);
          console.log(`    ID: ${stream.id}`);
          console.log(`    Status: ${stream.status?.streamStatus}`);
          if (stream.cdn?.ingestionInfo) {
            console.log(`    Stream Key: ${stream.cdn.ingestionInfo.streamName.substring(0, 10)}...`);
          }
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

liveCmd
  .command('chat <liveChatId>')
  .description('View live chat messages')
  .option('-l, --limit <number>', 'Maximum results', '50')
  .action(async (liveChatId: string, opts) => {
    try {
      const client = await requireOAuth();
      const result = await client.live.getChatMessages(liveChatId, parseInt(opts.limit));

      if (getFormat(liveCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Chat messages (polling interval: ${result.pollingIntervalMillis}ms):`);
        result.items.forEach(msg => {
          const author = msg.authorDetails?.displayName || 'Unknown';
          const text = msg.snippet?.displayMessage || msg.snippet?.textMessageDetails?.messageText || '';
          console.log(`  ${chalk.bold(author)}: ${text}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Analytics Commands
// ============================================
const analyticsCmd = program
  .command('analytics')
  .description('YouTube Analytics');

analyticsCmd
  .command('report')
  .description('Get analytics report')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--channel <channelId>', 'Channel ID (defaults to authenticated user)')
  .option('--metrics <metrics>', 'Metrics (comma-separated)', 'views,estimatedMinutesWatched,subscribersGained')
  .option('--dimensions <dimensions>', 'Dimensions (comma-separated)')
  .option('--filters <filters>', 'Filters')
  .option('-l, --limit <number>', 'Maximum results')
  .action(async (opts) => {
    try {
      const client = await requireOAuth();
      const result = await client.analytics.query({
        ids: opts.channel ? `channel==${opts.channel}` : 'channel==MINE',
        startDate: opts.start,
        endDate: opts.end,
        metrics: opts.metrics,
        dimensions: opts.dimensions,
        filters: opts.filters,
        maxResults: opts.limit ? parseInt(opts.limit) : undefined,
      });

      print(result, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

analyticsCmd
  .command('groups')
  .description('List analytics groups')
  .action(async () => {
    try {
      const client = await requireOAuth();
      const result = await client.analytics.getMyGroups();
      print(result.items, getFormat(analyticsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Members Commands
// ============================================
const membersCmd = program
  .command('members')
  .description('Manage channel memberships');

membersCmd
  .command('list')
  .description('List channel members')
  .option('-l, --limit <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const client = await requireOAuth();
      const result = await client.members.getAllCurrent(parseInt(opts.limit));

      if (getFormat(membersCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Members (${result.pageInfo.totalResults} total):`);
        result.items.forEach(member => {
          const details = member.snippet.memberDetails;
          console.log(`  ${chalk.bold(details.displayName)}`);
          console.log(`    Channel: ${details.channelId}`);
          console.log(`    Level: ${member.snippet.membershipsDetails.highestAccessibleLevelDisplayName}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

membersCmd
  .command('levels')
  .description('List membership levels')
  .action(async () => {
    try {
      const client = await requireOAuth();
      const result = await client.members.getLevels();

      if (getFormat(membersCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Membership levels:`);
        result.items.forEach(level => {
          console.log(`  ${chalk.bold(level.snippet.levelDetails.displayName)}`);
          console.log(`    ID: ${level.id}`);
          console.log();
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Categories Commands
// ============================================
const categoriesCmd = program
  .command('categories')
  .description('Video categories and i18n');

categoriesCmd
  .command('list')
  .description('List video categories')
  .option('--region <code>', 'Region code (e.g., US)', 'US')
  .action(async (opts) => {
    try {
      const client = await getClient();
      const result = await client.categories.getForRegion(opts.region);

      if (getFormat(categoriesCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Video categories for ${opts.region}:`);
        result.items.forEach(cat => {
          if (cat.snippet.assignable) {
            console.log(`  ${cat.id}: ${cat.snippet.title}`);
          }
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

categoriesCmd
  .command('languages')
  .description('List supported languages')
  .action(async () => {
    try {
      const client = await getClient();
      const result = await client.categories.getLanguages();

      if (getFormat(categoriesCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Supported languages:`);
        result.items.forEach(lang => {
          console.log(`  ${lang.snippet.hl}: ${lang.snippet.name}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

categoriesCmd
  .command('regions')
  .description('List supported regions')
  .action(async () => {
    try {
      const client = await getClient();
      const result = await client.categories.getRegions();

      if (getFormat(categoriesCmd) === 'json') {
        print(result, 'json');
      } else {
        success(`Supported regions:`);
        result.items.forEach(region => {
          console.log(`  ${region.snippet.gl}: ${region.snippet.name}`);
        });
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
