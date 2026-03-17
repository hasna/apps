#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Dropbox } from '../api';
import {
  getAccessToken,
  setAccessToken,
  clearConfig,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  setProfileOverride,
  getConfigDir,
} from '../utils/config';
import type { Metadata, FileMetadata, FolderMetadata } from '../types';

const program = new Command();

// Helper to get authenticated client
function getClient(): Dropbox {
  const accessToken = getAccessToken();
  if (!accessToken) {
    console.error(chalk.red('Error: Not authenticated. Run "connect-dropbox auth set <token>" first or set DROPBOX_ACCESS_TOKEN.'));
    process.exit(1);
  }
  return new Dropbox({ accessToken });
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Format metadata for display
function formatMetadata(item: Metadata): string {
  if (item['.tag'] === 'file') {
    const file = item as FileMetadata;
    return `${chalk.white(file.name)} ${chalk.gray(`(${formatSize(file.size)})`)}`;
  } else if (item['.tag'] === 'folder') {
    return chalk.blue(item.name + '/');
  } else {
    return chalk.gray(`[deleted] ${item.name}`);
  }
}

program
  .name('connect-dropbox')
  .description('Dropbox connector - Manage files, folders, sharing, and team administration')
  .version('0.0.1')
  .option('--profile <name>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

// ============================================
// Auth Commands
// ============================================

const authCmd = program.command('auth').description('Authentication management');

authCmd
  .command('set')
  .description('Set access token for the current profile')
  .argument('<token>', 'Dropbox access token')
  .action((token: string) => {
    setAccessToken(token);
    console.log(chalk.green(`Access token saved to profile "${getCurrentProfile()}"`));
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(async () => {
    const token = getAccessToken();
    if (!token) {
      console.log(chalk.yellow('Not authenticated'));
      console.log(chalk.gray('Run "connect-dropbox auth set <token>" to authenticate'));
      return;
    }

    try {
      const client = getClient();
      const account = await client.getCurrentAccount();
      console.log(chalk.green('Authenticated'));
      console.log(`  Profile: ${chalk.cyan(getCurrentProfile())}`);
      console.log(`  User: ${chalk.white(account.name.display_name)}`);
      console.log(`  Email: ${chalk.white(account.email)}`);
      console.log(`  Account Type: ${chalk.white(account.account_type['.tag'])}`);
    } catch (error) {
      console.log(chalk.red('Authentication failed'));
      console.error(chalk.gray(error instanceof Error ? error.message : String(error)));
    }
  });

authCmd
  .command('clear')
  .description('Clear stored credentials')
  .action(() => {
    clearConfig();
    console.log(chalk.green('Credentials cleared'));
  });

// ============================================
// Profile Commands
// ============================================

const profileCmd = program.command('profile').description('Profile management');

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();

    if (profiles.length === 0) {
      console.log(chalk.gray('No profiles configured'));
      return;
    }

    console.log(chalk.bold('Profiles:'));
    for (const profile of profiles) {
      const marker = profile === current ? chalk.green(' (active)') : '';
      console.log(`  ${profile}${marker}`);
    }
  });

profileCmd
  .command('use')
  .description('Switch to a profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    try {
      setCurrentProfile(name);
      console.log(chalk.green(`Switched to profile "${name}"`));
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

profileCmd
  .command('create')
  .description('Create a new profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    try {
      if (createProfile(name)) {
        console.log(chalk.green(`Profile "${name}" created`));
      } else {
        console.log(chalk.yellow(`Profile "${name}" already exists`));
      }
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

profileCmd
  .command('delete')
  .description('Delete a profile')
  .argument('<name>', 'Profile name')
  .action((name: string) => {
    if (deleteProfile(name)) {
      console.log(chalk.green(`Profile "${name}" deleted`));
    } else {
      console.log(chalk.yellow(`Cannot delete profile "${name}" (doesn't exist or is default)`));
    }
  });

profileCmd
  .command('show')
  .description('Show current profile')
  .action(() => {
    console.log(`Current profile: ${chalk.cyan(getCurrentProfile())}`);
    console.log(`Config directory: ${chalk.gray(getConfigDir())}`);
  });

// ============================================
// Files Commands
// ============================================

const filesCmd = program.command('files').description('File operations');

filesCmd
  .command('list')
  .description('List folder contents')
  .argument('[path]', 'Folder path', '')
  .option('-r, --recursive', 'List recursively')
  .option('-l, --long', 'Show detailed information')
  .option('--limit <n>', 'Limit number of results', '100')
  .action(async (path: string, options) => {
    try {
      const client = getClient();
      const result = await client.listFolder(path, {
        recursive: options.recursive,
        limit: parseInt(options.limit),
      });

      if (result.entries.length === 0) {
        console.log(chalk.gray('Empty folder'));
        return;
      }

      for (const entry of result.entries) {
        if (options.long) {
          const type = entry['.tag'] === 'folder' ? 'd' : '-';
          const size = entry['.tag'] === 'file' ? formatSize((entry as FileMetadata).size) : '-';
          const modified = entry['.tag'] === 'file' ? (entry as FileMetadata).server_modified : '';
          console.log(`${type}  ${size.padStart(10)}  ${modified.padStart(20)}  ${formatMetadata(entry)}`);
        } else {
          console.log(formatMetadata(entry));
        }
      }

      if (result.has_more) {
        console.log(chalk.gray(`\n... and more (use --limit to see more)`));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

filesCmd
  .command('info')
  .description('Get file or folder metadata')
  .argument('<path>', 'File or folder path')
  .action(async (path: string) => {
    try {
      const client = getClient();
      const metadata = await client.getMetadata(path, {
        include_media_info: true,
        include_has_explicit_shared_members: true,
      });

      console.log(chalk.bold('Metadata:'));
      console.log(`  Type: ${chalk.cyan(metadata['.tag'])}`);
      console.log(`  Name: ${metadata.name}`);
      console.log(`  Path: ${metadata.path_display || metadata.path_lower}`);
      console.log(`  ID: ${chalk.gray(metadata.id)}`);

      if (metadata['.tag'] === 'file') {
        const file = metadata as FileMetadata;
        console.log(`  Size: ${formatSize(file.size)}`);
        console.log(`  Modified: ${file.server_modified}`);
        console.log(`  Rev: ${chalk.gray(file.rev)}`);
        if (file.content_hash) {
          console.log(`  Content Hash: ${chalk.gray(file.content_hash)}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

filesCmd
  .command('search')
  .description('Search for files and folders')
  .argument('<query>', 'Search query')
  .option('-p, --path <path>', 'Search within path')
  .option('--filename-only', 'Search only filenames')
  .option('--limit <n>', 'Maximum results', '20')
  .action(async (query: string, options) => {
    try {
      const client = getClient();
      const result = await client.search(query, {
        path: options.path,
        filename_only: options.filenameOnly,
        max_results: parseInt(options.limit),
      });

      if (result.matches.length === 0) {
        console.log(chalk.gray('No matches found'));
        return;
      }

      console.log(chalk.bold(`Found ${result.matches.length} matches:`));
      for (const match of result.matches) {
        const metadata = match.metadata.metadata;
        console.log(`  ${formatMetadata(metadata)}`);
        console.log(chalk.gray(`    ${metadata.path_display || metadata.path_lower}`));
      }

      if (result.has_more) {
        console.log(chalk.gray(`\n... and more results`));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

filesCmd
  .command('mkdir')
  .description('Create a folder')
  .argument('<path>', 'Folder path')
  .option('--autorename', 'Autorename if exists')
  .action(async (path: string, options) => {
    try {
      const client = getClient();
      const folder = await client.createFolder(path, options.autorename);
      console.log(chalk.green(`Created folder: ${folder.path_display || folder.name}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

filesCmd
  .command('delete')
  .description('Delete a file or folder')
  .argument('<path>', 'File or folder path')
  .option('--permanent', 'Permanently delete (cannot be recovered)')
  .action(async (path: string, options) => {
    try {
      const client = getClient();
      if (options.permanent) {
        await client.permanentlyDelete(path);
        console.log(chalk.green(`Permanently deleted: ${path}`));
      } else {
        const result = await client.delete(path);
        console.log(chalk.green(`Deleted: ${result.metadata.path_display || result.metadata.name}`));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

filesCmd
  .command('copy')
  .description('Copy a file or folder')
  .argument('<from>', 'Source path')
  .argument('<to>', 'Destination path')
  .option('--autorename', 'Autorename if destination exists')
  .action(async (from: string, to: string, options) => {
    try {
      const client = getClient();
      const result = await client.copy(from, to, { autorename: options.autorename });
      console.log(chalk.green(`Copied to: ${result.metadata.path_display || result.metadata.name}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

filesCmd
  .command('move')
  .description('Move a file or folder')
  .argument('<from>', 'Source path')
  .argument('<to>', 'Destination path')
  .option('--autorename', 'Autorename if destination exists')
  .action(async (from: string, to: string, options) => {
    try {
      const client = getClient();
      const result = await client.move(from, to, { autorename: options.autorename });
      console.log(chalk.green(`Moved to: ${result.metadata.path_display || result.metadata.name}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

filesCmd
  .command('upload')
  .description('Upload a file')
  .argument('<local>', 'Local file path')
  .argument('<remote>', 'Remote Dropbox path')
  .option('--overwrite', 'Overwrite if exists')
  .option('--autorename', 'Autorename if exists')
  .action(async (local: string, remote: string, options) => {
    try {
      const content = await Bun.file(local).arrayBuffer();
      const client = getClient();

      let mode: 'add' | 'overwrite' = 'add';
      if (options.overwrite) mode = 'overwrite';

      const result = await client.upload(remote, new Uint8Array(content), {
        mode,
        autorename: options.autorename,
      });
      console.log(chalk.green(`Uploaded: ${result.path_display || result.name}`));
      console.log(`  Size: ${formatSize(result.size)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

filesCmd
  .command('download')
  .description('Download a file')
  .argument('<remote>', 'Remote Dropbox path')
  .argument('[local]', 'Local file path (defaults to filename)')
  .action(async (remote: string, local?: string) => {
    try {
      const client = getClient();
      const result = await client.download(remote);

      const localPath = local || result.metadata.name;
      await Bun.write(localPath, result.content);

      console.log(chalk.green(`Downloaded: ${localPath}`));
      console.log(`  Size: ${formatSize(result.metadata.size)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

filesCmd
  .command('link')
  .description('Get a temporary download link')
  .argument('<path>', 'File path')
  .action(async (path: string) => {
    try {
      const client = getClient();
      const result = await client.getTemporaryLink(path);
      console.log(chalk.bold('Temporary Link:'));
      console.log(result.link);
      console.log(chalk.gray('\nThis link expires after 4 hours.'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Sharing Commands
// ============================================

const shareCmd = program.command('share').description('Sharing operations');

shareCmd
  .command('create')
  .description('Create a shared link')
  .argument('<path>', 'File or folder path')
  .action(async (path: string) => {
    try {
      const client = getClient();
      const link = await client.createSharedLink(path);
      console.log(chalk.green('Shared link created:'));
      console.log(link.url);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

shareCmd
  .command('list')
  .description('List shared links')
  .option('-p, --path <path>', 'List links for specific path')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.listSharedLinks({ path: options.path });

      if (result.links.length === 0) {
        console.log(chalk.gray('No shared links'));
        return;
      }

      console.log(chalk.bold(`Shared Links (${result.links.length}):`));
      for (const link of result.links) {
        console.log(`\n  ${chalk.white(link.name)}`);
        console.log(`    URL: ${chalk.cyan(link.url)}`);
        console.log(`    Path: ${chalk.gray(link.path_lower || '-')}`);
        console.log(`    Visibility: ${link.link_permissions.resolved_visibility['.tag']}`);
        if (link.expires) {
          console.log(`    Expires: ${link.expires}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

shareCmd
  .command('revoke')
  .description('Revoke a shared link')
  .argument('<url>', 'Shared link URL')
  .action(async (url: string) => {
    try {
      const client = getClient();
      await client.revokeSharedLink(url);
      console.log(chalk.green('Shared link revoked'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

shareCmd
  .command('folders')
  .description('List shared folders')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listSharedFolders();

      if (result.entries.length === 0) {
        console.log(chalk.gray('No shared folders'));
        return;
      }

      console.log(chalk.bold(`Shared Folders (${result.entries.length}):`));
      for (const folder of result.entries) {
        console.log(`\n  ${chalk.blue(folder.name + '/')}`);
        console.log(`    ID: ${chalk.gray(folder.shared_folder_id)}`);
        console.log(`    Access: ${folder.access_type['.tag']}`);
        console.log(`    Team Folder: ${folder.is_team_folder ? 'Yes' : 'No'}`);
        if (folder.path_lower) {
          console.log(`    Path: ${folder.path_lower}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

shareCmd
  .command('folder-members')
  .description('List members of a shared folder')
  .argument('<folder-id>', 'Shared folder ID')
  .action(async (folderId: string) => {
    try {
      const client = getClient();
      const result = await client.listSharedFolderMembers(folderId);

      console.log(chalk.bold('Members:'));
      for (const member of result.users) {
        console.log(`\n  ${chalk.white(member.user.display_name)}`);
        console.log(`    Email: ${member.user.email}`);
        console.log(`    Access: ${member.access_type['.tag']}`);
        console.log(`    Same Team: ${member.user.same_team ? 'Yes' : 'No'}`);
      }

      if (result.groups && result.groups.length > 0) {
        console.log(chalk.bold('\nGroups:'));
        for (const group of result.groups) {
          console.log(`\n  ${chalk.white(group.group.group_name)}`);
          console.log(`    Access: ${group.access_type['.tag']}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Account Commands
// ============================================

const accountCmd = program.command('account').description('Account information');

accountCmd
  .command('info')
  .description('Get account information')
  .action(async () => {
    try {
      const client = getClient();
      const account = await client.getCurrentAccount();

      console.log(chalk.bold('Account Information:'));
      console.log(`  Name: ${account.name.display_name}`);
      console.log(`  Email: ${account.email} ${account.email_verified ? chalk.green('(verified)') : chalk.yellow('(unverified)')}`);
      console.log(`  Account Type: ${account.account_type['.tag']}`);
      console.log(`  Locale: ${account.locale}`);
      console.log(`  Referral Link: ${account.referral_link}`);

      if (account.team) {
        console.log(`\n  Team: ${account.team.name}`);
        console.log(`  Team ID: ${chalk.gray(account.team.id)}`);
      }

      console.log(`\n  Account ID: ${chalk.gray(account.account_id)}`);
      console.log(`  Root Namespace ID: ${chalk.gray(account.root_info.root_namespace_id)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

accountCmd
  .command('usage')
  .description('Get space usage')
  .action(async () => {
    try {
      const client = getClient();
      const usage = await client.getSpaceUsage();

      const usedPercent = (usage.used / usage.allocation.allocated * 100).toFixed(1);

      console.log(chalk.bold('Space Usage:'));
      console.log(`  Used: ${formatSize(usage.used)}`);
      console.log(`  Allocated: ${formatSize(usage.allocation.allocated)}`);
      console.log(`  Usage: ${usedPercent}%`);
      console.log(`  Type: ${usage.allocation['.tag']}`);

      // Progress bar
      const barWidth = 30;
      const filled = Math.round(parseFloat(usedPercent) / 100 * barWidth);
      const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(barWidth - filled));
      console.log(`\n  [${bar}] ${usedPercent}%`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
