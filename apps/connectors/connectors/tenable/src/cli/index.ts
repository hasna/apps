#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Tenable } from '../api';
import {
  getAccessKey,
  setAccessKey,
  getSecretKey,
  setSecretKey,
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
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'tenable';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tenable Vulnerability Management (Tenable.io) connector CLI')
  .version(VERSION)
  .option('--access-key <key>', 'Tenable access key (overrides config)')
  .option('--secret-key <key>', 'Tenable secret key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output for debugging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    if (opts.verbose) {
      setVerboseMode(true);
      debug('Verbose mode enabled');
    }

    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }

    if (opts.accessKey) process.env.TENABLE_ACCESS_KEY = opts.accessKey;
    if (opts.secretKey) process.env.TENABLE_SECRET_KEY = opts.secretKey;
  });

// Helper to get output format (walks up to the root program)
function getFormat(cmd: Command): OutputFormat {
  let parent: Command | null = cmd;
  while (parent) {
    const opts = parent.opts();
    if (opts.format) return opts.format as OutputFormat;
    parent = parent.parent;
  }
  return 'pretty';
}

// Helper to get an authenticated Tenable client
function getClient(): Tenable {
  const accessKey = getAccessKey();
  const secretKey = getSecretKey();
  if (!accessKey || !secretKey) {
    error(
      `No API keys configured. Run "${CONNECTOR_NAME} config set-keys <accessKey> <secretKey>" or set TENABLE_ACCESS_KEY and TENABLE_SECRET_KEY.`,
    );
    process.exit(1);
  }
  return new Tenable({ accessKey, secretKey, baseUrl: getBaseUrl() });
}

async function run<T>(cmd: Command, fn: (client: Tenable) => Promise<T>): Promise<void> {
  try {
    const result = await fn(getClient());
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

// ============================================
// Profile Commands
// ============================================
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
  .option('--access-key <key>', 'Tenable access key')
  .option('--secret-key <key>', 'Tenable secret key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { accessKey: opts.accessKey, secretKey: opts.secretKey });
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
    info(`Access Key: ${config.accessKey ? `${config.accessKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Secret Key: ${config.secretKey ? chalk.green('set') : chalk.gray('not set')}`);
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://cloud.tenable.com)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-keys <accessKey> <secretKey>')
  .description('Set Tenable access + secret keys')
  .action((accessKey: string, secretKey: string) => {
    setAccessKey(accessKey);
    setSecretKey(secretKey);
    success(`API keys saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set a custom API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessKey = getAccessKey();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Access Key: ${accessKey ? `${accessKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Secret Key: ${getSecretKey() ? chalk.green('set') : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default (https://cloud.tenable.com)')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Scan Commands
// ============================================
const scansCmd = program.command('scans').description('Manage and inspect scans');

scansCmd
  .command('list')
  .description('List scans')
  .option('--folder <id>', 'Filter by folder id')
  .action((opts) => run(scansCmd, (c) => c.listScans({ folderId: opts.folder ? parseInt(opts.folder, 10) : undefined })));

scansCmd
  .command('get <id>')
  .description('Get scan details')
  .action((id: string) => run(scansCmd, (c) => c.getScan(parseInt(id, 10))));

scansCmd
  .command('launch <id>')
  .description('Launch a scan')
  .option('--targets <targets>', 'Comma-separated alternate targets')
  .action((id: string, opts) =>
    run(scansCmd, (c) =>
      c.launchScan(
        parseInt(id, 10),
        opts.targets ? String(opts.targets).split(',').map((t: string) => t.trim()) : undefined,
      ),
    ),
  );

// ============================================
// Asset Commands
// ============================================
const assetsCmd = program.command('assets').description('Inspect workbench assets');

assetsCmd
  .command('list')
  .description('List assets')
  .option('--days <n>', 'Limit to assets seen in the last N days')
  .action((opts) => run(assetsCmd, (c) => c.listAssets({ dateRange: opts.days ? parseInt(opts.days, 10) : undefined })));

assetsCmd
  .command('get <id>')
  .description('Get asset info')
  .action((id: string) => run(assetsCmd, (c) => c.getAssetInfo(id)));

// ============================================
// Vulnerability Commands
// ============================================
const vulnsCmd = program.command('vulns').description('Inspect workbench vulnerabilities');

vulnsCmd
  .command('list')
  .description('List aggregated vulnerabilities')
  .option('--days <n>', 'Limit to vulnerabilities seen in the last N days')
  .option('--severity <level>', 'Filter by severity (info, low, medium, high, critical)')
  .action((opts) =>
    run(vulnsCmd, (c) =>
      c.listVulnerabilities({ dateRange: opts.days ? parseInt(opts.days, 10) : undefined, severity: opts.severity }),
    ),
  );

vulnsCmd
  .command('get <pluginId>')
  .description('Get vulnerability/plugin info')
  .action((pluginId: string) => run(vulnsCmd, (c) => c.getVulnerabilityInfo(parseInt(pluginId, 10))));

// ============================================
// Scanner / folder / session Commands
// ============================================
program
  .command('scanners')
  .description('List available scanners')
  .action(function (this: Command) {
    return run(this, (c) => c.listScanners());
  });

program
  .command('folders')
  .description('List scan result folders')
  .action(function (this: Command) {
    return run(this, (c) => c.listFolders());
  });

program
  .command('session')
  .description('Show current API session (verifies credentials)')
  .action(function (this: Command) {
    return run(this, (c) => c.getSession());
  });

// Parse and execute
program.parse();
