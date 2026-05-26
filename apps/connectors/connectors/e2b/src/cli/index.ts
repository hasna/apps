#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { E2B } from '../api';
import {
  getApiKey,
  setApiKey,
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
  getDefaultTemplate,
  setDefaultTemplate,
  getDefaultTimeout,
  setDefaultTimeout,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-e2b';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('E2B Code Interpreter API connector - Run code in secure cloud sandboxes')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
    // Set API key from flag if provided
    if (opts.apiKey) {
      process.env.E2B_API_KEY = opts.apiKey;
    }
  });

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): E2B {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set E2B_API_KEY environment variable.`);
    process.exit(1);
  }
  return new E2B({ apiKey });
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }

    createProfile(name, {
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

    console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    if (config.defaultTemplate) {
      info(`Default Template: ${config.defaultTemplate}`);
    }
    if (config.defaultTimeout) {
      info(`Default Timeout: ${config.defaultTimeout}ms`);
    }
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set E2B API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-template <template>')
  .description('Set default sandbox template')
  .action((template: string) => {
    setDefaultTemplate(template);
    success(`Default template set to: ${template}`);
  });

configCmd
  .command('set-timeout <timeout>')
  .description('Set default sandbox timeout (in milliseconds)')
  .action((timeout: string) => {
    const ms = parseInt(timeout, 10);
    if (isNaN(ms) || ms <= 0) {
      error('Timeout must be a positive number');
      process.exit(1);
    }
    setDefaultTimeout(ms);
    success(`Default timeout set to: ${ms}ms`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const template = getDefaultTemplate();
    const timeout = getDefaultTimeout();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Default Template: ${template || chalk.gray('base')}`);
    info(`Default Timeout: ${timeout ? `${timeout}ms` : chalk.gray('default')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Sandbox Commands
// ============================================
const sandboxCmd = program
  .command('sandbox')
  .description('Manage E2B sandboxes');

sandboxCmd
  .command('create')
  .description('Create a new sandbox')
  .option('-t, --template <template>', 'Sandbox template (e.g., base, python, nodejs)')
  .option('--timeout <ms>', 'Sandbox timeout in milliseconds')
  .option('-m, --metadata <json>', 'Metadata as JSON string')
  .action(async (opts) => {
    try {
      const client = getClient();
      const options: Record<string, unknown> = {};

      if (opts.template) {
        options.template = opts.template;
      } else {
        const defaultTemplate = getDefaultTemplate();
        if (defaultTemplate) {
          options.template = defaultTemplate;
        }
      }

      if (opts.timeout) {
        options.timeout = parseInt(opts.timeout, 10);
      } else {
        const defaultTimeout = getDefaultTimeout();
        if (defaultTimeout) {
          options.timeout = defaultTimeout;
        }
      }

      if (opts.metadata) {
        try {
          options.metadata = JSON.parse(opts.metadata);
        } catch {
          error('Invalid metadata JSON');
          process.exit(1);
        }
      }

      const sandbox = await client.sandbox.create(options);
      success('Sandbox created!');
      print(sandbox, getFormat(sandboxCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sandboxCmd
  .command('list')
  .description('List all running sandboxes')
  .action(async () => {
    try {
      const client = getClient();
      const sandboxes = await client.sandbox.list();

      if (sandboxes.length === 0) {
        info('No running sandboxes');
        return;
      }

      print(sandboxes, getFormat(sandboxCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sandboxCmd
  .command('get <sandboxId>')
  .description('Get sandbox information')
  .action(async (sandboxId: string) => {
    try {
      const client = getClient();
      const sandbox = await client.sandbox.get(sandboxId);
      print(sandbox, getFormat(sandboxCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sandboxCmd
  .command('kill <sandboxId>')
  .description('Kill (terminate) a sandbox')
  .action(async (sandboxId: string) => {
    try {
      const client = getClient();
      await client.sandbox.kill(sandboxId);
      success(`Sandbox ${sandboxId} killed`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sandboxCmd
  .command('keep-alive <sandboxId>')
  .description('Extend sandbox lifetime')
  .option('--timeout <ms>', 'New timeout in milliseconds', '300000')
  .action(async (sandboxId: string, opts) => {
    try {
      const client = getClient();
      const timeout = parseInt(opts.timeout, 10);
      const sandbox = await client.sandbox.keepAlive(sandboxId, { timeout });
      success(`Sandbox ${sandboxId} timeout extended`);
      print(sandbox, getFormat(sandboxCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Run Command (Execute Code)
// ============================================
program
  .command('run <code>')
  .description('Execute code in a sandbox (creates and destroys sandbox automatically)')
  .option('-l, --language <lang>', 'Programming language (python, javascript, bash, etc.)')
  .option('-s, --sandbox <id>', 'Use existing sandbox instead of creating a new one')
  .option('--no-cleanup', 'Keep sandbox after execution (only for new sandboxes)')
  .action(async (code: string, opts) => {
    try {
      const client = getClient();

      if (opts.sandbox) {
        // Use existing sandbox
        const result = await client.code.execute(opts.sandbox, {
          code,
          language: opts.language,
        });
        print(result, getFormat(program));
      } else {
        // Create new sandbox, run code, optionally cleanup
        const result = await client.run(code, opts.language, opts.cleanup !== false);
        print(result, getFormat(program));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Command execution
// ============================================
program
  .command('exec <command>')
  .description('Execute a shell command in a sandbox')
  .option('-s, --sandbox <id>', 'Use existing sandbox')
  .option('-w, --workdir <path>', 'Working directory')
  .option('--no-cleanup', 'Keep sandbox after execution')
  .action(async (command: string, opts) => {
    try {
      const client = getClient();

      if (opts.sandbox) {
        const result = await client.code.runCommand(opts.sandbox, {
          command,
          workDir: opts.workdir,
        });
        print(result, getFormat(program));
      } else {
        const result = await client.runCommand(command, opts.cleanup !== false);
        print(result, getFormat(program));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// File Commands
// ============================================
const fileCmd = program
  .command('file')
  .description('Manage files in a sandbox');

fileCmd
  .command('read <sandboxId> <path>')
  .description('Read a file from the sandbox')
  .action(async (sandboxId: string, path: string) => {
    try {
      const client = getClient();
      const result = await client.filesystem.read(sandboxId, path);
      console.log(result.content);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

fileCmd
  .command('write <sandboxId> <path> <content>')
  .description('Write content to a file in the sandbox')
  .action(async (sandboxId: string, path: string, content: string) => {
    try {
      const client = getClient();
      await client.filesystem.write(sandboxId, path, content);
      success(`File written: ${path}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

fileCmd
  .command('list <sandboxId> [path]')
  .description('List directory contents')
  .action(async (sandboxId: string, path: string = '/') => {
    try {
      const client = getClient();
      const result = await client.filesystem.list(sandboxId, path);
      print(result.entries, getFormat(fileCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

fileCmd
  .command('mkdir <sandboxId> <path>')
  .description('Create a directory')
  .action(async (sandboxId: string, path: string) => {
    try {
      const client = getClient();
      await client.filesystem.mkdir(sandboxId, path);
      success(`Directory created: ${path}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

fileCmd
  .command('rm <sandboxId> <path>')
  .description('Remove a file or directory')
  .action(async (sandboxId: string, path: string) => {
    try {
      const client = getClient();
      await client.filesystem.remove(sandboxId, path);
      success(`Removed: ${path}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
