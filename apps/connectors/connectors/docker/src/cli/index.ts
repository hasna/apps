#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Docker } from '../api';
import {
  getAccessToken,
  setAccessToken,
  getUsername,
  setUsername,
  getPassword,
  setPassword,
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

// Docker Hub connector
const CONNECTOR_NAME = 'docker';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Docker Hub API connector CLI')
  .version(VERSION)
  .option('-t, --token <token>', 'Access token (overrides config)')
  .option('-u, --username <username>', 'Docker Hub username')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    // Set profile override before any command runs
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    // Set credentials from flags if provided
    if (opts.token) {
      process.env.DOCKER_ACCESS_TOKEN = opts.token;
    }
    if (opts.username) {
      process.env.DOCKER_USERNAME = opts.username;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): Docker {
  const accessToken = getAccessToken();
  const username = getUsername();
  const password = getPassword();

  if (accessToken) {
    return new Docker({ accessToken });
  }

  if (username && password) {
    return new Docker({ username, password });
  }

  error(`No credentials configured. Run "${CONNECTOR_NAME} config set-token <token>" or set DOCKER_ACCESS_TOKEN environment variable.`);
  process.exit(1);
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
  .option('--token <token>', 'Access token')
  .option('--username <username>', 'Docker Hub username')
  .option('--password <password>', 'Docker Hub password')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
      accessToken: opts.token,
      username: opts.username,
      password: opts.password,
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
    info(`Username: ${config.username || chalk.gray('not set')}`);
    info(`Access Token: ${config.accessToken ? `${config.accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Password: ${config.password ? '********' : chalk.gray('not set')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-token <token>')
  .description('Set access token')
  .action((token: string) => {
    setAccessToken(token);
    success(`Access token saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-username <username>')
  .description('Set Docker Hub username')
  .action((username: string) => {
    setUsername(username);
    success(`Username saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-password <password>')
  .description('Set Docker Hub password')
  .action((password: string) => {
    setPassword(password);
    success(`Password saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const accessToken = getAccessToken();
    const username = getUsername();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`Username: ${username || chalk.gray('not set')}`);
    info(`Access Token: ${accessToken ? `${accessToken.substring(0, 8)}...` : chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Repository Commands
// ============================================
const repoCmd = program
  .command('repo')
  .description('Manage Docker Hub repositories');

repoCmd
  .command('list <namespace>')
  .description('List repositories for a namespace')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Results per page', '25')
  .action(async (namespace: string, opts) => {
    try {
      const client = getClient();
      const result = await client.repositories.list(namespace, {
        page: parseInt(opts.page),
        pageSize: parseInt(opts.pageSize),
      });
      print(result, getFormat(repoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

repoCmd
  .command('get <namespace> <repository>')
  .description('Get repository details')
  .action(async (namespace: string, repository: string) => {
    try {
      const client = getClient();
      const result = await client.repositories.get(namespace, repository);
      print(result, getFormat(repoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

repoCmd
  .command('tags <namespace> <repository>')
  .description('List tags for a repository')
  .option('--page <number>', 'Page number', '1')
  .option('--page-size <number>', 'Results per page', '25')
  .action(async (namespace: string, repository: string, opts) => {
    try {
      const client = getClient();
      const result = await client.repositories.listTags(namespace, repository, {
        page: parseInt(opts.page),
        pageSize: parseInt(opts.pageSize),
      });
      print(result, getFormat(repoCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

repoCmd
  .command('delete-tag <namespace> <repository> <tag>')
  .description('Delete a tag from a repository')
  .action(async (namespace: string, repository: string, tag: string) => {
    try {
      const client = getClient();
      await client.repositories.deleteTag(namespace, repository, tag);
      success(`Tag "${tag}" deleted from ${namespace}/${repository}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

repoCmd
  .command('delete <namespace> <repository>')
  .description('Delete a repository')
  .action(async (namespace: string, repository: string) => {
    try {
      const client = getClient();
      await client.repositories.delete(namespace, repository);
      success(`Repository ${namespace}/${repository} deleted`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
