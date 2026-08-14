#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { YouArt } from '../api';
import {
  getApiKey,
  getBaseUrl,
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
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';

const CONNECTOR_NAME = 'youart';
const VERSION = '0.1.0';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('YouArt API connector — AI originals, funding, and creator economy')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
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
    if (opts.apiKey) {
      process.env.YOUART_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const source = cmd.parent ?? cmd;
  return (source.opts().format || 'pretty') as OutputFormat;
}

function getClient(): YouArt {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set YOUART_API_KEY.`);
    process.exit(1);
  }
  const baseUrl = getBaseUrl();
  return new YouArt({ apiKey, baseUrl });
}

function parseQueryPairs(pairs: string[] | undefined): Record<string, string> {
  const query: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    query[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return query;
}

function parseJsonBody(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('JSON body must be an object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
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
  for (const p of profiles) {
    const active = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${active}`);
  }
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
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
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
  info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${config.baseUrl || chalk.gray('default')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const projectsCmd = program.command('projects').description('Manage YouArt projects');

projectsCmd
  .command('list')
  .description('List projects')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts: { query?: string[] }) => {
    try {
      const result = await getClient().listProjects(parseQueryPairs(opts.query));
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

projectsCmd.command('get <projectId>').description('Get a project by ID').action(async (projectId: string) => {
  try {
    const result = await getClient().getProject(projectId);
    print(result, getFormat(projectsCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

projectsCmd
  .command('create')
  .description('Create a project')
  .option('-t, --title <title>', 'Project title')
  .option('-g, --genre <genre>', 'Project genre')
  .option('--body <json>', 'Full JSON request body')
  .action(async (opts: { title?: string; genre?: string; body?: string }) => {
    try {
      const payload = opts.body ? parseJsonBody(opts.body) : { title: opts.title, genre: opts.genre };
      const result = await getClient().createProject(payload);
      success('Project created');
      print(result, getFormat(projectsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const originalsCmd = program.command('originals').description('Manage YouArt originals');

originalsCmd
  .command('list')
  .description('List originals')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts: { query?: string[] }) => {
    try {
      const result = await getClient().listOriginals(parseQueryPairs(opts.query));
      print(result, getFormat(originalsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

originalsCmd
  .command('publish <originalId>')
  .description('Publish an original')
  .option('--visibility <visibility>', 'Visibility level')
  .option('--body <json>', 'Full JSON request body')
  .action(async (originalId: string, opts: { visibility?: string; body?: string }) => {
    try {
      const payload = opts.body ? parseJsonBody(opts.body) : { visibility: opts.visibility };
      const result = await getClient().publishOriginal(originalId, payload);
      success('Original published');
      print(result, getFormat(originalsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const membershipCmd = program.command('membership-tiers').description('Membership tiers');

membershipCmd
  .command('list')
  .description('List membership tiers')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts: { query?: string[] }) => {
    try {
      const result = await getClient().listMembershipTiers(parseQueryPairs(opts.query));
      print(result, getFormat(membershipCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const fundingCmd = program.command('funding-campaigns').description('Funding campaigns');

fundingCmd
  .command('create')
  .description('Create a funding campaign')
  .option('--project-id <projectId>', 'Project ID')
  .option('--goal-cents <amount>', 'Funding goal in cents')
  .option('--body <json>', 'Full JSON request body')
  .action(async (opts: { projectId?: string; goalCents?: string; body?: string }) => {
    try {
      const payload = opts.body
        ? parseJsonBody(opts.body)
        : {
            projectId: opts.projectId,
            goal_cents: opts.goalCents ? Number(opts.goalCents) : undefined,
          };
      const result = await getClient().createFundingCampaign(payload);
      success('Funding campaign created');
      print(result, getFormat(fundingCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const backersCmd = program.command('backers').description('Campaign backers');

backersCmd
  .command('list')
  .description('List backers')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .action(async (opts: { query?: string[] }) => {
    try {
      const result = await getClient().listBackers(parseQueryPairs(opts.query));
      print(result, getFormat(backersCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('raw-request')
  .description('Send a raw API request')
  .requiredOption('--path <path>', 'Request path (e.g. /projects)')
  .option('-m, --method <method>', 'HTTP method', 'GET')
  .option('-q, --query <pair...>', 'Query parameters as key=value')
  .option('--body <json>', 'JSON request body')
  .action(async (opts: { path: string; method: string; query?: string[]; body?: string }) => {
    try {
      const result = await getClient().rawRequest({
        path: opts.path,
        method: opts.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        query: parseQueryPairs(opts.query),
        body: opts.body ? parseJsonBody(opts.body) : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
