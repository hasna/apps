#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { BrowserUse } from '../api';
import {
  getApiKey,
  setApiKey,
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
  hasApiKey,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, warn } from '../utils/output';

const CONNECTOR_NAME = 'connect-browseruse';
const VERSION = '0.0.2';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Browser Use Cloud API connector CLI - AI-powered browser automation')
  .version(VERSION)
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
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

// Helper to get output format
function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

// Helper to get authenticated client
function getClient(): BrowserUse {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();

  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set BROWSER_USE_API_KEY environment variable.`);
    process.exit(1);
  }

  return new BrowserUse({ apiKey, baseUrl });
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
  .option('--api-key <key>', 'Browser Use API key')
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default (https://api.browser-use.com/api/v2)')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program
  .command('config')
  .description('Manage CLI configuration');

configCmd
  .command('set-key <apiKey>')
  .description('Set Browser Use API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-url <baseUrl>')
  .description('Set custom base URL')
  .action((baseUrl: string) => {
    setBaseUrl(baseUrl);
    success(`Base URL set to: ${baseUrl}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const baseUrl = getBaseUrl();

    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${baseUrl}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Tasks Commands
// ============================================
const tasksCmd = program
  .command('tasks')
  .alias('task')
  .description('Task operations');

tasksCmd
  .command('list')
  .description('List all tasks')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .option('-s, --status <status>', 'Filter by status')
  .option('--session <id>', 'Filter by session ID')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.tasks.list({
        limit: parseInt(opts.limit),
        status: opts.status,
        sessionId: opts.session,
      });
      print(result.data, getFormat(tasksCmd));
      if (result.hasMore) {
        info('More results available. Use --cursor to paginate.');
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('create <task>')
  .description('Create a new task')
  .option('--session <id>', 'Use existing session')
  .option('--save-browser-data', 'Save browser data after task')
  .option('--secrets <json>', 'Sensitive data as JSON (e.g., \'{"x_user":"email","x_pass":"password"}\')')
  .option('--no-vision', 'Disable vision to prevent LLM from seeing screenshots')
  .option('--allowed-domains <domains>', 'Comma-separated list of allowed domains')
  .action(async (task: string, opts) => {
    try {
      const client = getClient();

      // Parse sensitive data if provided
      let sensitiveData: Record<string, string> | undefined;
      if (opts.secrets) {
        try {
          sensitiveData = JSON.parse(opts.secrets);
        } catch {
          error('Invalid JSON for --secrets option');
          process.exit(1);
        }
      }

      const result = await client.tasks.create({
        task,
        sessionId: opts.session,
        save_browser_data: opts.saveBrowserData,
        sensitive_data: sensitiveData,
        use_vision: opts.vision !== false ? undefined : false,
        allowed_domains: opts.allowedDomains?.split(',').map((d: string) => d.trim()),
      });
      success(`Task created: ${result.id}`);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('get <taskId>')
  .description('Get a task by ID')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.tasks.get(taskId);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('run <task>')
  .description('Run a task and wait for completion')
  .option('--timeout <ms>', 'Timeout in milliseconds', '300000')
  .option('--secrets <json>', 'Sensitive data as JSON (e.g., \'{"x_user":"email","x_pass":"password"}\')')
  .option('--no-vision', 'Disable vision to prevent LLM from seeing screenshots')
  .option('--allowed-domains <domains>', 'Comma-separated list of allowed domains')
  .action(async (task: string, opts) => {
    try {
      const client = getClient();
      info('Creating task...');

      // Parse sensitive data if provided
      let sensitiveData: Record<string, string> | undefined;
      if (opts.secrets) {
        try {
          sensitiveData = JSON.parse(opts.secrets);
          info('Sensitive data configured (values hidden from LLM)');
        } catch {
          error('Invalid JSON for --secrets option');
          process.exit(1);
        }
      }

      const created = await client.tasks.create({
        task,
        sensitive_data: sensitiveData,
        use_vision: opts.vision !== false ? undefined : false,
        allowed_domains: opts.allowedDomains?.split(',').map((d: string) => d.trim()),
      });
      info(`Task created: ${created.id}`);
      if (created.liveUrl) {
        info(`Live view: ${created.liveUrl}`);
      }

      info('Waiting for completion...');
      const result = await client.tasks.waitForCompletion(
        created.id,
        2000,
        parseInt(opts.timeout)
      );

      if (result.status === 'completed') {
        success('Task completed successfully');
      } else if (result.status === 'failed') {
        error(`Task failed: ${result.error}`);
      } else {
        warn(`Task ended with status: ${result.status}`);
      }

      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('stop <taskId>')
  .description('Stop a running task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.tasks.stop(taskId);
      success(`Task stopped: ${taskId}`);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('pause <taskId>')
  .description('Pause a running task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.tasks.pause(taskId);
      success(`Task paused: ${taskId}`);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('resume <taskId>')
  .description('Resume a paused task')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.tasks.resume(taskId);
      success(`Task resumed: ${taskId}`);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

tasksCmd
  .command('logs <taskId>')
  .description('Get task logs download URL')
  .action(async (taskId: string) => {
    try {
      const client = getClient();
      const result = await client.tasks.getLogs(taskId);
      print(result, getFormat(tasksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Sessions Commands
// ============================================
const sessionsCmd = program
  .command('sessions')
  .alias('session')
  .description('Session operations');

sessionsCmd
  .command('list')
  .description('List all sessions')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.sessions.list({
        limit: parseInt(opts.limit),
        status: opts.status,
      });
      print(result.data, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('create')
  .description('Create a new session')
  .option('--task <task>', 'Initial task to run')
  .option('--profile <id>', 'Browser profile ID')
  .option('--proxy <url>', 'Proxy URL')
  .option('--keep-alive', 'Keep session alive after task')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.sessions.create({
        task: opts.task,
        profileId: opts.profile,
        proxyUrl: opts.proxy,
        keepAlive: opts.keepAlive,
      });
      success(`Session created: ${result.id}`);
      if (result.liveUrl) {
        info(`Live view: ${result.liveUrl}`);
      }
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('get <sessionId>')
  .description('Get a session by ID')
  .action(async (sessionId: string) => {
    try {
      const client = getClient();
      const result = await client.sessions.get(sessionId);
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('stop <sessionId>')
  .description('Stop a session')
  .action(async (sessionId: string) => {
    try {
      const client = getClient();
      const result = await client.sessions.stop(sessionId);
      success(`Session stopped: ${sessionId}`);
      print(result, getFormat(sessionsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('delete <sessionId>')
  .description('Delete a session')
  .action(async (sessionId: string) => {
    try {
      const client = getClient();
      await client.sessions.delete(sessionId);
      success(`Session deleted: ${sessionId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sessionsCmd
  .command('share <sessionId>')
  .description('Create public share URL for a session')
  .action(async (sessionId: string) => {
    try {
      const client = getClient();
      const result = await client.sessions.createPublicShare(sessionId);
      success(`Public share created`);
      info(`URL: ${result.publicUrl}`);
      info(`Expires: ${result.expiresAt}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Browser Profiles Commands
// ============================================
const profilesCmd = program
  .command('profiles')
  .description('Browser profile operations (persistent browser state)');

profilesCmd
  .command('list')
  .description('List all browser profiles')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.profiles.list({
        limit: parseInt(opts.limit),
      });
      print(result.data, getFormat(profilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('create <name>')
  .description('Create a new browser profile')
  .option('-d, --description <desc>', 'Profile description')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      const result = await client.profiles.create({
        name,
        description: opts.description,
      });
      success(`Browser profile created: ${result.id}`);
      print(result, getFormat(profilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('get <profileId>')
  .description('Get a browser profile by ID')
  .action(async (profileId: string) => {
    try {
      const client = getClient();
      const result = await client.profiles.get(profileId);
      print(result, getFormat(profilesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

profilesCmd
  .command('delete <profileId>')
  .description('Delete a browser profile')
  .action(async (profileId: string) => {
    try {
      const client = getClient();
      await client.profiles.delete(profileId);
      success(`Browser profile deleted: ${profileId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Skills Commands
// ============================================
const skillsCmd = program
  .command('skills')
  .alias('skill')
  .description('Skill operations');

skillsCmd
  .command('list')
  .description('List all skills')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.skills.list({
        limit: parseInt(opts.limit),
        status: opts.status,
      });
      print(result.data, getFormat(skillsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

skillsCmd
  .command('create <name>')
  .description('Create a new skill')
  .requiredOption('-t, --task <task>', 'Task description for skill generation')
  .option('-d, --description <desc>', 'Skill description')
  .action(async (name: string, opts) => {
    try {
      const client = getClient();
      info('Creating skill (this may take a while)...');
      const result = await client.skills.create({
        name,
        task: opts.task,
        description: opts.description,
      });
      success(`Skill created: ${result.id}`);
      info(`Status: ${result.status}`);
      print(result, getFormat(skillsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

skillsCmd
  .command('get <skillId>')
  .description('Get a skill by ID')
  .action(async (skillId: string) => {
    try {
      const client = getClient();
      const result = await client.skills.get(skillId);
      print(result, getFormat(skillsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

skillsCmd
  .command('execute <skillId>')
  .description('Execute a skill')
  .requiredOption('-p, --params <json>', 'Parameters as JSON')
  .option('--session <id>', 'Use existing session')
  .action(async (skillId: string, opts) => {
    try {
      const client = getClient();
      const params = JSON.parse(opts.params);
      const result = await client.skills.execute(skillId, {
        parameters: params,
        sessionId: opts.session,
      });
      success(`Execution started: ${result.id}`);
      print(result, getFormat(skillsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

skillsCmd
  .command('run <skillId>')
  .description('Execute a skill and wait for completion')
  .requiredOption('-p, --params <json>', 'Parameters as JSON')
  .option('--timeout <ms>', 'Timeout in milliseconds', '300000')
  .action(async (skillId: string, opts) => {
    try {
      const client = getClient();
      const params = JSON.parse(opts.params);
      info('Executing skill...');
      const result = await client.skills.run(
        skillId,
        { parameters: params },
        2000,
        parseInt(opts.timeout)
      );

      if (result.status === 'completed') {
        success('Skill execution completed');
      } else {
        error(`Execution failed: ${result.error}`);
      }

      print(result, getFormat(skillsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

skillsCmd
  .command('refine <skillId>')
  .description('Refine a skill with feedback')
  .requiredOption('-f, --feedback <text>', 'Feedback for improvement')
  .action(async (skillId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.skills.refine(skillId, {
        feedback: opts.feedback,
      });
      success(`Skill refinement started`);
      print(result, getFormat(skillsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

skillsCmd
  .command('delete <skillId>')
  .description('Delete a skill')
  .action(async (skillId: string) => {
    try {
      const client = getClient();
      await client.skills.delete(skillId);
      success(`Skill deleted: ${skillId}`);
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Marketplace Commands
// ============================================
const marketplaceCmd = program
  .command('marketplace')
  .description('Skills marketplace operations');

marketplaceCmd
  .command('list')
  .description('List marketplace skills')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .option('-s, --search <query>', 'Search query')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.marketplace.list({
        limit: parseInt(opts.limit),
        search: opts.search,
      });
      print(result.data, getFormat(marketplaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

marketplaceCmd
  .command('get <skillId>')
  .description('Get a marketplace skill by ID')
  .action(async (skillId: string) => {
    try {
      const client = getClient();
      const result = await client.marketplace.get(skillId);
      print(result, getFormat(marketplaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

marketplaceCmd
  .command('clone <skillId>')
  .description('Clone a marketplace skill to your project')
  .option('-n, --name <name>', 'Custom name for cloned skill')
  .action(async (skillId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.marketplace.clone(skillId, {
        name: opts.name,
      });
      success(`Skill cloned: ${result.id}`);
      print(result, getFormat(marketplaceCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Billing Commands
// ============================================
const billingCmd = program
  .command('billing')
  .description('Billing and account information');

billingCmd
  .command('status')
  .description('Show account billing status')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.billing.getAccount();
      console.log(chalk.bold(`Account: ${result.email}`));
      info(`Plan: ${result.plan}`);
      info(`Credits: ${result.credits}`);
      print(result, getFormat(billingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

billingCmd
  .command('credits')
  .description('Show current credit balance')
  .action(async () => {
    try {
      const client = getClient();
      const credits = await client.billing.getCredits();
      console.log(chalk.bold(`Credits: ${credits}`));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// ============================================
// Quick Run Command (shortcut)
// ============================================
program
  .command('run <task>')
  .description('Run a browser automation task (shortcut)')
  .option('--timeout <ms>', 'Timeout in milliseconds', '300000')
  .option('--secrets <json>', 'Sensitive data as JSON (e.g., \'{"x_user":"email","x_pass":"password"}\')')
  .option('--no-vision', 'Disable vision to prevent LLM from seeing screenshots')
  .option('--allowed-domains <domains>', 'Comma-separated list of allowed domains')
  .action(async (task: string, opts) => {
    try {
      const client = getClient();
      info('Starting task...');

      // Parse sensitive data if provided
      let sensitiveData: Record<string, string> | undefined;
      if (opts.secrets) {
        try {
          sensitiveData = JSON.parse(opts.secrets);
          info('Sensitive data configured (values hidden from LLM)');
        } catch {
          error('Invalid JSON for --secrets option');
          process.exit(1);
        }
      }

      const created = await client.tasks.create({
        task,
        sensitive_data: sensitiveData,
        use_vision: opts.vision !== false ? undefined : false,
        allowed_domains: opts.allowedDomains?.split(',').map((d: string) => d.trim()),
      });
      info(`Task: ${created.id}`);
      if (created.liveUrl) {
        info(`Live view: ${created.liveUrl}`);
      }

      const result = await client.tasks.waitForCompletion(
        created.id,
        2000,
        parseInt(opts.timeout)
      );

      if (result.status === 'completed') {
        success('Task completed');
        if (result.output) {
          print(result.output, getFormat(program));
        }
      } else {
        error(`Task ${result.status}: ${result.error || 'Unknown error'}`);
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Parse and execute
program.parse();
