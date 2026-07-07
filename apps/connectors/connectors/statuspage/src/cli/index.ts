#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Statuspage } from '../api';
import {
  getApiKey,
  setApiKey,
  getPageId,
  setPageId,
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

const CONNECTOR_NAME = 'connect-statuspage';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Statuspage connector - Manage status pages, incidents, and components')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('--page-id <id>', 'Default page ID for page-scoped commands')
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
      process.env.STATUSPAGE_API_KEY = opts.apiKey;
    }
    if (opts.pageId) {
      process.env.STATUSPAGE_PAGE_ID = opts.pageId;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Statuspage {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-api-key <key>" or set STATUSPAGE_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Statuspage({ apiKey, pageId: getPageId() });
}

function resolvePageId(explicit?: string): string {
  const pageId = explicit || getPageId();
  if (!pageId) {
    error(`Page ID required. Pass <page_id>, use --page-id, or run "${CONNECTOR_NAME} config set-page-id <id>".`);
    process.exit(1);
  }
  return pageId;
}

// Profile commands
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
  .option('--page-id <id>', 'Default page ID')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { apiKey?: string; pageId?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey, pageId: opts.pageId });
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
    info(`Page ID: ${config.pageId || chalk.gray('not set')}`);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-api-key <apiKey>')
  .description('Set API key')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('set-page-id <pageId>')
  .description('Set default page ID')
  .action((pageId: string) => {
    setPageId(pageId);
    success(`Page ID saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    const pageId = getPageId();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
    info(`Page ID: ${pageId || chalk.gray('not set')}`);
  });

configCmd
  .command('clear')
  .description('Clear configuration for active profile')
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Validate
program
  .command('validate [page_id]')
  .description('Validate API credentials against a page')
  .action(async (pageIdArg?: string) => {
    try {
      const client = getClient();
      const pageId = resolvePageId(pageIdArg);
      const result = await client.validate(pageId);
      if (result.valid) {
        success(`API credentials are valid for page: ${result.page?.name || pageId}`);
      } else {
        error('API credentials are invalid');
        process.exit(1);
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Pages
const pagesCmd = program.command('pages').description('Manage status pages');

pagesCmd
  .command('list')
  .description('List all pages')
  .action(async function (this: Command) {
    try {
      const client = getClient();
      const result = await client.listPages();
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

pagesCmd
  .command('get <page_id>')
  .description('Get a page by ID')
  .action(async function (this: Command, pageId: string) {
    try {
      const client = getClient();
      const result = await client.getPage(pageId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Incidents
const incidentsCmd = program.command('incidents').description('Manage incidents');

incidentsCmd
  .command('list [page_id]')
  .description('List incidents for a page')
  .option('-q, --query <text>', 'Search query')
  .option('-n, --limit <number>', 'Maximum results per page', '100')
  .option('--page-num <number>', 'Page offset', '1')
  .action(async function (this: Command, pageIdArg: string | undefined, opts: { query?: string; limit: string; pageNum: string }) {
    try {
      const client = getClient();
      const pageId = resolvePageId(pageIdArg);
      const result = await client.listIncidents(pageId, {
        q: opts.query,
        limit: parseInt(opts.limit, 10),
        page: parseInt(opts.pageNum, 10),
      });
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

incidentsCmd
  .command('get <page_id> <incident_id>')
  .description('Get an incident')
  .action(async function (this: Command, pageId: string, incidentId: string) {
    try {
      const client = getClient();
      const result = await client.getIncident(pageId, incidentId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

incidentsCmd
  .command('create [page_id]')
  .description('Create an incident')
  .requiredOption('-n, --name <name>', 'Incident name')
  .option('-s, --status <status>', 'Incident status', 'investigating')
  .option('-b, --body <body>', 'Incident update body')
  .option('-i, --impact <impact>', 'Impact override (none, minor, major, critical)')
  .option('--component <id>', 'Component ID (repeatable)', (value: string, prev: string[]) => [...prev, value], [] as string[])
  .action(async function (
    this: Command,
    pageIdArg: string | undefined,
    opts: { name: string; status: string; body?: string; impact?: string; component: string[] },
  ) {
    try {
      const client = getClient();
      const pageId = resolvePageId(pageIdArg);
      const result = await client.createIncident(pageId, {
        name: opts.name,
        status: opts.status as import('../types').IncidentStatus,
        body: opts.body,
        impact_override: opts.impact as import('../types').IncidentImpact | 'none' | undefined,
        component_ids: opts.component.length > 0 ? opts.component : undefined,
      });
      success('Incident created');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

incidentsCmd
  .command('update <page_id> <incident_id>')
  .description('Update an incident')
  .option('-n, --name <name>', 'Incident name')
  .option('-s, --status <status>', 'Incident status')
  .option('-b, --body <body>', 'Incident update body')
  .option('-i, --impact <impact>', 'Impact override')
  .action(async function (
    this: Command,
    pageId: string,
    incidentId: string,
    opts: { name?: string; status?: string; body?: string; impact?: string },
  ) {
    try {
      const client = getClient();
      const result = await client.updateIncident(pageId, incidentId, {
        name: opts.name,
        status: opts.status as import('../types').IncidentStatus | undefined,
        body: opts.body,
        impact_override: opts.impact as import('../types').IncidentImpact | 'none' | undefined,
      });
      success('Incident updated');
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Components
const componentsCmd = program.command('components').description('Manage page components');

componentsCmd
  .command('list [page_id]')
  .description('List components for a page')
  .action(async function (this: Command, pageIdArg?: string) {
    try {
      const client = getClient();
      const pageId = resolvePageId(pageIdArg);
      const result = await client.listComponents(pageId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

componentsCmd
  .command('get <page_id> <component_id>')
  .description('Get a component')
  .action(async function (this: Command, pageId: string, componentId: string) {
    try {
      const client = getClient();
      const result = await client.getComponent(pageId, componentId);
      print(result, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
