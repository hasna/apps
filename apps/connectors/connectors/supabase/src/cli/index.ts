#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Supabase } from '../api';
import {
  getProjectUrl,
  setProjectUrl,
  getServiceRoleKey,
  setServiceRoleKey,
  getAnonKey,
  setAnonKey,
  clearConfig,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  setProfileOverride,
  getConfigDir,
  loadProfile,
} from '../utils/config';
import type { User, Bucket } from '../types';

const program = new Command();

// Format bytes
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Helper to get authenticated client
function getClient(): Supabase {
  const projectUrl = getProjectUrl();
  const serviceRoleKey = getServiceRoleKey();
  const anonKey = getAnonKey();

  if (!projectUrl) {
    console.error(chalk.red('Error: Project URL not configured. Run "connect-supabase auth set-url <url>" first or set SUPABASE_URL.'));
    process.exit(1);
  }
  if (!serviceRoleKey && !anonKey) {
    console.error(chalk.red('Error: No API key configured. Run "connect-supabase auth set-key <key>" first or set SUPABASE_SERVICE_ROLE_KEY.'));
    process.exit(1);
  }
  return new Supabase({ projectUrl, serviceRoleKey, anonKey });
}

program
  .name('connect-supabase')
  .description('Supabase connector - Manage auth, database, storage, and edge functions')
  .version('0.0.1')
  .option('--profile <name>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
  });

// ============================================
// Auth Commands (Configuration)
// ============================================

const authCmd = program.command('auth').description('Authentication and configuration');

authCmd
  .command('set-url')
  .description('Set Supabase project URL')
  .argument('<url>', 'Project URL (e.g., https://xxx.supabase.co)')
  .action((url: string) => {
    setProjectUrl(url);
    console.log(chalk.green(`Project URL saved to profile "${getCurrentProfile()}"`));
  });

authCmd
  .command('set-key')
  .description('Set service role key')
  .argument('<key>', 'Service role key')
  .action((key: string) => {
    setServiceRoleKey(key);
    console.log(chalk.green(`Service role key saved to profile "${getCurrentProfile()}"`));
  });

authCmd
  .command('set-anon-key')
  .description('Set anon/public key')
  .argument('<key>', 'Anon key')
  .action((key: string) => {
    setAnonKey(key);
    console.log(chalk.green(`Anon key saved to profile "${getCurrentProfile()}"`));
  });

authCmd
  .command('status')
  .description('Check authentication status')
  .action(async () => {
    const projectUrl = getProjectUrl();
    const serviceRoleKey = getServiceRoleKey();
    const anonKey = getAnonKey();

    if (!projectUrl) {
      console.log(chalk.yellow('Not configured'));
      console.log(chalk.gray('Run "connect-supabase auth set-url <url>" to configure'));
      return;
    }

    console.log(chalk.bold('Configuration:'));
    console.log(`  Profile: ${chalk.cyan(getCurrentProfile())}`);
    console.log(`  Project URL: ${chalk.white(projectUrl)}`);
    console.log(`  Service Role Key: ${serviceRoleKey ? chalk.green('Set') : chalk.gray('Not set')}`);
    console.log(`  Anon Key: ${anonKey ? chalk.green('Set') : chalk.gray('Not set')}`);

    if (serviceRoleKey || anonKey) {
      try {
        const client = getClient();
        const buckets = await client.listBuckets();
        console.log(chalk.green('\nConnected successfully'));
        console.log(`  Storage Buckets: ${chalk.white(buckets.length)}`);
      } catch (error) {
        console.log(chalk.red('\nConnection failed'));
        console.error(chalk.gray(error instanceof Error ? error.message : String(error)));
      }
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
    const config = loadProfile();
    console.log(`Current profile: ${chalk.cyan(getCurrentProfile())}`);
    console.log(`Config directory: ${chalk.gray(getConfigDir())}`);
    console.log(`Project URL: ${config.projectUrl || chalk.gray('Not set')}`);
  });

// ============================================
// Users Commands (Admin)
// ============================================

const usersCmd = program.command('users').description('User management (admin)');

usersCmd
  .command('list')
  .description('List all users')
  .option('--page <n>', 'Page number', '1')
  .option('--per-page <n>', 'Users per page', '50')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const client = getClient();
      const result = await client.listUsers({
        page: parseInt(options.page),
        per_page: parseInt(options.perPage),
      });

      if (options.json) {
        console.log(JSON.stringify(result.users, null, 2));
        return;
      }

      if (result.users.length === 0) {
        console.log(chalk.gray('No users found'));
        return;
      }

      console.log(chalk.bold(`Users (${result.users.length}):`));
      for (const user of result.users) {
        console.log(`\n  ${chalk.white(user.email || user.phone || 'Anonymous')}`);
        console.log(`    ID: ${chalk.gray(user.id)}`);
        console.log(`    Created: ${user.created_at}`);
        if (user.last_sign_in_at) {
          console.log(`    Last Sign In: ${user.last_sign_in_at}`);
        }
        if (user.banned_until) {
          console.log(`    Banned Until: ${chalk.red(user.banned_until)}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

usersCmd
  .command('get')
  .description('Get user by ID')
  .argument('<user-id>', 'User ID')
  .option('--json', 'Output as JSON')
  .action(async (userId: string, options) => {
    try {
      const client = getClient();
      const user = await client.getUserById(userId);

      if (options.json) {
        console.log(JSON.stringify(user, null, 2));
        return;
      }

      console.log(chalk.bold('User:'));
      console.log(`  ID: ${user.id}`);
      console.log(`  Email: ${user.email || chalk.gray('Not set')}`);
      console.log(`  Phone: ${user.phone || chalk.gray('Not set')}`);
      console.log(`  Created: ${user.created_at}`);
      console.log(`  Last Sign In: ${user.last_sign_in_at || chalk.gray('Never')}`);
      console.log(`  Email Verified: ${user.email_confirmed_at ? chalk.green('Yes') : chalk.yellow('No')}`);
      console.log(`  Phone Verified: ${user.phone_confirmed_at ? chalk.green('Yes') : chalk.yellow('No')}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

usersCmd
  .command('create')
  .description('Create a new user')
  .option('-e, --email <email>', 'User email')
  .option('-p, --password <password>', 'User password')
  .option('--phone <phone>', 'User phone')
  .option('--confirm-email', 'Auto-confirm email')
  .option('--confirm-phone', 'Auto-confirm phone')
  .action(async (options) => {
    try {
      const client = getClient();
      const user = await client.createUser({
        email: options.email,
        password: options.password,
        phone: options.phone,
        email_confirm: options.confirmEmail,
        phone_confirm: options.confirmPhone,
      });
      console.log(chalk.green(`User created: ${user.id}`));
      console.log(`  Email: ${user.email || chalk.gray('Not set')}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

usersCmd
  .command('delete')
  .description('Delete a user')
  .argument('<user-id>', 'User ID')
  .action(async (userId: string) => {
    try {
      const client = getClient();
      await client.deleteUser(userId);
      console.log(chalk.green('User deleted'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

usersCmd
  .command('invite')
  .description('Invite user by email')
  .argument('<email>', 'User email')
  .option('--redirect <url>', 'Redirect URL after confirmation')
  .action(async (email: string, options) => {
    try {
      const client = getClient();
      const user = await client.inviteUserByEmail(email, {
        redirect_to: options.redirect,
      });
      console.log(chalk.green(`Invitation sent to ${email}`));
      console.log(`  User ID: ${user.id}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Storage Commands
// ============================================

const storageCmd = program.command('storage').description('Storage operations');

storageCmd
  .command('buckets')
  .description('List storage buckets')
  .action(async () => {
    try {
      const client = getClient();
      const buckets = await client.listBuckets();

      if (buckets.length === 0) {
        console.log(chalk.gray('No buckets found'));
        return;
      }

      console.log(chalk.bold(`Buckets (${buckets.length}):`));
      for (const bucket of buckets) {
        const visibility = bucket.public ? chalk.green('public') : chalk.yellow('private');
        console.log(`\n  ${chalk.blue(bucket.name)} [${visibility}]`);
        console.log(`    ID: ${chalk.gray(bucket.id)}`);
        console.log(`    Created: ${bucket.created_at}`);
        if (bucket.file_size_limit) {
          console.log(`    Size Limit: ${formatSize(bucket.file_size_limit)}`);
        }
        if (bucket.allowed_mime_types) {
          console.log(`    Allowed Types: ${bucket.allowed_mime_types.join(', ')}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

storageCmd
  .command('create-bucket')
  .description('Create a storage bucket')
  .argument('<name>', 'Bucket name')
  .option('--public', 'Make bucket public')
  .option('--size-limit <bytes>', 'File size limit in bytes')
  .action(async (name: string, options) => {
    try {
      const client = getClient();
      const result = await client.createBucket({
        name,
        public: options.public || false,
        file_size_limit: options.sizeLimit ? parseInt(options.sizeLimit) : undefined,
      });
      console.log(chalk.green(`Bucket created: ${result.name}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

storageCmd
  .command('delete-bucket')
  .description('Delete a storage bucket (must be empty)')
  .argument('<bucket>', 'Bucket name or ID')
  .action(async (bucket: string) => {
    try {
      const client = getClient();
      await client.deleteBucket(bucket);
      console.log(chalk.green('Bucket deleted'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

storageCmd
  .command('empty-bucket')
  .description('Delete all files in a bucket')
  .argument('<bucket>', 'Bucket name or ID')
  .action(async (bucket: string) => {
    try {
      const client = getClient();
      await client.emptyBucket(bucket);
      console.log(chalk.green('Bucket emptied'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

storageCmd
  .command('list')
  .description('List files in a bucket')
  .argument('<bucket>', 'Bucket name')
  .option('--prefix <prefix>', 'Filter by path prefix')
  .option('--limit <n>', 'Maximum files', '100')
  .action(async (bucket: string, options) => {
    try {
      const client = getClient();
      const files = await client.listFiles(bucket, {
        prefix: options.prefix,
        limit: parseInt(options.limit),
      });

      if (files.length === 0) {
        console.log(chalk.gray('No files found'));
        return;
      }

      console.log(chalk.bold(`Files (${files.length}):`));
      for (const file of files) {
        console.log(`  ${chalk.white(file.name)}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

storageCmd
  .command('upload')
  .description('Upload a file')
  .argument('<bucket>', 'Bucket name')
  .argument('<local>', 'Local file path')
  .argument('<remote>', 'Remote path in bucket')
  .action(async (bucket: string, local: string, remote: string) => {
    try {
      const content = await Bun.file(local).arrayBuffer();
      const client = getClient();
      const result = await client.uploadFile(bucket, remote, content);
      console.log(chalk.green(`Uploaded: ${result.Key}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

storageCmd
  .command('download')
  .description('Download a file')
  .argument('<bucket>', 'Bucket name')
  .argument('<remote>', 'Remote path in bucket')
  .argument('[local]', 'Local file path')
  .action(async (bucket: string, remote: string, local?: string) => {
    try {
      const client = getClient();
      const content = await client.downloadFile(bucket, remote);
      const localPath = local || remote.split('/').pop() || 'download';
      await Bun.write(localPath, content);
      console.log(chalk.green(`Downloaded: ${localPath}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

storageCmd
  .command('url')
  .description('Get signed URL for a file')
  .argument('<bucket>', 'Bucket name')
  .argument('<path>', 'File path')
  .option('--expires <seconds>', 'Expiration time in seconds', '3600')
  .action(async (bucket: string, path: string, options) => {
    try {
      const client = getClient();
      const result = await client.createSignedUrl(bucket, path, parseInt(options.expires));
      console.log(chalk.bold('Signed URL:'));
      console.log(result.signedUrl);
      console.log(chalk.gray(`\nExpires in ${options.expires} seconds`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

storageCmd
  .command('public-url')
  .description('Get public URL for a file (bucket must be public)')
  .argument('<bucket>', 'Bucket name')
  .argument('<path>', 'File path')
  .action((bucket: string, path: string) => {
    const client = getClient();
    const url = client.getPublicUrl(bucket, path);
    console.log(chalk.bold('Public URL:'));
    console.log(url);
  });

// ============================================
// Database Commands
// ============================================

const dbCmd = program.command('db').description('Database operations (REST API)');

dbCmd
  .command('select')
  .description('Select records from a table')
  .argument('<table>', 'Table name')
  .option('-s, --select <columns>', 'Columns to select')
  .option('-f, --filter <filter>', 'Filter (e.g., "id=eq.1")')
  .option('-o, --order <order>', 'Order by (e.g., "created_at.desc")')
  .option('-l, --limit <n>', 'Limit results')
  .option('--json', 'Output as JSON')
  .action(async (table: string, options) => {
    try {
      const client = getClient();
      const filter: Record<string, string> = {};

      if (options.filter) {
        const [key, value] = options.filter.split('=');
        filter[key] = value;
      }

      const result = await client.select(table, {
        select: options.select,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        order: options.order,
        limit: options.limit ? parseInt(options.limit) : undefined,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.length === 0) {
        console.log(chalk.gray('No records found'));
        return;
      }

      console.log(chalk.bold(`Records (${result.length}):`));
      for (const record of result) {
        console.log(JSON.stringify(record, null, 2));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

dbCmd
  .command('insert')
  .description('Insert a record')
  .argument('<table>', 'Table name')
  .requiredOption('-d, --data <json>', 'Record data as JSON')
  .action(async (table: string, options) => {
    try {
      const data = JSON.parse(options.data);
      const client = getClient();
      const result = await client.insert(table, data);
      console.log(chalk.green('Record inserted'));
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

dbCmd
  .command('update')
  .description('Update records')
  .argument('<table>', 'Table name')
  .requiredOption('-d, --data <json>', 'Update data as JSON')
  .requiredOption('-f, --filter <filter>', 'Filter (e.g., "id=eq.1")')
  .action(async (table: string, options) => {
    try {
      const data = JSON.parse(options.data);
      const [key, value] = options.filter.split('=');
      const filter = { [key]: value };

      const client = getClient();
      const result = await client.update(table, data, filter);
      console.log(chalk.green('Records updated'));
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

dbCmd
  .command('delete')
  .description('Delete records')
  .argument('<table>', 'Table name')
  .requiredOption('-f, --filter <filter>', 'Filter (e.g., "id=eq.1")')
  .action(async (table: string, options) => {
    try {
      const [key, value] = options.filter.split('=');
      const filter = { [key]: value };

      const client = getClient();
      const result = await client.deleteRecords(table, filter);
      console.log(chalk.green('Records deleted'));
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

dbCmd
  .command('rpc')
  .description('Call an RPC function')
  .argument('<function>', 'Function name')
  .option('-p, --params <json>', 'Function parameters as JSON')
  .action(async (functionName: string, options) => {
    try {
      const params = options.params ? JSON.parse(options.params) : undefined;
      const client = getClient();
      const result = await client.rpc(functionName, params);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Functions Commands
// ============================================

const functionsCmd = program.command('functions').description('Edge Functions operations');

functionsCmd
  .command('invoke')
  .description('Invoke an edge function')
  .argument('<function>', 'Function name')
  .option('-d, --data <json>', 'Request body as JSON')
  .action(async (functionName: string, options) => {
    try {
      const body = options.data ? JSON.parse(options.data) : undefined;
      const client = getClient();
      const result = await client.invokeFunction(functionName, { body });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
