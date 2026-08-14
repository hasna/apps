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
import { MIME_TYPES } from '../types/index.ts';
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
  // isAuthenticated() checks for both accessToken and refreshToken.
  // If accessToken is missing/expired but refreshToken exists, the client's
  // getValidAccessToken() will handle the refresh automatically.
  const tokens = loadTokens();
  if (!tokens || (!tokens.accessToken && !tokens.refreshToken)) {
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
  .command('rename <fileId> <newName>')
  .description('Rename a file')
  .action(async (fileId: string, newName: string) => {
    try {
      const drive = requireAuth();
      const file = await drive.files.update(fileId, { name: newName });
      success('Renamed to: ' + file.name);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('share <fileId>')
  .description('Share a file with a user, group, domain, or make it public')
  .option('--email <email>', 'Email address to share with (required for user/group types)')
  .option('--type <type>', 'Permission type (user, group, domain, anyone)', 'user')
  .option('--domain <domain>', 'Domain to share with (required for domain type)')
  .option('--role <role>', 'Permission role (reader, writer, commenter, owner)', 'reader')
  .option('--no-notify', 'Do not send notification email')
  .option('--allow-discovery', 'Allow file discovery (for anyone/domain types)')
  .action(async (fileId: string, opts) => {
    try {
      const drive = requireAuth();
      const type = opts.type as 'user' | 'group' | 'domain' | 'anyone';

      const validTypes = ['user', 'group', 'domain', 'anyone'];
      if (!validTypes.includes(type)) {
        error('Invalid type "' + type + '". Must be one of: user, group, domain, anyone');
        process.exit(1);
      }

      if ((type === 'user' || type === 'group') && !opts.email) {
        error('--email is required for type "' + type + '"');
        process.exit(1);
      }

      if (type === 'domain' && !opts.domain) {
        error('--domain is required for type "domain"');
        process.exit(1);
      }

      if (type === 'anyone') {
        // Create a public link permission directly
        const permission: Record<string, unknown> = {
          type: 'anyone',
          role: opts.role,
        };
        if (opts.allowDiscovery) {
          permission.allowFileDiscovery = true;
        }
        const params: Record<string, string | number | boolean | undefined> = {
          supportsAllDrives: true,
          sendNotificationEmail: false,
        };
        await drive.getClient().post(
          '/files/' + fileId + '/permissions',
          permission,
          params
        );
        success('File is now publicly accessible');
        info('Role: ' + opts.role);
        info('Type: anyone');
        if (opts.allowDiscovery) {
          info('Allow discovery: yes');
        }
      } else if (type === 'domain') {
        const permission: Record<string, unknown> = {
          type: 'domain',
          role: opts.role,
          domain: opts.domain,
        };
        if (opts.allowDiscovery) {
          permission.allowFileDiscovery = true;
        }
        const params: Record<string, string | number | boolean | undefined> = {
          supportsAllDrives: true,
          sendNotificationEmail: false,
        };
        await drive.getClient().post('/files/' + fileId + '/permissions', permission, params);
        success('Shared with domain: ' + opts.domain);
        info('Role: ' + opts.role);
      } else {
        await drive.files.share(fileId, opts.email, opts.role as 'reader' | 'writer' | 'commenter' | 'owner', {
          sendNotificationEmail: opts.notify !== false,
        });
        success('Shared with: ' + opts.email);
        info('Role: ' + opts.role);
        info('Type: ' + type);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

filesCmd
  .command('bulk-upload <directory>')
  .description('Bulk-upload all files from a local directory to Google Drive')
  .option('--folder <folderId>', 'Target Drive folder ID (uploads to root if omitted)')
  .option('--recursive', 'Preserve subfolder structure (creates Drive folders for each subdir)')
  .action(async (directory: string, opts) => {
    try {
      const drive = requireAuth();
      const { readdirSync, statSync } = await import('fs');
      const { resolve: resolvePath, relative, join: joinPath } = await import('path');

      const rootDir = resolvePath(directory);

      // Verify directory exists
      try {
        const stat = statSync(rootDir);
        if (!stat.isDirectory()) {
          error('"' + rootDir + '" is not a directory');
          process.exit(1);
        }
      } catch {
        error('Directory not found: ' + rootDir);
        process.exit(1);
      }

      const rootFolderId: string | undefined = opts.folder;
      const recursive = !!opts.recursive;

      info('Uploading from: ' + rootDir);
      if (rootFolderId) info('Target folder ID: ' + rootFolderId);
      if (recursive) info('Recursive: enabled (preserving subfolder structure)');

      // Track Drive folder IDs for local subdirectories
      const folderIdMap = new Map<string, string>();
      if (rootFolderId) {
        folderIdMap.set('', rootFolderId);
      }

      let totalUploaded = 0;
      let totalErrors = 0;

      /**
       * Get or create a Drive folder for a given local relative path.
       * e.g. 'images/2024' -> creates 'images' under root, then '2024' under that.
       */
      async function getDriveFolderId(relPath: string): Promise<string | undefined> {
        if (!relPath) return rootFolderId;

        if (folderIdMap.has(relPath)) return folderIdMap.get(relPath);

        // Ensure parent exists first
        const parts = relPath.split('/');
        const parentRelPath = parts.slice(0, -1).join('/');
        const folderName = parts[parts.length - 1];
        const parentId = await getDriveFolderId(parentRelPath);

        const folder = await drive.folders.create(folderName, parentId);
        info('  Created folder: ' + relPath + ' (ID: ' + folder.id + ')');
        const folderId = folder.id as string;
        folderIdMap.set(relPath, folderId);
        return folderId;
      }

      /**
       * Upload all files in a directory, optionally recursing into subdirs.
       */
      async function uploadDir(localDir: string, relDir: string): Promise<void> {
        let entries: string[];
        try {
          entries = readdirSync(localDir);
        } catch (readErr) {
          warn('Cannot read directory ' + localDir + ': ' + String(readErr));
          return;
        }

        for (const entry of entries) {
          const localPath = joinPath(localDir, entry);
          const relPath = relDir ? relDir + '/' + entry : entry;

          let stat;
          try {
            stat = statSync(localPath);
          } catch {
            warn('Cannot stat: ' + localPath);
            continue;
          }

          if (stat.isDirectory()) {
            if (recursive) {
              await uploadDir(localPath, relPath);
            }
            // skip directories when not recursive
          } else if (stat.isFile()) {
            try {
              const parentFolderId = await getDriveFolderId(relDir);
              info('  Uploading: ' + relPath + ' (' + (stat.size / 1024).toFixed(1) + ' KB)...');

              const file = await drive.files.upload(localPath, {
                folderId: parentFolderId,
              });

              success('  ✓ ' + relPath + ' -> ' + file.name + ' (ID: ' + file.id + ')');
              totalUploaded++;
            } catch (uploadErr) {
              warn('  ✗ ' + relPath + ': ' + String(uploadErr));
              totalErrors++;
            }
          }
        }
      }

      await uploadDir(rootDir, '');

      info('');
      success('Bulk upload complete:');
      info('  Uploaded: ' + totalUploaded + ' file(s)');
      if (totalErrors > 0) info('  Failed: ' + totalErrors + ' file(s)');
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
  .command('rename <folderId> <newName>')
  .description('Rename a folder')
  .action(async (folderId: string, newName: string) => {
    try {
      const drive = requireAuth();
      const folder = await drive.files.update(folderId, { name: newName });
      success('Renamed to: ' + folder.name);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

foldersCmd
  .command('contents <folderId>')
  .description('List contents of a folder')
  .option('-r, --recursive', 'List contents recursively (alias for "folders tree")')
  .option('--depth <n>', 'Limit recursion depth when used with --recursive (default: unlimited)', '')
  .action(async (folderId: string, opts) => {
    try {
      const drive = requireAuth();

      if (opts.recursive) {
        // Delegate to the tree rendering logic
        const maxDepth = opts.depth ? parseInt(opts.depth) : Infinity;

        interface TreeNode {
          id: string;
          name: string;
          type: 'folder' | 'file';
          size?: string;
          children?: TreeNode[];
        }

        async function buildTree(id: string, depth: number): Promise<TreeNode[]> {
          if (depth > maxDepth) return [];
          const result = await drive.folders.listContents(id);
          if (!result.files || result.files.length === 0) return [];

          const nodes: TreeNode[] = [];
          for (const f of result.files) {
            const isFolder = f.mimeType === MIME_TYPES.FOLDER;
            const node: TreeNode = {
              id: f.id,
              name: f.name,
              type: isFolder ? 'folder' : 'file',
              size: f.size ? formatBytes(f.size) : undefined,
            };
            if (isFolder) {
              node.children = await buildTree(f.id, depth + 1);
            }
            nodes.push(node);
          }
          return nodes;
        }

        function renderTree(nodes: TreeNode[], indent: string): void {
          for (const node of nodes) {
            if (node.type === 'folder') {
              console.log(indent + node.name + '/');
              if (node.children && node.children.length > 0) {
                renderTree(node.children, indent + '  ');
              }
            } else {
              const sizeStr = node.size ? ' (' + node.size + ')' : '';
              console.log(indent + node.name + sizeStr);
            }
          }
        }

        const tree = await buildTree(folderId, 1);
        if (tree.length === 0) {
          info('Folder is empty');
          return;
        }
        renderTree(tree, '  ');
        return;
      }

      const result = await drive.folders.listContents(folderId);

      if (!result.files || result.files.length === 0) {
        info('Folder is empty');
        return;
      }

      success('Found ' + result.files.length + ' items:');

      const items = result.files.map(f => ({
        id: f.id,
        name: f.name,
        type: f.mimeType === MIME_TYPES.FOLDER ? 'folder' : 'file',
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
// Folder Tree Command
// ============================================

interface FolderTreeNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  size?: string;
  children?: FolderTreeNode[];
}

foldersCmd
  .command('tree <folderId>')
  .description('Show recursive folder tree with indentation')
  .option('--depth <n>', 'Limit recursion depth (default: unlimited)')
  .option('--json', 'Output structured JSON tree')
  .action(async (folderId: string, opts) => {
    try {
      const drive = requireAuth();
      const maxDepth = opts.depth ? parseInt(opts.depth) : Infinity;

      async function buildTree(id: string, depth: number): Promise<FolderTreeNode[]> {
        if (depth > maxDepth) return [];
        const result = await drive.folders.listContents(id);
        if (!result.files || result.files.length === 0) return [];

        const nodes: FolderTreeNode[] = [];
        for (const f of result.files) {
          const isFolder = f.mimeType === MIME_TYPES.FOLDER;
          const node: FolderTreeNode = {
            id: f.id,
            name: f.name,
            type: isFolder ? 'folder' : 'file',
            size: f.size ? formatBytes(f.size) : undefined,
          };
          if (isFolder) {
            node.children = await buildTree(f.id, depth + 1);
          }
          nodes.push(node);
        }
        return nodes;
      }

      function renderTree(nodes: FolderTreeNode[], indent: string): void {
        for (const node of nodes) {
          if (node.type === 'folder') {
            console.log(indent + node.name + '/');
            if (node.children && node.children.length > 0) {
              renderTree(node.children, indent + '  ');
            }
          } else {
            const sizeStr = node.size ? ' (' + node.size + ')' : '';
            console.log(indent + node.name + sizeStr);
          }
        }
      }

      // Fetch the root folder name for display
      let rootName = folderId;
      try {
        const rootFolder = await drive.folders.get(folderId);
        rootName = rootFolder.name || folderId;
      } catch {
        // Fall back to using the ID if we can't fetch metadata
      }

      const tree = await buildTree(folderId, 1);

      if (opts.json) {
        const jsonTree: FolderTreeNode = {
          id: folderId,
          name: rootName,
          type: 'folder',
          children: tree,
        };
        console.log(JSON.stringify(jsonTree, null, 2));
        return;
      }

      // Pretty tree output
      console.log(rootName + '/');
      if (tree.length === 0) {
        console.log('  (empty)');
      } else {
        renderTree(tree, '  ');
      }
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

// ============================================
// Bulk Commands
// ============================================
const bulkCmd = program
  .command('bulk')
  .description('Bulk operations on files (using Drive search queries)');

bulkCmd
  .command('preview <query>')
  .description('Preview files matching a Drive search query')
  .option('-n, --max <number>', 'Maximum files to preview', '20')
  .action(async (query: string, opts) => {
    try {
      const drive = requireAuth();
      info(`Searching for files matching: ${query}`);

      const result = await drive.bulk.preview(query, parseInt(opts.max));

      if (result.files.length === 0) {
        info('No files found matching the query');
        return;
      }

      success(`Found ${result.total} file(s):`);
      const output = result.files.map(f => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size ? formatBytes(parseInt(f.size)) : '-',
      }));
      print(output, getFormat(bulkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('trash <query>')
  .description('Move files matching a query to trash')
  .option('-n, --max <number>', 'Maximum files to process', '100')
  .option('-c, --concurrency <number>', 'Maximum concurrent API calls', '10')
  .option('--dry-run', 'Preview changes without applying them')
  .action(async (query: string, opts) => {
    try {
      const drive = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Moving to trash files matching: ${query}`);

      const result = await drive.bulk.trash({
        query,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk trash complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('delete <query>')
  .description('Permanently delete files matching a query (DANGER!)')
  .option('-n, --max <number>', 'Maximum files to process', '100')
  .option('-c, --concurrency <number>', 'Maximum concurrent API calls', '10')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--trash', 'Move to trash instead of permanent delete')
  .option('--confirm', 'Confirm permanent deletion')
  .action(async (query: string, opts) => {
    try {
      if (!opts.dryRun && !opts.confirm && !opts.trash) {
        error('Permanent deletion requires --confirm flag');
        info('Use --dry-run to preview or --trash to move to trash instead');
        process.exit(1);
      }

      const drive = requireAuth();
      if (!opts.trash) {
        warn(`${opts.dryRun ? '[DRY RUN] ' : ''}PERMANENTLY DELETING files matching: ${query}`);
      } else {
        info(`${opts.dryRun ? '[DRY RUN] ' : ''}Moving to trash files matching: ${query}`);
      }

      const result = await drive.bulk.delete({
        query,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        trash: opts.trash,
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk delete complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('untrash <query>')
  .description('Restore files matching a query from trash')
  .option('-n, --max <number>', 'Maximum files to process', '100')
  .option('-c, --concurrency <number>', 'Maximum concurrent API calls', '10')
  .option('--dry-run', 'Preview changes without applying them')
  .action(async (query: string, opts) => {
    try {
      const drive = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Restoring from trash files matching: ${query}`);

      const result = await drive.bulk.untrash({
        query,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk untrash complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('move <query> <destinationFolderId>')
  .description('Move files matching a query to a different folder')
  .option('-n, --max <number>', 'Maximum files to process', '100')
  .option('-c, --concurrency <number>', 'Maximum concurrent API calls', '10')
  .option('--dry-run', 'Preview changes without applying them')
  .action(async (query: string, destinationFolderId: string, opts) => {
    try {
      const drive = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Moving files matching: ${query}`);
      info(`  Destination folder: ${destinationFolderId}`);

      const result = await drive.bulk.move({
        query,
        destinationFolderId,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk move complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('rename <query>')
  .description('Rename files matching a query')
  .option('-n, --max <number>', 'Maximum files to process', '100')
  .option('-c, --concurrency <number>', 'Maximum concurrent API calls', '10')
  .option('--dry-run', 'Preview changes without applying them')
  .option('-m, --mode <mode>', 'Rename mode: prefix, suffix, replace, lowercase, uppercase', 'prefix')
  .option('--prefix <text>', 'Prefix to add (for mode=prefix)')
  .option('--suffix <text>', 'Suffix to add before extension (for mode=suffix)')
  .option('--find <text>', 'Text to find (for mode=replace)')
  .option('--replace <text>', 'Replacement text (for mode=replace)')
  .action(async (query: string, opts) => {
    try {
      const drive = requireAuth();
      const mode = opts.mode as 'prefix' | 'suffix' | 'replace' | 'lowercase' | 'uppercase';

      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Renaming files matching: ${query}`);
      info(`  Mode: ${mode}`);
      if (opts.prefix) info(`  Prefix: ${opts.prefix}`);
      if (opts.suffix) info(`  Suffix: ${opts.suffix}`);
      if (opts.find) info(`  Find: ${opts.find}`);
      if (opts.replace) info(`  Replace: ${opts.replace}`);

      const result = await drive.bulk.rename({
        query,
        mode,
        prefix: opts.prefix,
        suffix: opts.suffix,
        find: opts.find,
        replace: opts.replace,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk rename complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('share <query>')
  .description('Share files matching a query with a user')
  .option('-n, --max <number>', 'Maximum files to process', '100')
  .option('-c, --concurrency <number>', 'Maximum concurrent API calls', '10')
  .option('--dry-run', 'Preview changes without applying them')
  .option('-e, --email <email>', 'Email address to share with (required)', '')
  .option('-r, --role <role>', 'Permission role: reader, writer, commenter', 'reader')
  .option('--no-notification', 'Do not send notification email')
  .action(async (query: string, opts) => {
    try {
      if (!opts.email) {
        error('--email is required');
        process.exit(1);
      }

      const drive = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Sharing files matching: ${query}`);
      info(`  With: ${opts.email} (${opts.role})`);

      const result = await drive.bulk.share({
        query,
        email: opts.email,
        role: opts.role as 'reader' | 'writer' | 'commenter',
        sendNotification: opts.notification !== false,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk share complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('make-public <query>')
  .description('Make files matching a query publicly accessible')
  .option('-n, --max <number>', 'Maximum files to process', '100')
  .option('-c, --concurrency <number>', 'Maximum concurrent API calls', '10')
  .option('--dry-run', 'Preview changes without applying them')
  .action(async (query: string, opts) => {
    try {
      const drive = requireAuth();
      warn(`${opts.dryRun ? '[DRY RUN] ' : ''}MAKING PUBLICLY ACCESSIBLE files matching: ${query}`);

      const result = await drive.bulk.makePublic({
        query,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk make-public complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('remove-public <query>')
  .description('Remove public access from files matching a query')
  .option('-n, --max <number>', 'Maximum files to process', '100')
  .option('-c, --concurrency <number>', 'Maximum concurrent API calls', '10')
  .option('--dry-run', 'Preview changes without applying them')
  .action(async (query: string, opts) => {
    try {
      const drive = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Removing public access from files matching: ${query}`);

      const result = await drive.bulk.removePublicAccess({
        query,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk remove-public complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('star <query>')
  .description('Star files matching a query')
  .option('-n, --max <number>', 'Maximum files to process', '100')
  .option('-c, --concurrency <number>', 'Maximum concurrent API calls', '10')
  .option('--dry-run', 'Preview changes without applying them')
  .action(async (query: string, opts) => {
    try {
      const drive = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Starring files matching: ${query}`);

      const result = await drive.bulk.star({
        query,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk star complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('unstar <query>')
  .description('Remove stars from files matching a query')
  .option('-n, --max <number>', 'Maximum files to process', '100')
  .option('-c, --concurrency <number>', 'Maximum concurrent API calls', '10')
  .option('--dry-run', 'Preview changes without applying them')
  .action(async (query: string, opts) => {
    try {
      const drive = requireAuth();
      info(`${opts.dryRun ? '[DRY RUN] ' : ''}Removing stars from files matching: ${query}`);

      const result = await drive.bulk.unstar({
        query,
        maxResults: parseInt(opts.max),
        concurrency: parseInt(opts.concurrency),
        dryRun: opts.dryRun,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total}`);
        },
      });
      console.log();

      success(`${opts.dryRun ? '[DRY RUN] ' : ''}Bulk unstar complete:`);
      info(`  Total: ${result.total}`);
      info(`  Success: ${result.success}`);
      if (result.failed > 0) warn(`  Failed: ${result.failed}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

bulkCmd
  .command('help-query')
  .description('Show Drive search query syntax examples')
  .action(() => {
    info(chalk.bold('\nDrive Search Query Syntax:\n'));

    info(chalk.cyan('Basic filters:'));
    info('  name = "report"              - Files named "report"');
    info('  name contains "report"       - Files with "report" in the name');
    info('  fullName contains "/Docs/"   - Files in a path containing "Docs"\n');

    info(chalk.cyan('Type filters:'));
    info('  mimeType = "application/pdf" - PDF files only');
    info('  mimeType = "application/vnd.google-apps.document" - Google Docs');
    info('  mimeType = "application/vnd.google-apps.folder"   - Folders');
    info('  mimeType contains "image/"    - Any image file\n');

    info(chalk.cyan('Status filters:'));
    info('  trashed = false              - Not in trash');
    info('  trashed = true               - In trash');
    info('  starred = true               - Starred files');
    info('  viewedByMe = true            - Files you have viewed\n');

    info(chalk.cyan('Ownership filters:'));
    info('  "me" in owners               - Files you own');
    info('  sharedWithMe                 - Files shared with you');
    info('  "user@example.com" in owners - Files owned by specific user\n');

    info(chalk.cyan('Folder filters:'));
    info('  "<folderId>" in parents      - Direct children of a folder\n');

    info(chalk.cyan('Date filters:'));
    info('  modifiedTime > "2024-01-01T00:00:00"  - Modified after date');
    info('  modifiedTime < "2024-12-31T23:59:59"  - Modified before date');
    info('  createdTime > "2024-06-01T00:00:00"   - Created after date\n');

    info(chalk.cyan('Combining filters:'));
    info('  mimeType = "application/pdf" and trashed = false');
    info('  name contains "report" and "me" in owners');
    info('  mimeType contains "image/" and modifiedTime > "2024-01-01T00:00:00"\n');

    info(chalk.cyan('Examples:'));
    info('  bulk preview "mimeType=\'application/pdf\'"');
    info('  bulk trash "name contains \'temp\' and trashed = false" --dry-run');
    info('  bulk rename "mimeType contains \'image\'" --mode suffix --suffix _v2');
    info('  bulk star "sharedWithMe" -n 50');
  });

// ============================================
// Changes Commands
// ============================================
const changesCmd = program
  .command('changes')
  .description('Track changes to Drive files');

changesCmd
  .command('start-page-token')
  .description('Get the current starting page token for change tracking')
  .option('--drive <driveId>', 'Get token for a specific shared drive')
  .action(async (opts) => {
    try {
      const drive = requireAuth();
      const result = await drive.changes.getStartPageToken({
        driveId: opts.drive,
        supportsAllDrives: !!opts.drive,
      });
      success('Current page token: ' + result.nextPageToken);
      info('Use this token with "changes list" to begin tracking');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

changesCmd
  .command('list <pageToken>')
  .description('List changes since the given page token')
  .option('-n, --max <number>', 'Maximum changes to return', '50')
  .option('--include-removed', 'Include removed items')
  .option('--my-drive-only', 'Only track My Drive changes (exclude shared drives)')
  .action(async (pageToken: string, opts) => {
    try {
      const drive = requireAuth();
      const result = await drive.changes.list({
        pageToken,
        pageSize: parseInt(opts.max),
        includeRemoved: opts.includeRemoved,
        restrictToMyDrive: opts.myDriveOnly,
        includeItemsFromAllDrives: !opts.myDriveOnly,
        supportsAllDrives: true,
      });

      if (!result.changes || result.changes.length === 0) {
        info('No changes found');
        return;
      }

      success('Found ' + result.changes.length + ' change(s):');
      info('New start page token: ' + result.newStartPageToken);

      const changes = result.changes.map((c: any) => ({
        fileId: c.fileId,
        type: c.type,
        removed: c.removed || false,
        fileName: c.file?.name || '-',
        mimeType: c.file?.mimeType || '-',
      }));

      print(changes, getFormat(changesCmd));

      if (result.nextPageToken) {
        info('Next page token: ' + result.nextPageToken);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Revisions Commands
// ============================================
const revisionsCmd = program
  .command('revisions')
  .description('File revision history commands');

revisionsCmd
  .command('list <fileId>')
  .description('List revisions of a file')
  .action(async (fileId: string) => {
    try {
      const drive = requireAuth();
      const result = await drive.revisions.list(fileId);

      if (!result.revisions || result.revisions.length === 0) {
        info('No revisions found');
        return;
      }

      success('Found ' + result.revisions.length + ' revision(s):');

      const revisions = result.revisions.map((r: any) => ({
        id: r.id,
        mimeType: r.mimeType,
        size: r.size ? formatBytes(r.size) : '-',
        modified: r.modifiedTime ? new Date(r.modifiedTime).toLocaleString() : '-',
        keepForever: r.keepForever || false,
      }));

      print(revisions, getFormat(revisionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

revisionsCmd
  .command('get <fileId> <revisionId>')
  .description('Get details of a specific revision')
  .action(async (fileId: string, revisionId: string) => {
    try {
      const drive = requireAuth();
      const revision = await drive.revisions.get(fileId, revisionId);
      print(revision, getFormat(revisionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

revisionsCmd
  .command('download <fileId> <revisionId> [destination]')
  .description('Download a specific revision')
  .action(async (fileId: string, revisionId: string, destination?: string) => {
    try {
      const drive = requireAuth();
      info('Downloading revision...');

      const data = await drive.revisions.download(fileId, revisionId);

      if (destination) {
        writeFileSync(destination, Buffer.from(data));
        success('Downloaded revision to: ' + destination);
      } else {
        const destPath = join(process.cwd(), 'revision-' + revisionId);
        writeFileSync(destPath, Buffer.from(data));
        success('Downloaded revision');
        info('Saved to: ' + destPath);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

revisionsCmd
  .command('keep-forever <fileId> <revisionId>')
  .description('Mark a revision to be kept forever (not auto-deleted)')
  .action(async (fileId: string, revisionId: string) => {
    try {
      const drive = requireAuth();
      await drive.revisions.update(fileId, revisionId, { keepForever: true });
      success('Revision marked to keep forever');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

revisionsCmd
  .command('delete <fileId> <revisionId>')
  .description('Delete a specific revision')
  .action(async (fileId: string, revisionId: string) => {
    try {
      const drive = requireAuth();
      await drive.revisions.delete(fileId, revisionId);
      success('Revision deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
