#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { TestRail } from '../api';
import {
  getEmail,
  setEmail,
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-testrail';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('TestRail connector CLI - Test cases, runs, and results')
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

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): TestRail {
  const email = getEmail();
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();

  if (!email || !apiKey || !baseUrl) {
    error(`Configuration incomplete. Run "${CONNECTOR_NAME} config setup" or set TESTRAIL_EMAIL, TESTRAIL_API_KEY, TESTRAIL_BASE_URL.`);
    process.exit(1);
  }
  return new TestRail({ email, apiKey, baseUrl });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').description('List all profiles').action(() => {
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

profileCmd.command('use <name>').description('Switch to a profile').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--email <email>', 'TestRail email')
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'Instance base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      email: opts.email,
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
    });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command('delete <name>').description('Delete a profile').action((name: string) => {
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

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Email: ${config.email || chalk.gray('not set')}`);
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('setup')
  .description('Configure TestRail credentials')
  .requiredOption('--email <email>', 'TestRail email')
  .requiredOption('--api-key <key>', 'API key')
  .requiredOption('--base-url <url>', 'Instance base URL (e.g. https://yourcompany.testrail.io)')
  .action((opts) => {
    setEmail(opts.email);
    setApiKey(opts.apiKey);
    setBaseUrl(opts.baseUrl);
    success(`Configuration saved to profile: ${getCurrentProfile()}`);
  });

configCmd.command('set-email <email>').description('Set TestRail email').action((email: string) => {
  setEmail(email);
  success(`Email saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-api-key <key>').description('Set API key').action((key: string) => {
  setApiKey(key);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-base-url <url>').description('Set instance base URL').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const email = getEmail();
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Email: ${email || chalk.gray('not set')}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${baseUrl || chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const projectCmd = program.command('project').description('Project operations');

projectCmd.command('list').description('List projects').action(async () => {
  try {
    const client = getClient();
    const result = await client.listProjects();
    print(result, getFormat(projectCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

projectCmd.command('get <projectId>').description('Get a project by ID').action(async (projectId: string) => {
  try {
    const client = getClient();
    const result = await client.getProject(parseInt(projectId, 10));
    print(result, getFormat(projectCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const caseCmd = program.command('case').description('Test case operations');

caseCmd
  .command('list <projectId>')
  .description('List test cases in a project')
  .option('--suite-id <id>', 'Filter by suite ID')
  .option('--section-id <id>', 'Filter by section ID')
  .option('--limit <n>', 'Limit results', '250')
  .option('--offset <n>', 'Offset for pagination', '0')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listCases(parseInt(projectId, 10), {
        suite_id: opts.suiteId ? parseInt(opts.suiteId, 10) : undefined,
        section_id: opts.sectionId ? parseInt(opts.sectionId, 10) : undefined,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      });
      print(result, getFormat(caseCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

caseCmd.command('get <caseId>').description('Get a test case by ID').action(async (caseId: string) => {
  try {
    const client = getClient();
    const result = await client.getCase(parseInt(caseId, 10));
    print(result, getFormat(caseCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

caseCmd
  .command('create <projectId>')
  .description('Create a test case')
  .requiredOption('-t, --title <title>', 'Case title')
  .requiredOption('-s, --section-id <id>', 'Section ID')
  .option('--type-id <id>', 'Case type ID')
  .option('--priority-id <id>', 'Priority ID')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createCase(parseInt(projectId, 10), {
        title: opts.title,
        section_id: parseInt(opts.sectionId, 10),
        type_id: opts.typeId ? parseInt(opts.typeId, 10) : undefined,
        priority_id: opts.priorityId ? parseInt(opts.priorityId, 10) : undefined,
      });
      success(`Case created: ${result.id}`);
      print(result, getFormat(caseCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

caseCmd
  .command('update <caseId>')
  .description('Update a test case')
  .option('-t, --title <title>', 'Case title')
  .option('-s, --section-id <id>', 'Section ID')
  .action(async (caseId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.updateCase(parseInt(caseId, 10), {
        title: opts.title,
        section_id: opts.sectionId ? parseInt(opts.sectionId, 10) : undefined,
      });
      success(`Case ${caseId} updated`);
      print(result, getFormat(caseCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const runCmd = program.command('run').description('Test run operations');

runCmd
  .command('list <projectId>')
  .description('List test runs in a project')
  .option('--suite-id <id>', 'Filter by suite ID')
  .option('--completed', 'Only completed runs')
  .option('--limit <n>', 'Limit results', '250')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listRuns(parseInt(projectId, 10), {
        suite_id: opts.suiteId ? parseInt(opts.suiteId, 10) : undefined,
        is_completed: opts.completed ? 1 : undefined,
        limit: parseInt(opts.limit, 10),
      });
      print(result, getFormat(runCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

runCmd.command('get <runId>').description('Get a test run by ID').action(async (runId: string) => {
  try {
    const client = getClient();
    const result = await client.getRun(parseInt(runId, 10));
    print(result, getFormat(runCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

runCmd
  .command('create <projectId>')
  .description('Create a test run')
  .requiredOption('-n, --name <name>', 'Run name')
  .option('-d, --description <text>', 'Run description')
  .option('--suite-id <id>', 'Suite ID')
  .option('--include-all', 'Include all cases in suite')
  .action(async (projectId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.createRun(parseInt(projectId, 10), {
        name: opts.name,
        description: opts.description,
        suite_id: opts.suiteId ? parseInt(opts.suiteId, 10) : undefined,
        include_all: opts.includeAll || undefined,
      });
      success(`Run created: ${result.id}`);
      print(result, getFormat(runCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

runCmd
  .command('results <runId>')
  .description('List results for a run')
  .option('--limit <n>', 'Limit results', '250')
  .action(async (runId: string, opts) => {
    try {
      const client = getClient();
      const result = await client.listResultsForRun(parseInt(runId, 10), {
        limit: parseInt(opts.limit, 10),
      });
      print(result, getFormat(runCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
