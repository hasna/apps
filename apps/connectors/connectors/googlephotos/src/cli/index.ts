#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { GooglePhotos } from '../api';
import { BulkApi } from '../api/bulk';
import {
  getClientId,
  getClientSecret,
  setCredentials,
  clearConfig,
  isAuthenticated,
  loadTokens,
  saveTokens,
  getUserEmail,
  setUserEmail,
  getConfigDir,
  getBaseConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  ensureDownloadsDir,
} from '../utils/config';
import {
  getAuthUrl,
  startCallbackServer,
  getUserInfo,
} from '../utils/auth';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn, formatBytes } from '../utils/output';

const program = new Command();

program
  .name('connect-googlephotos')
  .description('Google Photos API connector CLI - Browse, download, and upload photos with ease')
  .version('0.1.0')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    // Set profile override before any command runs
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "connect-googlephotos profiles create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to check authentication
function requireAuth(): GooglePhotos {
  if (!isAuthenticated()) {
    error('Not authenticated. Run "connect-googlephotos auth login" first.');
    process.exit(1);
  }
  return GooglePhotos.create();
}

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Authentication commands');

authCmd
  .command('login')
  .description('Login to Google Photos via OAuth2 (opens browser) - auto-creates profile from email')
  .action(async () => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (!clientId || !clientSecret) {
      error('OAuth credentials not configured.');
      info('Run "connect-googlephotos config set-credentials <client-id> <client-secret>" first.');
      info('Or set GOOGLE_PHOTOS_CLIENT_ID and GOOGLE_PHOTOS_CLIENT_SECRET environment variables.');
      process.exit(1);
    }

    info('Starting OAuth2 authentication flow...');
    info('A browser window will open for you to authorize the application.');

    // Start callback server first
    const serverPromise = startCallbackServer();

    // Open browser to auth URL
    const authUrl = getAuthUrl();
    await open(authUrl);

    info('Waiting for authentication...');

    const result = await serverPromise;

    if (result.success) {
      success('Successfully authenticated!');

      // Get user profile and create/switch to profile named after email
      try {
        // Temporarily switch to default profile
        setProfileOverride('default');

        // Save tokens to default profile first
        if (result.tokens) {
          saveTokens(result.tokens);
        }

        // Get user email
        const userInfo = await getUserInfo(result.tokens!.accessToken);
        const email = userInfo.email;

        // Convert email to profile slug: user@example.com → userexamplecom
        const profileSlug = email.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

        // Create profile if it doesn't exist
        if (!profileExists(profileSlug)) {
          createProfile(profileSlug);
          info(`Created profile: ${profileSlug}`);
        }

        // Switch to the profile and save credentials there
        setCurrentProfile(profileSlug);
        setProfileOverride(profileSlug);

        // Save tokens and email to the new profile
        setUserEmail(email);

        // Re-save tokens to the correct profile
        if (result.tokens) {
          saveTokens(result.tokens);
        }

        success(`Profile: ${profileSlug}`);
        info(`Email: ${email}`);
      } catch (err) {
        // Profile fetch failed but auth succeeded
        warn(`Could not auto-create profile: ${err}`);
      }
    } else {
      error(`Authentication failed: ${result.error}`);
      process.exit(1);
    }
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(async () => {
    if (isAuthenticated()) {
      const tokens = loadTokens();
      const email = getUserEmail();
      success('Authenticated');
      if (email) {
        info(`Email: ${email}`);
      }
      if (tokens) {
        const expiresIn = Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000 / 60));
        info(`Access token expires in: ${expiresIn} minutes`);
        info(`Has refresh token: ${tokens.refreshToken ? 'Yes' : 'No'}`);
      }
    } else {
      warn('Not authenticated');
      info('Run "connect-googlephotos auth login" to authenticate.');
    }
  });

authCmd
  .command('logout')
  .description('Clear stored authentication tokens')
  .action(() => {
    clearConfig();
    success('Logged out successfully');
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-credentials <clientId> <clientSecret>')
  .description('Set OAuth2 client credentials')
  .action((clientId: string, clientSecret: string) => {
    setCredentials(clientId, clientSecret);
    success('OAuth credentials saved successfully');
    info(`Config stored in: ${getBaseConfigDir()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const email = getUserEmail();
    const tokens = loadTokens();

    info(`Base config directory: ${getBaseConfigDir()}`);
    info(`Profile config directory: ${getConfigDir()}`);
    info(`Client ID: ${clientId ? `${clientId.substring(0, 20)}...` : chalk.gray('not set')}`);
    info(`Client Secret: ${clientSecret ? '********' : chalk.gray('not set')}`);
    info(`Authenticated: ${isAuthenticated() ? chalk.green('Yes') : chalk.red('No')}`);
    if (email) {
      info(`Email: ${email}`);
    }
    if (tokens) {
      info(`Token expires: ${new Date(tokens.expiresAt).toLocaleString()}`);
    }
  });

configCmd
  .command('clear')
  .description('Clear all configuration and tokens')
  .action(() => {
    clearConfig();
    success('Configuration cleared');
  });

// ============================================
// Profiles Management Commands
// ============================================
const profilesCmd = program
  .command('profiles')
  .description('Manage multiple Google Photos profiles');

profilesCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    try {
      const profiles = listProfiles();
      const current = getCurrentProfile();

      if (profiles.length === 0) {
        info('No profiles found');
        return;
      }

      success(`${profiles.length} profile(s):`);
      for (const p of profiles) {
        if (p === current) {
          info(`  ${chalk.green('→')} ${p} ${chalk.gray('(current)')}`);
        } else {
          info(`    ${p}`);
        }
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('current')
  .description('Show current profile')
  .action(() => {
    const current = getCurrentProfile();
    info(`Current profile: ${chalk.green(current)}`);
    info(`Config directory: ${getConfigDir()}`);
  });

profilesCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      createProfile(name);
      success(`Profile "${name}" created`);
      info(`Switch to it with: connect-googlephotos profiles switch ${name}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('switch <name>')
  .alias('use')
  .description('Switch to a different profile')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      success(`Switched to profile "${name}"`);
      info(`Config directory: ${getConfigDir()}`);

      // Show auth status for the new profile
      if (isAuthenticated()) {
        const email = getUserEmail();
        if (email) {
          info(`Logged in as: ${email}`);
        }
      } else {
        warn('Profile not authenticated. Run "connect-googlephotos auth login"');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('delete <name>')
  .description('Delete a profile')
  .action((name: string) => {
    try {
      deleteProfile(name);
      success(`Profile "${name}" deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('show')
  .description('Show all profiles with their status')
  .action(async () => {
    try {
      const profiles = listProfiles();
      const current = getCurrentProfile();

      if (profiles.length === 0) {
        info('No profiles found');
        return;
      }

      success(`${profiles.length} profile(s):\n`);

      for (const p of profiles) {
        // Temporarily switch to profile to check status
        setProfileOverride(p);
        const authenticated = isAuthenticated();
        const email = authenticated ? getUserEmail() : null;
        setProfileOverride(undefined);

        const isCurrent = p === current;
        const marker = isCurrent ? chalk.green('→') : ' ';
        const status = authenticated ? chalk.green('authenticated') : chalk.yellow('not authenticated');
        const emailStr = email ? chalk.gray(`(${email})`) : '';
        const currentStr = isCurrent ? chalk.gray(' [current]') : '';

        info(`  ${marker} ${p}${currentStr}`);
        info(`      Status: ${status} ${emailStr}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Albums Commands
// ============================================
const albumsCmd = program
  .command('albums')
  .description('Album management commands');

albumsCmd
  .command('list')
  .description('List all albums')
  .option('-n, --max <number>', 'Maximum albums to return', '50')
  .option('--shared', 'List shared albums instead')
  .action(async (opts) => {
    try {
      const photos = requireAuth();

      let albums;
      if (opts.shared) {
        const response = await photos.albums.listShared({ pageSize: parseInt(opts.max) });
        albums = response.albums || [];
      } else {
        const response = await photos.albums.list({ pageSize: parseInt(opts.max) });
        albums = response.albums || [];
      }

      if (albums.length === 0) {
        info('No albums found');
        return;
      }

      success(`Found ${albums.length} album(s):`);

      const formatted = albums.map(album => ({
        id: album.id,
        title: album.title,
        itemCount: album.mediaItemsCount || '0',
        shared: album.shareInfo ? 'Yes' : 'No',
      }));

      print(formatted, getFormat(albumsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

albumsCmd
  .command('get <albumId>')
  .description('Get album details')
  .action(async (albumId: string) => {
    try {
      const photos = requireAuth();
      const album = await photos.albums.get(albumId);
      print(album, getFormat(albumsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

albumsCmd
  .command('create <title>')
  .description('Create a new album')
  .action(async (title: string) => {
    try {
      const photos = requireAuth();
      const album = await photos.albums.create(title);
      success(`Album created: ${album.title}`);
      info(`Album ID: ${album.id}`);
      info(`URL: ${album.productUrl}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

albumsCmd
  .command('share <albumId>')
  .description('Share an album')
  .option('--collaborative', 'Allow others to add photos')
  .option('--commentable', 'Allow comments')
  .action(async (albumId: string, opts) => {
    try {
      const photos = requireAuth();
      const result = await photos.albums.share(albumId, {
        isCollaborative: opts.collaborative || false,
        isCommentable: opts.commentable || false,
      });
      success('Album shared!');
      info(`Share URL: ${result.shareInfo.shareableUrl}`);
      info(`Share token: ${result.shareInfo.shareToken}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

albumsCmd
  .command('unshare <albumId>')
  .description('Unshare an album')
  .action(async (albumId: string) => {
    try {
      const photos = requireAuth();
      await photos.albums.unshare(albumId);
      success('Album unshared');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

albumsCmd
  .command('contents <albumId>')
  .description('List media items in an album')
  .option('-n, --max <number>', 'Maximum items to return', '25')
  .action(async (albumId: string, opts) => {
    try {
      const photos = requireAuth();
      const items = await photos.media.getInAlbum(albumId);

      if (items.length === 0) {
        info('No items in album');
        return;
      }

      success(`Found ${items.length} item(s) in album:`);

      const formatted = items.slice(0, parseInt(opts.max)).map(item => ({
        id: item.id,
        filename: item.filename,
        type: item.mediaMetadata.photo ? 'Photo' : 'Video',
        created: item.mediaMetadata.creationTime,
        size: `${item.mediaMetadata.width}x${item.mediaMetadata.height}`,
      }));

      print(formatted, getFormat(albumsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Media Commands
// ============================================
const mediaCmd = program
  .command('media')
  .description('Media item commands');

mediaCmd
  .command('list')
  .description('List media items in your library')
  .option('-n, --max <number>', 'Maximum items to return', '25')
  .action(async (opts) => {
    try {
      const photos = requireAuth();
      const response = await photos.media.list({ pageSize: parseInt(opts.max) });

      if (!response.mediaItems || response.mediaItems.length === 0) {
        info('No media items found');
        return;
      }

      success(`Found ${response.mediaItems.length} item(s):`);

      const formatted = response.mediaItems.map(item => ({
        id: item.id,
        filename: item.filename,
        type: item.mediaMetadata.photo ? 'Photo' : 'Video',
        created: item.mediaMetadata.creationTime,
        size: `${item.mediaMetadata.width}x${item.mediaMetadata.height}`,
      }));

      print(formatted, getFormat(mediaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediaCmd
  .command('get <mediaItemId>')
  .description('Get details of a specific media item')
  .action(async (mediaItemId: string) => {
    try {
      const photos = requireAuth();
      const item = await photos.media.get(mediaItemId);
      print(item, getFormat(mediaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediaCmd
  .command('search')
  .description('Search for media items')
  .option('--category <category>', 'Filter by category (LANDSCAPES, SELFIES, PEOPLE, PETS, etc.)')
  .option('--type <type>', 'Filter by type (PHOTO, VIDEO)')
  .option('--favorites', 'Only show favorites')
  .option('-n, --max <number>', 'Maximum items to return', '25')
  .action(async (opts) => {
    try {
      const photos = requireAuth();

      let items;
      if (opts.favorites) {
        items = await photos.media.getFavorites({ pageSize: parseInt(opts.max) });
      } else if (opts.category) {
        items = await photos.media.searchByCategory([opts.category.toUpperCase()], { pageSize: parseInt(opts.max) });
      } else if (opts.type) {
        items = await photos.media.searchByMediaType([opts.type.toUpperCase()], { pageSize: parseInt(opts.max) });
      } else {
        const response = await photos.media.search({ pageSize: parseInt(opts.max) });
        items = response.mediaItems || [];
      }

      if (items.length === 0) {
        info('No media items found');
        return;
      }

      success(`Found ${items.length} item(s):`);

      const formatted = items.slice(0, parseInt(opts.max)).map(item => ({
        id: item.id,
        filename: item.filename,
        type: item.mediaMetadata.photo ? 'Photo' : 'Video',
        created: item.mediaMetadata.creationTime,
      }));

      print(formatted, getFormat(mediaCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediaCmd
  .command('download <mediaItemId>')
  .description('Download a media item')
  .option('-o, --output <path>', 'Output file path')
  .option('-w, --width <number>', 'Width for photos')
  .option('-h, --height <number>', 'Height for photos')
  .action(async (mediaItemId: string, opts) => {
    try {
      const photos = requireAuth();
      const item = await photos.media.get(mediaItemId);

      info(`Downloading: ${item.filename}`);

      const buffer = await photos.media.download(
        item,
        opts.width ? parseInt(opts.width) : undefined,
        opts.height ? parseInt(opts.height) : undefined
      );

      const outputPath = opts.output || join(ensureDownloadsDir(), item.filename);
      writeFileSync(outputPath, buffer);

      success(`Downloaded to: ${outputPath}`);
      info(`Size: ${formatBytes(buffer.length)}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

mediaCmd
  .command('url <mediaItemId>')
  .description('Get download URL for a media item')
  .option('-w, --width <number>', 'Width for photos')
  .option('-h, --height <number>', 'Height for photos')
  .action(async (mediaItemId: string, opts) => {
    try {
      const photos = requireAuth();
      const item = await photos.media.get(mediaItemId);

      const url = photos.media.getDownloadUrl(
        item,
        opts.width ? parseInt(opts.width) : undefined,
        opts.height ? parseInt(opts.height) : undefined
      );

      info(`Filename: ${item.filename}`);
      info(`URL: ${url}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Upload Commands
// ============================================
const uploadCmd = program
  .command('upload')
  .description('Upload photos and videos');

uploadCmd
  .command('file <path>')
  .description('Upload a single file')
  .option('-a, --album <albumId>', 'Add to album')
  .option('-d, --description <text>', 'Description for the media item')
  .action(async (filePath: string, opts) => {
    try {
      const photos = requireAuth();

      if (!existsSync(filePath)) {
        error(`File not found: ${filePath}`);
        process.exit(1);
      }

      if (!photos.upload.isSupported(filePath)) {
        error(`Unsupported file type. Supported: ${photos.upload.getSupportedExtensions().join(', ')}`);
        process.exit(1);
      }

      info(`Uploading: ${basename(filePath)}`);

      const item = await photos.upload.uploadAndCreate(filePath, {
        description: opts.description,
        albumId: opts.album,
      });

      if (item) {
        success('Upload complete!');
        info(`Media ID: ${item.id}`);
        info(`URL: ${item.productUrl}`);
      } else {
        warn('Upload succeeded but no media item returned');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

uploadCmd
  .command('dir <path>')
  .description('Upload all photos/videos from a directory')
  .option('-a, --album <albumId>', 'Add to album')
  .option('-r, --recursive', 'Include subdirectories')
  .action(async (dirPath: string, opts) => {
    try {
      const photos = requireAuth();

      if (!existsSync(dirPath)) {
        error(`Directory not found: ${dirPath}`);
        process.exit(1);
      }

      info(`Scanning directory: ${dirPath}`);

      const result = await photos.upload.uploadDirectory(dirPath, {
        albumId: opts.album,
        recursive: opts.recursive,
        onProgress: (completed, total, filename) => {
          if (completed < total) {
            info(`[${completed + 1}/${total}] Uploading: ${filename}`);
          }
        },
      });

      const succeeded = result.newMediaItemResults.filter(r => r.mediaItem).length;
      const failed = result.newMediaItemResults.filter(r => !r.mediaItem).length;

      success(`Upload complete!`);
      info(`Succeeded: ${succeeded}`);
      if (failed > 0) {
        warn(`Failed: ${failed}`);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

uploadCmd
  .command('supported')
  .description('List supported file types')
  .action(() => {
    const photos = GooglePhotos.create();
    const extensions = photos.upload.getSupportedExtensions();
    info('Supported file types:');
    info(extensions.join(', '));
  });

// ============================================
// Bulk Commands
// ============================================
const bulkCmd = program
  .command('bulk')
  .description('Bulk operations on media items and albums');

function makeProgress(total: number) {
  let last = 0;
  return (current: number) => {
    if (current !== last) {
      process.stdout.write(`\r  Progress: ${current}/${total}`);
      last = current;
    }
  };
}

bulkCmd
  .command('preview')
  .description('Preview media items matching filters')
  .option('--album-id <albumId>', 'Filter by album')
  .option('--type <type>', 'Filter by media type (PHOTO, VIDEO)')
  .option('--favorites', 'Only show favorites')
  .option('-n, --max <number>', 'Maximum results', '50')
  .action(async (opts) => {
    try {
      const photos = requireAuth();
      const bulk = new BulkApi(photos.getClient());
      const result = await bulk.preview({
        albumId: opts.albumId,
        mediaType: opts.type,
        favoritesOnly: opts.favorites,
        maxResults: parseInt(opts.max),
      });
      success(`Found ${result.total} item(s):`);
      print(result.items, getFormat(bulkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('add-to-album <albumId>')
  .description('Bulk add media items to an album')
  .option('--query-album-id <albumId>', 'Filter by album to discover items')
  .option('--type <type>', 'Filter by media type')
  .option('--favorites', 'Only favorites')
  .option('-n, --max <number>', 'Maximum results', '100')
  .option('--concurrency <number>', 'Max concurrent operations', '10')
  .option('--dry-run', 'Preview without adding')
  .action(async (albumId: string, opts) => {
    try {
      const photos = requireAuth();
      const bulk = new BulkApi(photos.getClient());
      const result = await bulk.addToAlbum({
        targetAlbumId: albumId,
        albumId: opts.queryAlbumId,
        mediaType: opts.type,
        favoritesOnly: opts.favorites,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun || false,
        onProgress: (cur, total) => { process.stdout.write(`\r  Progress: ${cur}/${total}`); },
        onError: (err, item) => { warn(`Failed: ${item.filename} - ${err.message}`); },
      });
      process.stdout.write('\n');
      if (opts.dryRun) {
        info(`Dry run: would add ${result.success} item(s) to album`);
      } else {
        success(`Added ${result.success} item(s) to album, ${result.failed} failed`);
      }
      if (result.errors.length > 0) {
        print(result.errors, 'pretty');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('remove-from-album <albumId>')
  .description('Bulk remove media items from an album')
  .option('--media-ids <ids>', 'Comma-separated media item IDs')
  .option('-n, --max <number>', 'Maximum results', '100')
  .option('--concurrency <number>', 'Max concurrent operations', '10')
  .option('--dry-run', 'Preview without removing')
  .action(async (albumId: string, opts) => {
    try {
      const photos = requireAuth();
      const bulk = new BulkApi(photos.getClient());
      const mediaItemIds = opts.mediaIds ? opts.mediaIds.split(',') : undefined;
      const result = await bulk.removeFromAlbum({
        albumId,
        mediaItemIds,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun || false,
        onProgress: (cur, total) => { process.stdout.write(`\r  Progress: ${cur}/${total}`); },
        onError: (err, item) => { warn(`Failed: ${item.filename} - ${err.message}`); },
      });
      process.stdout.write('\n');
      if (opts.dryRun) {
        info(`Dry run: would remove ${result.success} item(s) from album`);
      } else {
        success(`Removed ${result.success} item(s) from album, ${result.failed} failed`);
      }
      if (result.errors.length > 0) {
        print(result.errors, 'pretty');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('create-albums')
  .description('Bulk create albums from titles')
  .option('--titles <titles>', 'Comma-separated album titles')
  .option('--titles-file <path>', 'File with one title per line')
  .option('--concurrency <number>', 'Max concurrent operations', '10')
  .option('--dry-run', 'Preview without creating')
  .action(async (opts) => {
    let titles: string[] = [];
    if (opts.titles) {
      titles = opts.titles.split(',').map((t: string) => t.trim()).filter(Boolean);
    } else if (opts.titlesFile) {
      if (!existsSync(opts.titlesFile)) {
        error(`File not found: ${opts.titlesFile}`);
        process.exit(1);
      }
      titles = require('fs').readFileSync(opts.titlesFile, 'utf-8')
        .split('\n')
        .map((t: string) => t.trim())
        .filter(Boolean);
    }
    if (titles.length === 0) {
      error('Provide --titles or --titles-file');
      process.exit(1);
    }
    try {
      const photos = requireAuth();
      const bulk = new BulkApi(photos.getClient());
      const result = await bulk.createAlbums({
        titles,
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun || false,
        onProgress: (cur, total) => { process.stdout.write(`\r  Progress: ${cur}/${total}`); },
        onError: (err, title) => { warn(`Failed: ${title} - ${err.message}`); },
      });
      process.stdout.write('\n');
      if (opts.dryRun) {
        info(`Dry run: would create ${result.success} album(s)`);
      } else {
        success(`Created ${result.success} album(s), ${result.failed} failed`);
      }
      if (result.errors.length > 0) {
        print(result.errors, 'pretty');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('favorites')
  .description('List favorite media items')
  .option('-n, --max <number>', 'Maximum results', '100')
  .action(async (opts) => {
    try {
      const photos = requireAuth();
      const bulk = new BulkApi(photos.getClient());
      const result = await bulk.listFavorites({ maxResults: parseInt(opts.max) });
      success(`Found ${result.total} favorite(s):`);
      print(result.items, getFormat(bulkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and run
program.parse();
