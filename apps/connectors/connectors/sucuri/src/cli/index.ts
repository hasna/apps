#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Sucuri } from '../api';
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getApiKey,
  getConfigDir,
  getCurrentProfile,
  getMonitorDomain,
  listProfiles,
  loadProfile,
  profileExists,
  setApiKey,
  setCurrentProfile,
  setMonitorDomain,
  setProfileOverride,
} from '../utils/config';
import type { SucuriScanFormat } from '../types';
import type { OutputFormat } from '../utils/output';
import { error, info, print, success } from '../utils/output';

const CONNECTOR_NAME = 'connect-sucuri';
const VERSION = '0.1.0';
const SCAN_FORMATS = new Set<SucuriScanFormat>(['simple', 'text', 'serialized']);

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Sucuri Scanning API connector CLI')
  .version(VERSION)
  .option('-k, --api-key <key>', 'Scanning API key (overrides config)')
  .option('--monitor-domain <domain>', 'Sucuri monitor domain (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty, table)', 'pretty')
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
      process.env['SUCURI_API_KEY'] = opts.apiKey;
    }
    if (opts.monitorDomain) {
      process.env['SUCURI_MONITOR_DOMAIN'] = opts.monitorDomain;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Sucuri {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SUCURI_API_KEY.`);
    process.exit(1);
  }

  const monitorDomain = getMonitorDomain();
  if (!monitorDomain) {
    error(`No monitor domain configured. Run "${CONNECTOR_NAME} config set-monitor-domain <domain>" or set SUCURI_MONITOR_DOMAIN.`);
    process.exit(1);
  }

  return new Sucuri({ apiKey, monitorDomain });
}

function parseScanFormat(format: string): SucuriScanFormat {
  if (SCAN_FORMATS.has(format as SucuriScanFormat)) {
    return format as SucuriScanFormat;
  }
  error(`Invalid scan format "${format}". Expected one of: simple, text, serialized.`);
  process.exit(1);
}

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
    profiles.forEach((profile) => {
      const isActive = profile === current ? chalk.green(' (active)') : '';
      console.log(`  ${profile}${isActive}`);
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
  .option('--api-key <key>', 'Scanning API key')
  .option('--monitor-domain <domain>', 'Sucuri monitor domain')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      apiKey: opts.apiKey,
      monitorDomain: opts.monitorDomain,
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
    info(`API Key: ${config.apiKey ? chalk.green('set') : chalk.gray('not set')}`);
    info(`Monitor domain: ${config.monitorDomain || chalk.gray('not set')}`);
  });

const configCmd = program
  .command('config')
  .description('Manage CLI configuration for the active profile');

configCmd
  .command('set-key <apiKey>')
  .description('Set Scanning API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-monitor-domain <domain>')
  .description('Set Sucuri monitor domain')
  .action((domain: string) => {
    setMonitorDomain(domain);
    success(`Monitor domain saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? chalk.green('set') : chalk.gray('not set')}`);
    info(`Monitor domain: ${getMonitorDomain() || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

program
  .command('scan <host>')
  .description('Request a Sucuri real-time scan for a domain or URL')
  .option('--scan-format <format>', 'Scan output format (simple, text, serialized)', 'simple')
  .action(async (host: string, opts) => {
    try {
      const client = getClient();
      const result = await client.scan({
        host,
        format: parseScanFormat(opts.scanFormat),
      });
      print(result, (program.opts().format || getFormat(program)) as OutputFormat);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
