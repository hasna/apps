#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoAnalytics } from '../api';
import {
  getToken,
  setToken,
  getOrgId,
  setOrgId,
  getDataCenter,
  setDataCenter,
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

const CONNECTOR_NAME = 'connect-zoho-analytics';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Analytics API connector — workspaces, views, data, and SQL queries')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
  .option('-o, --org-id <orgId>', 'Zoho Analytics organization ID')
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
    if (opts.token) process.env.ZOHO_ANALYTICS_TOKEN = opts.token;
    if (opts.orgId) process.env.ZOHO_ANALYTICS_ORG_ID = opts.orgId;
  });

function getGlobalFormat(): OutputFormat {
  return (program.opts().format || 'pretty') as OutputFormat;
}

const SENSITIVE_PROFILE_KEYS = [
  'apiKey',
  'token',
  'apiSecret',
  'accessToken',
  'refreshToken',
  'clientSecret',
] as const;

function redactProfile(profile: ReturnType<typeof loadProfile>): ReturnType<typeof loadProfile> {
  const redacted = { ...profile };
  for (const key of SENSITIVE_PROFILE_KEYS) {
    if (redacted[key]) {
      redacted[key] = '[redacted]';
    }
  }
  return redacted;
}

function getClient(): ZohoAnalytics {
  const token = getToken();
  const orgId = getOrgId();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHO_ANALYTICS_TOKEN.`);
    process.exit(1);
  }
  if (!orgId) {
    error(`No org ID configured. Run "${CONNECTOR_NAME} config set-org-id <id>" or set ZOHO_ANALYTICS_ORG_ID.`);
    process.exit(1);
  }
  return new ZohoAnalytics({ token, orgId, dataCenter: getDataCenter() });
}

const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info('No profiles found.');
    return;
  }
  success('Profiles:');
  profiles.forEach((p) => {
    const isActive = p === current ? chalk.green(' (active)') : '';
    console.log(`  ${p}${isActive}`);
  });
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist.`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').option('--token <token>', 'OAuth token').option('--org-id <orgId>', 'Org ID').action((name: string, opts) => {
  if (profileExists(name)) {
    error(`Profile "${name}" already exists`);
    process.exit(1);
  }
  createProfile(name, { token: opts.token, orgId: opts.orgId });
  success(`Profile "${name}" created`);
});

profileCmd.command('delete <name>').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profile = loadProfile(name);
  print(redactProfile(profile), 'pretty');
});

const configCmd = program.command('config').description('Manage connector configuration');

configCmd.command('set-token <token>').action((token: string) => {
  setToken(token);
  success('Token saved to active profile');
});

configCmd.command('set-org-id <orgId>').action((orgId: string) => {
  setOrgId(orgId);
  success('Organization ID saved to active profile');
});

configCmd.command('set-data-center <dc>').action((dc: string) => {
  setDataCenter(dc);
  success(`Data center set to: ${dc}`);
});

configCmd.command('show').action(() => {
  info(`Config directory: ${getConfigDir()}`);
  info(`Active profile: ${getCurrentProfile()}`);
  const token = getToken();
  const orgId = getOrgId();
  console.log(`  token: ${token ? '***' + token.slice(-4) : chalk.red('not set')}`);
  console.log(`  orgId: ${orgId ?? chalk.red('not set')}`);
  console.log(`  dataCenter: ${getDataCenter() ?? 'com (default)'}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success('Configuration cleared');
});

program
  .command('list-workspaces')
  .description('List all workspaces')
  .action(async () => {
    const result = await getClient().listWorkspaces();
    print(result, getGlobalFormat());
  });

program
  .command('get-workspace <workspaceId>')
  .description('Get workspace details')
  .action(async (workspaceId: string) => {
    const result = await getClient().getWorkspaceDetails(workspaceId);
    print(result, getGlobalFormat());
  });

program
  .command('create-workspace <name>')
  .description('Create a workspace')
  .option('-d, --description <desc>', 'Workspace description')
  .action(async (name: string, opts) => {
    const result = await getClient().createWorkspace({ workspaceName: name, workspaceDescription: opts.description });
    print(result, getGlobalFormat());
  });

program
  .command('list-views <workspaceId>')
  .description('List views in a workspace')
  .action(async (workspaceId: string) => {
    const result = await getClient().listViews(workspaceId);
    print(result, getGlobalFormat());
  });

program
  .command('run-query <workspaceId> <sql>')
  .description('Run a SQL query against a workspace')
  .option('-f, --response-format <format>', 'Response format (json, csv, xls, xlsx)', 'json')
  .action(async (workspaceId: string, sql: string, opts) => {
    const result = await getClient().runQuery(workspaceId, sql, { responseFormat: opts.responseFormat });
    print(result, getGlobalFormat());
  });

program
  .command('get-org')
  .description('Get organization details')
  .action(async () => {
    const result = await getClient().getOrgDetails();
    print(result, getGlobalFormat());
  });

program
  .command('list-users')
  .description('List organization users')
  .action(async () => {
    const result = await getClient().listUsers();
    print(result, getGlobalFormat());
  });

program.parse();
