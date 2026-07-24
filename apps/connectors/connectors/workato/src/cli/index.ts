#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { WorkatoConnector } from '../api';
import {
  getApiToken,
  setApiToken,
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

const CONNECTOR_NAME = 'connect-workato';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Workato automation platform API CLI')
  .version(VERSION)
  .option('-k, --api-token <token>', 'API token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
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
    }

    if (opts.apiToken) {
      process.env.WORKATO_API_TOKEN = opts.apiToken;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): WorkatoConnector {
  const apiToken = getApiToken();
  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set WORKATO_API_TOKEN.`);
    process.exit(1);
  }
  return new WorkatoConnector({ apiToken, baseUrl: getBaseUrl() });
}

function parseIntOpt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

function parseBoolOpt(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 'true' || value === '1';
}

function parseJsonOpt(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

async function runAction(cmd: Command, action: () => Promise<unknown>): Promise<void> {
  try {
    const result = await action();
    print(result, getFormat(cmd));
  } catch (e) {
    error((e as Error).message);
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach(p => {
    const marker = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${marker}`);
  });
});

profileCmd
  .command('use <name>')
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile "${name}"`);
  });

profileCmd
  .command('create <name>')
  .action((name: string) => {
    if (!createProfile(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    success(`Profile "${name}" created`);
  });

profileCmd
  .command('delete <name>')
  .action((name: string) => {
    if (!deleteProfile(name)) {
      error(`Could not delete profile "${name}"`);
      process.exit(1);
    }
    success(`Profile "${name}" deleted`);
  });

// Config commands
const configCmd = program.command('config').description('Configuration commands');

configCmd
  .command('set-token <token>')
  .description('Set API token for current profile')
  .action((token: string) => {
    setApiToken(token);
    success(`API token saved to profile "${getCurrentProfile()}"`);
  });

configCmd
  .command('set-base-url <url>')
  .description('Set API base URL (HTTPS only)')
  .action((url: string) => {
    try {
      setBaseUrl(url);
      success(`Base URL saved to profile "${getCurrentProfile()}"`);
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });

configCmd
  .command('show')
  .action(() => {
    const profile = loadProfile();
    const token = getApiToken();
    print({
      profile: getCurrentProfile(),
      configDir: getConfigDir(),
      apiToken: token ? `${token.substring(0, 6)}...` : 'Not set',
      baseUrl: getBaseUrl() || 'https://www.workato.com/api (default)',
    });
  });

configCmd.command('clear').action(() => {
  clearConfig();
  success('Configuration cleared');
});

// Recipes
const recipesCmd = program.command('recipes').description('Recipe operations');

recipesCmd
  .command('list')
  .option('--folder-id <id>')
  .option('--running <bool>')
  .option('--per-page <n>')
  .option('--page <n>')
  .option('--updated-after <iso>')
  .option('--order <order>')
  .action(async function (this: Command, opts) {
    await runAction(this, () =>
      getClient().recipes.list({
        folderId: parseIntOpt(opts.folderId, 'folder-id'),
        running: parseBoolOpt(opts.running),
        perPage: parseIntOpt(opts.perPage, 'per-page'),
        page: parseIntOpt(opts.page, 'page'),
        updatedAfter: opts.updatedAfter,
        order: opts.order,
      }),
    );
  });

recipesCmd
  .command('get <id>')
  .action(async function (this: Command, id: string) {
    await runAction(this, () => getClient().recipes.get(Number.parseInt(id, 10)));
  });

recipesCmd
  .command('start <id>')
  .action(async function (this: Command, id: string) {
    await runAction(this, () => getClient().recipes.start(Number.parseInt(id, 10)));
  });

recipesCmd
  .command('stop <id>')
  .action(async function (this: Command, id: string) {
    await runAction(this, () => getClient().recipes.stop(Number.parseInt(id, 10)));
  });

// Jobs
const jobsCmd = program.command('jobs').description('Job operations');

jobsCmd
  .command('list <recipeId>')
  .option('--status <status>')
  .option('--per-page <n>')
  .option('--offset <n>')
  .option('--from-timestamp <iso>')
  .option('--to-timestamp <iso>')
  .action(async function (this: Command, recipeId: string, opts) {
    await runAction(this, () =>
      getClient().jobs.list({
        recipeId: Number.parseInt(recipeId, 10),
        status: opts.status,
        perPage: parseIntOpt(opts.perPage, 'per-page'),
        offset: parseIntOpt(opts.offset, 'offset'),
        fromTimestamp: opts.fromTimestamp,
        toTimestamp: opts.toTimestamp,
      }),
    );
  });

jobsCmd
  .command('get <recipeId> <jobId>')
  .action(async function (this: Command, recipeId: string, jobId: string) {
    await runAction(this, () => getClient().jobs.get(Number.parseInt(recipeId, 10), jobId));
  });

// Connections
const connectionsCmd = program.command('connections').description('Connection operations');

connectionsCmd
  .command('list')
  .option('--provider <provider>')
  .option('--folder-id <id>')
  .option('--per-page <n>')
  .option('--page <n>')
  .action(async function (this: Command, opts) {
    await runAction(this, () =>
      getClient().connections.list({
        provider: opts.provider,
        folderId: parseIntOpt(opts.folderId, 'folder-id'),
        perPage: parseIntOpt(opts.perPage, 'per-page'),
        page: parseIntOpt(opts.page, 'page'),
      }),
    );
  });

connectionsCmd
  .command('get <id>')
  .action(async function (this: Command, id: string) {
    await runAction(this, () => getClient().connections.get(Number.parseInt(id, 10)));
  });

connectionsCmd
  .command('create')
  .requiredOption('--name <name>')
  .requiredOption('--provider <provider>')
  .option('--folder-id <id>')
  .option('--input <json>')
  .action(async function (this: Command, opts) {
    await runAction(this, () =>
      getClient().connections.create({
        name: opts.name,
        provider: opts.provider,
        folderId: parseIntOpt(opts.folderId, 'folder-id'),
        input: parseJsonOpt(opts.input, 'input'),
      }),
    );
  });

connectionsCmd
  .command('update <id>')
  .option('--name <name>')
  .option('--input <json>')
  .action(async function (this: Command, id: string, opts) {
    await runAction(this, () =>
      getClient().connections.update({
        id: Number.parseInt(id, 10),
        name: opts.name,
        input: parseJsonOpt(opts.input, 'input'),
      }),
    );
  });

connectionsCmd
  .command('delete <id>')
  .action(async function (this: Command, id: string) {
    await runAction(this, () => getClient().connections.delete(Number.parseInt(id, 10)));
  });

// Folders
const foldersCmd = program.command('folders').description('Folder operations');

foldersCmd
  .command('list')
  .option('--parent-id <id>')
  .option('--per-page <n>')
  .option('--page <n>')
  .action(async function (this: Command, opts) {
    await runAction(this, () =>
      getClient().folders.list({
        parentId: parseIntOpt(opts.parentId, 'parent-id'),
        perPage: parseIntOpt(opts.perPage, 'per-page'),
        page: parseIntOpt(opts.page, 'page'),
      }),
    );
  });

foldersCmd
  .command('create')
  .requiredOption('--name <name>')
  .option('--parent-id <id>')
  .action(async function (this: Command, opts) {
    await runAction(this, () =>
      getClient().folders.create({
        name: opts.name,
        parentId: parseIntOpt(opts.parentId, 'parent-id'),
      }),
    );
  });

foldersCmd
  .command('update <id>')
  .option('--name <name>')
  .option('--parent-id <id>')
  .action(async function (this: Command, id: string, opts) {
    await runAction(this, () =>
      getClient().folders.update({
        id: Number.parseInt(id, 10),
        name: opts.name,
        parentId: parseIntOpt(opts.parentId, 'parent-id'),
      }),
    );
  });

foldersCmd
  .command('delete <id>')
  .action(async function (this: Command, id: string) {
    await runAction(this, () => getClient().folders.delete(Number.parseInt(id, 10)));
  });

// Projects
const projectsCmd = program.command('projects').description('Project operations');

projectsCmd
  .command('list')
  .option('--per-page <n>')
  .option('--page <n>')
  .action(async function (this: Command, opts) {
    await runAction(this, () =>
      getClient().projects.list({
        perPage: parseIntOpt(opts.perPage, 'per-page'),
        page: parseIntOpt(opts.page, 'page'),
      }),
    );
  });

projectsCmd
  .command('get <id>')
  .action(async function (this: Command, id: string) {
    await runAction(this, () => getClient().projects.get(Number.parseInt(id, 10)));
  });

projectsCmd
  .command('export <projectId>')
  .option('--include-data', 'Include data in export')
  .action(async function (this: Command, projectId: string, opts) {
    await runAction(this, () =>
      getClient().projects.export({
        projectId: Number.parseInt(projectId, 10),
        includeData: Boolean(opts.includeData),
      }),
    );
  });

// Lookup tables
const lookupCmd = program.command('lookup-tables').description('Lookup table operations');

lookupCmd
  .command('list')
  .option('--per-page <n>')
  .option('--page <n>')
  .action(async function (this: Command, opts) {
    await runAction(this, () =>
      getClient().lookupTables.list({
        perPage: parseIntOpt(opts.perPage, 'per-page'),
        page: parseIntOpt(opts.page, 'page'),
      }),
    );
  });

lookupCmd
  .command('get <id>')
  .action(async function (this: Command, id: string) {
    await runAction(this, () => getClient().lookupTables.get(Number.parseInt(id, 10)));
  });

lookupCmd
  .command('lookup-row <tableId>')
  .requiredOption('--column <column>')
  .requiredOption('--value <value>')
  .action(async function (this: Command, tableId: string, opts) {
    await runAction(this, () =>
      getClient().lookupTables.lookupRow({
        tableId: Number.parseInt(tableId, 10),
        column: opts.column,
        value: opts.value,
      }),
    );
  });

lookupCmd
  .command('create-row <tableId>')
  .requiredOption('--data <json>')
  .action(async function (this: Command, tableId: string, opts) {
    const data = parseJsonOpt(opts.data, 'data');
    if (!data) throw new Error('data is required');
    await runAction(this, () =>
      getClient().lookupTables.createRow({
        tableId: Number.parseInt(tableId, 10),
        data,
      }),
    );
  });

lookupCmd
  .command('update-row <tableId> <rowId>')
  .requiredOption('--data <json>')
  .action(async function (this: Command, tableId: string, rowId: string, opts) {
    const data = parseJsonOpt(opts.data, 'data');
    if (!data) throw new Error('data is required');
    await runAction(this, () =>
      getClient().lookupTables.updateRow({
        tableId: Number.parseInt(tableId, 10),
        rowId: Number.parseInt(rowId, 10),
        data,
      }),
    );
  });

lookupCmd
  .command('delete-row <tableId> <rowId>')
  .action(async function (this: Command, tableId: string, rowId: string) {
    await runAction(this, () =>
      getClient().lookupTables.deleteRow(
        Number.parseInt(tableId, 10),
        Number.parseInt(rowId, 10),
      ),
    );
  });

// Properties
const propertiesCmd = program.command('properties').description('Property operations');

propertiesCmd
  .command('list')
  .option('--per-page <n>')
  .option('--page <n>')
  .action(async function (this: Command, opts) {
    await runAction(this, () =>
      getClient().properties.list({
        perPage: parseIntOpt(opts.perPage, 'per-page'),
        page: parseIntOpt(opts.page, 'page'),
      }),
    );
  });

propertiesCmd
  .command('upsert')
  .requiredOption('--name <name>')
  .requiredOption('--value <value>')
  .action(async function (this: Command, opts) {
    await runAction(this, () =>
      getClient().properties.upsert({
        name: opts.name,
        value: opts.value,
      }),
    );
  });

// Users
const usersCmd = program.command('users').description('User operations');

usersCmd
  .command('list')
  .option('--per-page <n>')
  .option('--page <n>')
  .action(async function (this: Command, opts) {
    await runAction(this, () =>
      getClient().users.list({
        perPage: parseIntOpt(opts.perPage, 'per-page'),
        page: parseIntOpt(opts.page, 'page'),
      }),
    );
  });

program.parse();
