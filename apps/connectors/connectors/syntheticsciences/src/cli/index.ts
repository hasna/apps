#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { SyntheticSciences } from '../api';
import type { HttpMethod } from '../api/client';
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'connect-syntheticsciences';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Synthetic Sciences connector - AI co-scientist for research projects, literature, experiments, and GPU jobs')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-u, --base-url <url>', 'API base URL (overrides config)')
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
    if (opts.apiKey) {
      process.env.SYNTHETICSCIENCES_API_KEY = opts.apiKey;
    }
    if (opts.baseUrl) {
      process.env.SYNTHETICSCIENCES_BASE_URL = opts.baseUrl;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let parent: Command | null = cmd;
  while (parent) {
    const fmt = parent.opts().format;
    if (fmt) return fmt as OutputFormat;
    parent = parent.parent;
  }
  return 'pretty';
}

function getClient(): SyntheticSciences {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set SYNTHETICSCIENCES_API_KEY environment variable.`);
    process.exit(1);
  }
  return new SyntheticSciences({ apiKey, baseUrl: getBaseUrl() });
}

function parseJsonArg(value: string | undefined, label: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('must be a JSON object');
  } catch (err) {
    error(`Invalid ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

async function run(cmd: Command, fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
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
  .option('--api-key <key>', 'API key')
  .option('--base-url <url>', 'API base URL')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, baseUrl: opts.baseUrl });
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
    info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
  });

// ============================================
// Config Commands
// ============================================
const configCmd = program.command('config').description('Manage CLI configuration (for active profile)');

configCmd
  .command('set-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// ============================================
// Projects Commands
// ============================================
const projectsCmd = program.command('projects').description('Research project commands');

projectsCmd
  .command('list')
  .description('List projects')
  .option('-l, --limit <n>', 'Max results')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .action((opts, cmd) =>
    run(cmd, () =>
      getClient().research.listProjects({
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      })
    )
  );

projectsCmd
  .command('get <id>')
  .description('Get a project by id')
  .action((id: string, _opts, cmd) => run(cmd, () => getClient().research.getProject(id)));

projectsCmd
  .command('create <name>')
  .description('Create a project')
  .option('-d, --description <text>', 'Project description')
  .option('--data <json>', 'Additional fields as JSON object')
  .action((name: string, opts, cmd) =>
    run(cmd, () =>
      getClient().research.createProject({
        name,
        description: opts.description,
        ...parseJsonArg(opts.data, '--data JSON'),
      })
    )
  );

// ============================================
// Literature Commands
// ============================================
program
  .command('literature <query>')
  .description('Search scientific literature')
  .option('-l, --limit <n>', 'Max results')
  .action((query: string, opts, cmd) =>
    run(cmd, () =>
      getClient().research.searchLiterature({
        query,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      })
    )
  );

// ============================================
// Experiments Commands
// ============================================
const experimentsCmd = program.command('experiments').description('Experiment commands');

experimentsCmd
  .command('list')
  .description('List experiments')
  .option('--project <id>', 'Filter by project id')
  .option('-l, --limit <n>', 'Max results')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .action((opts, cmd) =>
    run(cmd, () =>
      getClient().research.listExperiments({
        project_id: opts.project,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      })
    )
  );

experimentsCmd
  .command('create')
  .description('Create an experiment')
  .requiredOption('--project <id>', 'Project id')
  .requiredOption('--hypothesis <text>', 'Hypothesis to test')
  .option('--data <json>', 'Additional fields as JSON object')
  .action((opts, cmd) =>
    run(cmd, () =>
      getClient().research.createExperiment({
        project_id: opts.project,
        hypothesis: opts.hypothesis,
        ...parseJsonArg(opts.data, '--data JSON'),
      })
    )
  );

// ============================================
// GPU Job Commands
// ============================================
const gpuCmd = program.command('gpu-jobs').description('GPU job commands');

gpuCmd
  .command('dispatch')
  .description('Dispatch a GPU job')
  .option('--experiment <id>', 'Experiment id')
  .option('--command <cmd>', 'Command to run')
  .option('--data <json>', 'Additional fields as JSON object')
  .action((opts, cmd) =>
    run(cmd, () =>
      getClient().research.dispatchGpuJob({
        experiment_id: opts.experiment,
        command: opts.command,
        ...parseJsonArg(opts.data, '--data JSON'),
      })
    )
  );

gpuCmd
  .command('get <id>')
  .description('Get a GPU job by id')
  .action((id: string, _opts, cmd) => run(cmd, () => getClient().research.getGpuJob(id)));

// ============================================
// Drafts Commands
// ============================================
program
  .command('drafts')
  .description('List research drafts')
  .option('--project <id>', 'Filter by project id')
  .option('-l, --limit <n>', 'Max results')
  .option('-c, --cursor <cursor>', 'Pagination cursor')
  .action((opts, cmd) =>
    run(cmd, () =>
      getClient().research.listDrafts({
        project_id: opts.project,
        limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
        cursor: opts.cursor,
      })
    )
  );

// ============================================
// Raw request escape hatch
// ============================================
program
  .command('raw <method> <path>')
  .description('Make a raw API request (e.g. raw GET /projects)')
  .option('--body <json>', 'Request body as JSON')
  .action((method: string, path: string, opts, cmd) =>
    run(cmd, () => {
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      return getClient().research.raw(method.toUpperCase() as HttpMethod, path, body);
    })
  );

program.parse();
