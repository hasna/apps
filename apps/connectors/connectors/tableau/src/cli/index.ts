#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Tableau } from '../api';
import type { TableauConfig, PageOptions } from '../types';
import {
  getServerUrl,
  getSiteName,
  getApiVersion,
  getUsername,
  getPassword,
  getPatName,
  getPatSecret,
  updateConfig,
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
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-tableau';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Tableau connector - Explore workbooks, views, datasources, projects, and users')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, table, pretty)', 'pretty')
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
  });

function getFormat(cmd: Command): OutputFormat {
  let parent: Command | null = cmd;
  while (parent) {
    const fmt = parent.opts().format;
    if (fmt) {
      return fmt as OutputFormat;
    }
    parent = parent.parent;
  }
  return 'pretty';
}

function getClient(): Tableau {
  const serverUrl = getServerUrl();
  if (!serverUrl) {
    error(`No server URL configured. Run "${CONNECTOR_NAME} config set --server-url <url>" or set TABLEAU_SERVER_URL.`);
    process.exit(1);
  }

  const patName = getPatName();
  const patSecret = getPatSecret();
  const username = getUsername();
  const password = getPassword();

  if (!(patName && patSecret) && !(username && password)) {
    error(
      `No credentials configured. Set a personal access token (config set --pat-name <n> --pat-secret <s>) ` +
        `or username/password, or use the TABLEAU_PAT_NAME/TABLEAU_PAT_SECRET (or TABLEAU_USERNAME/TABLEAU_PASSWORD) env vars.`,
    );
    process.exit(1);
  }

  const config: TableauConfig = {
    serverUrl,
    siteName: getSiteName(),
    apiVersion: getApiVersion(),
    username,
    password,
    patName,
    patSecret,
  };
  return new Tableau(config);
}

function pageOptions(opts: { pageSize?: string; pageNumber?: string }): PageOptions {
  const result: PageOptions = {};
  if (opts.pageSize) {
    result.pageSize = parseInt(opts.pageSize, 10);
  }
  if (opts.pageNumber) {
    result.pageNumber = parseInt(opts.pageNumber, 10);
  }
  return result;
}

async function run(cmd: Command, fn: (client: Tableau) => Promise<unknown>): Promise<void> {
  try {
    const client = getClient();
    const result = await fn(client);
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
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

    success('Profiles:');
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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {});
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
    info(`Server URL: ${config.serverUrl || chalk.gray('not set')}`);
    info(`Site: ${config.siteName !== undefined ? (config.siteName || chalk.gray('(default site)')) : chalk.gray('not set')}`);
    info(`API Version: ${config.apiVersion || chalk.gray('default')}`);
    info(`PAT Name: ${config.patName || chalk.gray('not set')}`);
    info(`PAT Secret: ${config.patSecret ? '********' : chalk.gray('not set')}`);
    info(`Username: ${config.username || chalk.gray('not set')}`);
    info(`Password: ${config.password ? '********' : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set')
  .description('Set connection and credential values for the active profile')
  .option('--server-url <url>', 'Tableau Server / Cloud base URL')
  .option('--site-name <contentUrl>', 'Site content URL (empty string for the Default site)')
  .option('--api-version <version>', 'REST API version (e.g. 3.21)')
  .option('--pat-name <name>', 'Personal access token name')
  .option('--pat-secret <secret>', 'Personal access token secret')
  .option('--username <username>', 'Username (password auth)')
  .option('--password <password>', 'Password (password auth)')
  .action((opts) => {
    const updates: Record<string, string> = {};
    if (opts.serverUrl !== undefined) updates.serverUrl = opts.serverUrl;
    if (opts.siteName !== undefined) updates.siteName = opts.siteName;
    if (opts.apiVersion !== undefined) updates.apiVersion = opts.apiVersion;
    if (opts.patName !== undefined) updates.patName = opts.patName;
    if (opts.patSecret !== undefined) updates.patSecret = opts.patSecret;
    if (opts.username !== undefined) updates.username = opts.username;
    if (opts.password !== undefined) updates.password = opts.password;

    if (Object.keys(updates).length === 0) {
      error('Nothing to set. Pass at least one of --server-url, --site-name, --api-version, --pat-name, --pat-secret, --username, --password.');
      process.exit(1);
    }

    updateConfig(updates);
    success(`Configuration saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Server URL: ${getServerUrl() || chalk.gray('not set')}`);
    const site = getSiteName();
    info(`Site: ${site !== undefined ? (site || chalk.gray('(default site)')) : chalk.gray('not set')}`);
    info(`API Version: ${getApiVersion() || chalk.gray('default')}`);
    info(`PAT Name: ${getPatName() || chalk.gray('not set')}`);
    info(`PAT Secret: ${getPatSecret() ? '********' : chalk.gray('not set')}`);
    info(`Username: ${getUsername() || chalk.gray('not set')}`);
    info(`Password: ${getPassword() ? '********' : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Workbook Commands
// ============================================
const workbookCmd = program
  .command('workbook')
  .alias('workbooks')
  .description('Explore workbooks');

workbookCmd
  .command('list')
  .description('List workbooks on the site')
  .option('--page-size <number>', 'Number of items per page (max 1000)')
  .option('--page-number <number>', 'Page number to fetch')
  .action((opts, cmd) => run(cmd, (client) => client.listWorkbooks(pageOptions(opts))));

workbookCmd
  .command('get <id>')
  .description('Get a workbook by ID')
  .action((id: string, _opts, cmd) => run(cmd, (client) => client.getWorkbook(id)));

workbookCmd
  .command('views <id>')
  .description('Query the views contained in a workbook')
  .option('--page-size <number>', 'Number of items per page (max 1000)')
  .option('--page-number <number>', 'Page number to fetch')
  .action((id: string, opts, cmd) => run(cmd, (client) => client.queryViews(id, pageOptions(opts))));

// ============================================
// View Commands
// ============================================
const viewCmd = program
  .command('view')
  .alias('views')
  .description('Explore views');

viewCmd
  .command('list')
  .description('List views on the site')
  .option('--page-size <number>', 'Number of items per page (max 1000)')
  .option('--page-number <number>', 'Page number to fetch')
  .action((opts, cmd) => run(cmd, (client) => client.listViews(pageOptions(opts))));

viewCmd
  .command('get <id>')
  .description('Get a view by ID')
  .action((id: string, _opts, cmd) => run(cmd, (client) => client.getView(id)));

// ============================================
// Data Source Commands
// ============================================
const datasourceCmd = program
  .command('datasource')
  .alias('datasources')
  .description('Explore data sources');

datasourceCmd
  .command('list')
  .description('List data sources on the site')
  .option('--page-size <number>', 'Number of items per page (max 1000)')
  .option('--page-number <number>', 'Page number to fetch')
  .action((opts, cmd) => run(cmd, (client) => client.listDataSources(pageOptions(opts))));

// ============================================
// Project Commands
// ============================================
const projectCmd = program
  .command('project')
  .alias('projects')
  .description('Explore projects');

projectCmd
  .command('list')
  .description('List projects on the site')
  .option('--page-size <number>', 'Number of items per page (max 1000)')
  .option('--page-number <number>', 'Page number to fetch')
  .action((opts, cmd) => run(cmd, (client) => client.listProjects(pageOptions(opts))));

// ============================================
// User Commands
// ============================================
const userCmd = program
  .command('user')
  .alias('users')
  .description('Explore users');

userCmd
  .command('list')
  .description('List users on the site')
  .option('--page-size <number>', 'Number of items per page (max 1000)')
  .option('--page-number <number>', 'Page number to fetch')
  .action((opts, cmd) => run(cmd, (client) => client.listUsers(pageOptions(opts))));

// Parse and execute
program.parse();
