#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { Drive } from '../api/index.ts';
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
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
} from '../utils/config.ts';
import {
  getAuthUrl,
  startCallbackServer,
} from '../utils/auth.ts';
import type { OutputFormat } from '../utils/output.ts';
import { success, error, info, print, warn, formatBytes } from '../utils/output.ts';
import { writeFileSync } from 'fs';
import { join, basename } from 'path';

const program = new Command();

program
  .name('connect-googledrive')
  .description('Google Drive API connector CLI - Manage files, folders, and storage')
  .version('0.1.0')
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error('Profile "' + opts.profile + '" does not exist. Create it with "connect-googledrive profiles create ' + opts.profile + '"');
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function requireAuth(): Drive {
  if (!isAuthenticated()) {
    error('Not authenticated. Run "connect-googledrive auth login" first.');
    process.exit(1);
  }
  return Drive.create();
}

// ============================================
// Auth Commands
// ============================================
const authCmd = program
  .command('auth')
  .description('Authentication commands');

authCmd
  .command('login')
  .description('Login to Google Drive via OAuth2 (opens browser)')
  .action(async () => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    if (!clientId || !clientSecret) {
      error('OAuth credentials not configured.');
      info('Run "connect-googledrive config set-credentials <client-id> <client-secret>" first.');
      info('Or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
      process.exit(1);
    }

    info('Starting OAuth2 authentication flow...');
    info('A browser window will open for you to authorize the application.');

    const serverPromise = startCallbackServer();
    const authUrl = getAuthUrl();
    await open(authUrl);

    info('Waiting for authentication...');

    const result = await serverPromise;

    if (result.success) {
      success('Successfully authenticated!');

      try {
        const drive = Drive.create();
        const user = await drive.storage.getUser();
        const email = user.emailAddress || '';

        if (email) {
          const profileSlug = email.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

          if (!profileExists(profileSlug)) {
            createProfile(profileSlug);
            info('Created profile: ' + profileSlug);
          }

          setCurrentProfile(profileSlug);
          setProfileOverride(profileSlug);
          setUserEmail(email);

          if (result.tokens) {
            saveTokens(result.tokens);
          }

          success('Profile: ' + profileSlug);
          info('Email: ' + email);
        }
      } catch (err) {
        warn('Could not auto-create profile: ' + err);
      }
    } else {
      error('Authentication failed: ' + result.error);
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
        info('Email: ' + email);
      }
      if (tokens) {
        const expiresIn = Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000 / 60));
        info('Access token expires in: ' + expiresIn + ' minutes');
        info('Has refresh token: ' + (tokens.refreshToken ? 'Yes' : 'No'));
      }
    } else {
      warn('Not authenticated');
      info('Run "connect-googledrive auth login" to authenticate.');
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
    info('Config stored in: ' + getConfigDir());
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const email = getUserEmail();
    const tokens = loadTokens();

    info('Config directory: ' + getConfigDir());
    info('Client ID: ' + (clientId ? clientId.substring(0, 20) + '...' : chalk.gray('not set')));
    info('Client Secret: ' + (clientSecret ? '********' : chalk.gray('not set')));
    info('Authenticated: ' + (isAuthenticated() ? chalk.green('Yes') : chalk.red('No')));
    if (email) {
      info('Email: ' + email);
    }
    if (tokens) {
      info('Token expires: ' + new Date(tokens.expiresAt).toLocaleString());
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
// Profiles Commands
// ============================================
const profilesCmd = program
  .command('profiles')
  .description('Manage multiple Google Drive profiles');

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

      success(profiles.length + ' profile(s):');
      for (const p of profiles) {
        if (p === current) {
          info('  ' + chalk.green('>') + ' ' + p + ' ' + chalk.gray('(current)'));
        } else {
          info('    ' + p);
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
    info('Current profile: ' + chalk.green(current));
    info('Config directory: ' + getConfigDir());
  });

profilesCmd
  .command('create <name>')
  .description('Create a new profile')
  .action((name: string) => {
    try {
      createProfile(name);
      success('Profile "' + name + '" created');
      info('Switch to it with: connect-googledrive profiles switch ' + name);
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
      success('Switched to profile "' + name + '"');
      info('Config directory: ' + getConfigDir());

      if (isAuthenticated()) {
        const email = getUserEmail();
        if (email) {
          info('Logged in as: ' + email);
        }
      } else {
        warn('Profile not authenticated. Run "connect-googledrive auth login"');
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
      success('Profile "' + name + '" deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Files Commands
// ============================================
const filesCmd = program
  .command('files')
  .description('File management commands');

filesCmd
  .command('list')
  .description('List files in Drive')
  .option('-n, --max <number>', 'Maximum files to return', '20')
  .option('-q, --query <query>', 'Drive search query')
  .option('--folder <folderId>', 'List files in a specific folder')
  .option('--order <orderBy>', 'Order by (name, modifiedTime, createdTime)', 'modifiedTime desc')
  .action(async (opts) => {
    try {
      const drive = requireAuth();
      
      let q = 'trashed = false';
      if (opts.folder) {
        q += " and '" + opts.folder + "' in parents";
      }
      if (opts.query) {
        q += ' and ' + opts.query;
      }

      const result = await drive.files.list({
        pageSize: parseInt(opts.max),
        q,
        orderBy: opts.order,
      });

      if (!result.files || result.files.length === 0) {
        info('No files found');
        return;
      }

      success('Found ' + result.files.length + ' files:');

      const files = result.files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
        size: f.size ? formatBytes(f.size) : '-',
        modified: f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '-',
      }));

      print(files, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('get <fileId>')
  .description('Get file details')
  .action(async (fileId: string) => {
    try {
      const drive = requireAuth();
      const file = await drive.files.get(fileId);
      print(file, getFormat(filesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('download <fileId> [destination]')
  .description('Download a file')
  .action(async (fileId: string, destination?: string) => {
    try {
      const drive = requireAuth();
      info('Downloading file...');
      
      const result = await drive.files.download(fileId, destination);
      
      if (!destination) {
        const destPath = join(process.cwd(), result.filename);
        writeFileSync(destPath, Buffer.from(result.data));
        success('Downloaded: ' + result.filename);
        info('Saved to: ' + destPath);
      } else {
        success('Downloaded: ' + result.filename);
        info('Saved to: ' + destination);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('upload <path>')
  .description('Upload a file')
  .option('--folder <folderId>', 'Upload to a specific folder')
  .option('--name <name>', 'Custom file name')
  .action(async (path: string, opts) => {
    try {
      const drive = requireAuth();
      info('Uploading file...');

      const file = await drive.files.upload(path, {
        name: opts.name,
        folderId: opts.folder,
      });

      success('Uploaded: ' + file.name);
      info('File ID: ' + file.id);
      if (file.webViewLink) {
        info('View: ' + file.webViewLink);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('delete <fileId>')
  .description('Delete a file (permanently by default, use --trash to move to trash)')
  .option('--trash', 'Move to trash instead of permanent delete')
  .option('--force', 'Continue even if errors occur (for batch operations)')
  .action(async (fileId: string, opts) => {
    try {
      const drive = requireAuth();

      if (opts.trash) {
        const file = await drive.files.trash(fileId);
        success('File moved to trash: ' + file.name);
      } else {
        await drive.files.delete(fileId);
        success('File deleted permanently');
      }
    } catch (err: any) {
      const errorMsg = String(err);

      // Provide helpful error messages
      if (errorMsg.includes('404') || errorMsg.includes('not found')) {
        error('File not found. It may have already been deleted or you may not have access.');
      } else if (errorMsg.includes('403') || errorMsg.includes('forbidden')) {
        error('Permission denied. You may not have permission to delete this file.');
        info('Tip: If this is a shared file, only the owner can delete it permanently.');
        info('Tip: Try using --trash to move to trash instead.');
      } else if (errorMsg.includes('insufficient')) {
        error('Insufficient permissions to delete this file.');
        info('Tip: For shared drive files, you need "organizer" role to delete.');
      } else {
        error('Failed to delete: ' + errorMsg);
      }

      if (!opts.force) {
        process.exit(1);
      }
    }
  });

filesCmd
  .command('move <fileId> <newParentId>')
  .description('Move a file to a different folder')
  .action(async (fileId: string, newParentId: string) => {
    try {
      const drive = requireAuth();
      const file = await drive.files.move(fileId, newParentId);
      success('Moved: ' + file.name);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('copy <fileId>')
  .description('Copy a file')
  .option('--name <name>', 'New file name')
  .option('--folder <folderId>', 'Copy to a specific folder')
  .action(async (fileId: string, opts) => {
    try {
      const drive = requireAuth();
      const file = await drive.files.copy(fileId, {
        name: opts.name,
        folderId: opts.folder,
      });
      success('Copied: ' + file.name);
      info('New file ID: ' + file.id);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('share <fileId>')
  .description('Share a file with a user')
  .requiredOption('--email <email>', 'Email address to share with')
  .option('--role <role>', 'Permission role (reader, writer, commenter, owner)', 'reader')
  .option('--no-notify', 'Do not send notification email')
  .action(async (fileId: string, opts) => {
    try {
      const drive = requireAuth();
      const permission = await drive.files.share(fileId, opts.email, opts.role as 'reader' | 'writer' | 'commenter' | 'owner', {
        sendNotificationEmail: opts.notify !== false,
      });
      success('Shared with: ' + opts.email);
      info('Role: ' + opts.role);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Folders Commands
// ============================================
const foldersCmd = program
  .command('folders')
  .description('Folder management commands');

foldersCmd
  .command('list [parentId]')
  .description('List folders (optionally within a parent)')
  .action(async (parentId?: string) => {
    try {
      const drive = requireAuth();
      const result = await drive.folders.list(parentId);

      if (!result.files || result.files.length === 0) {
        info('No folders found');
        return;
      }

      success('Found ' + result.files.length + ' folders:');

      const folders = result.files.map(f => ({
        id: f.id,
        name: f.name,
        modified: f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '-',
      }));

      print(folders, getFormat(foldersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

foldersCmd
  .command('create <name>')
  .description('Create a new folder')
  .option('--parent <parentId>', 'Parent folder ID')
  .action(async (name: string, opts) => {
    try {
      const drive = requireAuth();
      const folder = await drive.folders.create(name, opts.parent);
      success('Created folder: ' + folder.name);
      info('Folder ID: ' + folder.id);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

foldersCmd
  .command('delete <folderId>')
  .description('Delete a folder')
  .option('--permanent', 'Delete permanently (skip trash)')
  .action(async (folderId: string, opts) => {
    try {
      const drive = requireAuth();
      await drive.folders.delete(folderId, opts.permanent);
      success(opts.permanent ? 'Folder deleted permanently' : 'Folder moved to trash');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

foldersCmd
  .command('contents <folderId>')
  .description('List contents of a folder')
  .action(async (folderId: string) => {
    try {
      const drive = requireAuth();
      const result = await drive.folders.listContents(folderId);

      if (!result.files || result.files.length === 0) {
        info('Folder is empty');
        return;
      }

      success('Found ' + result.files.length + ' items:');

      const items = result.files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
        size: f.size ? formatBytes(f.size) : '-',
        modified: f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '-',
      }));

      print(items, getFormat(foldersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Trash Commands
// ============================================
const trashCmd = program
  .command('trash')
  .description('Trash management commands');

trashCmd
  .command('list')
  .description('List files in trash')
  .option('-n, --max <number>', 'Maximum files to return', '20')
  .action(async (opts) => {
    try {
      const drive = requireAuth();
      const result = await drive.trash.list(parseInt(opts.max));

      if (!result.files || result.files.length === 0) {
        info('Trash is empty');
        return;
      }

      success('Found ' + result.files.length + ' items in trash:');

      const files = result.files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
        size: f.size ? formatBytes(f.size) : '-',
      }));

      print(files, getFormat(trashCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trashCmd
  .command('restore <fileId>')
  .description('Restore a file from trash')
  .action(async (fileId: string) => {
    try {
      const drive = requireAuth();
      const file = await drive.trash.restore(fileId);
      success('Restored: ' + file.name);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

trashCmd
  .command('empty')
  .description('Empty the trash (permanently delete all trashed files)')
  .action(async () => {
    try {
      const drive = requireAuth();
      await drive.trash.empty();
      success('Trash emptied');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Storage Command
// ============================================
program
  .command('storage')
  .description('Show storage quota information')
  .action(async () => {
    try {
      const drive = requireAuth();
      const quota = await drive.storage.getQuota();
      const user = await drive.storage.getUser();

      info('User: ' + (user.emailAddress || 'Unknown'));
      info('');
      info('Storage Quota:');
      info('  Used: ' + formatBytes(quota.usage || '0'));
      info('  Limit: ' + (quota.limit ? formatBytes(quota.limit) : 'Unlimited'));
      info('  In Drive: ' + formatBytes(quota.usageInDrive || '0'));
      info('  In Trash: ' + formatBytes(quota.usageInDriveTrash || '0'));
      
      if (quota.limit && quota.usage) {
        const used = parseInt(quota.usage);
        const limit = parseInt(quota.limit);
        const percent = ((used / limit) * 100).toFixed(1);
        info('  Usage: ' + percent + '%');
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
  .description('Search for files and folders')
  .option('-n, --max <number>', 'Maximum results to return', '20')
  .action(async (query: string, opts) => {
    try {
      const drive = requireAuth();
      const result = await drive.files.search(query, {
        pageSize: parseInt(opts.max),
      });

      if (!result.files || result.files.length === 0) {
        info('No results found for: ' + query);
        return;
      }

      success('Found ' + result.files.length + ' results:');

      const files = result.files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
        size: f.size ? formatBytes(f.size) : '-',
        modified: f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '-',
      }));

      print(files, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Me Command
// ============================================
program
  .command('me')
  .description('Get your Google Drive profile information')
  .action(async () => {
    try {
      const drive = requireAuth();
      const about = await drive.storage.getAbout();

      const profile = {
        email: about.user?.emailAddress,
        name: about.user?.displayName,
        photo: about.user?.photoLink,
        storageUsed: about.storageQuota?.usage ? formatBytes(about.storageQuota.usage) : 'Unknown',
        storageLimit: about.storageQuota?.limit ? formatBytes(about.storageQuota.limit) : 'Unlimited',
        canCreateDrives: about.canCreateDrives,
        maxUploadSize: about.maxUploadSize ? formatBytes(about.maxUploadSize) : 'Unknown',
      };

      print(profile, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Shared Drives Commands
// ============================================
const drivesCmd = program
  .command('drives')
  .description('Shared drives (Team Drives) management commands');

drivesCmd
  .command('list')
  .description('List all shared drives')
  .option('-n, --max <number>', 'Maximum drives to return', '50')
  .option('-q, --query <query>', 'Search query')
  .action(async (opts) => {
    try {
      const drive = requireAuth();
      const result = await drive.drives.list({
        pageSize: parseInt(opts.max),
        q: opts.query,
      });

      if (!result.drives || result.drives.length === 0) {
        info('No shared drives found');
        return;
      }

      success('Found ' + result.drives.length + ' shared drive(s):');

      const drives = result.drives.map(d => ({
        id: d.id,
        name: d.name,
        created: d.createdTime ? new Date(d.createdTime).toLocaleDateString() : '-',
      }));

      print(drives, getFormat(drivesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drivesCmd
  .command('get <driveId>')
  .description('Get shared drive details')
  .action(async (driveId: string) => {
    try {
      const drive = requireAuth();
      const sharedDrive = await drive.drives.get(driveId);
      print(sharedDrive, getFormat(drivesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drivesCmd
  .command('create <name>')
  .description('Create a new shared drive')
  .action(async (name: string) => {
    try {
      const drive = requireAuth();
      const sharedDrive = await drive.drives.create({ name });
      success('Created shared drive: ' + sharedDrive.name);
      info('Drive ID: ' + sharedDrive.id);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drivesCmd
  .command('rename <driveId> <newName>')
  .description('Rename a shared drive')
  .action(async (driveId: string, newName: string) => {
    try {
      const drive = requireAuth();
      const sharedDrive = await drive.drives.update(driveId, { name: newName });
      success('Renamed to: ' + sharedDrive.name);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drivesCmd
  .command('delete <driveId>')
  .description('Delete a shared drive (must be empty)')
  .action(async (driveId: string) => {
    try {
      const drive = requireAuth();
      await drive.drives.delete(driveId);
      success('Shared drive deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drivesCmd
  .command('files <driveId>')
  .description('List files in a shared drive')
  .option('-n, --max <number>', 'Maximum files to return', '50')
  .option('-q, --query <query>', 'Additional search query')
  .action(async (driveId: string, opts) => {
    try {
      const drive = requireAuth();
      const result = await drive.drives.listFiles(driveId, {
        pageSize: parseInt(opts.max),
        q: opts.query,
      });

      if (!result.files || result.files.length === 0) {
        info('No files found in shared drive');
        return;
      }

      success('Found ' + result.files.length + ' files:');

      const files = result.files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
        size: f.size ? formatBytes(f.size) : '-',
        modified: f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '-',
      }));

      print(files, getFormat(drivesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drivesCmd
  .command('hide <driveId>')
  .description('Hide a shared drive from the default view')
  .action(async (driveId: string) => {
    try {
      const drive = requireAuth();
      await drive.drives.hide(driveId);
      success('Shared drive hidden');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

drivesCmd
  .command('unhide <driveId>')
  .description('Unhide a shared drive')
  .action(async (driveId: string) => {
    try {
      const drive = requireAuth();
      await drive.drives.unhide(driveId);
      success('Shared drive unhidden');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
