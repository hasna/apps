#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZohoSurvey } from '../api';
import {
  getToken,
  setToken,
  getPortalId,
  setPortalId,
  getDepartmentId,
  setDepartmentId,
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
  setOAuthConfig,
  saveOAuthTokens,
  clearOAuthTokens,
} from '../utils/config';
import {
  getAuthUrl,
  startCallbackServer,
  refreshAccessToken,
  getValidAccessToken,
  getRedirectUri,
  DEFAULT_SCOPES,
  isAuthenticated,
} from '../utils/auth';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';

const CONNECTOR_NAME = 'zoho-survey';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Survey API connector — surveys, responses, collectors, and invitations')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides profile)')
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
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.token) process.env.ZOHO_SURVEY_TOKEN = opts.token;
  });

function getFormat(cmd: Command): OutputFormat {
  return (cmd.parent?.opts().format || 'pretty') as OutputFormat;
}

async function getConfiguredToken(): Promise<string | undefined> {
  if (process.env.ZOHO_SURVEY_TOKEN) return process.env.ZOHO_SURVEY_TOKEN;

  const profile = loadProfile();
  if (profile.accessToken) {
    return getValidAccessToken();
  }

  return profile.token;
}

async function getClient(options: { requirePortal?: boolean } = {}): Promise<ZohoSurvey> {
  const requirePortal = options.requirePortal ?? true;
  const token = await getConfiguredToken();
  const portalId = getPortalId();
  const departmentId = getDepartmentId();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} auth login" or set ZOHO_SURVEY_TOKEN.`);
    process.exit(1);
  }
  if (requirePortal && (!portalId || !departmentId)) {
    error(`Portal and department required. Run "${CONNECTOR_NAME} config set-portal" and set-department".`);
    process.exit(1);
  }
  return new ZohoSurvey({ token, portalId, departmentId, baseUrl: getBaseUrl() });
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
  for (const p of profiles) {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  }
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts: { use?: boolean }) => {
    if (!createProfile(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    success(`Profile "${name}" created`);
    if (opts.use) setCurrentProfile(name);
  });

profileCmd.command('delete <name>').action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Token: ${config.token || config.accessToken ? 'set' : chalk.gray('not set')}`);
  info(`Portal ID: ${config.portalId || chalk.gray('not set')}`);
  info(`Department ID: ${config.departmentId || chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage connector configuration');

configCmd.command('set-token <token>').action((token: string) => {
  setToken(token);
  success('Token saved');
});

configCmd.command('set-portal <portalId>').action((portalId: string) => {
  setPortalId(portalId);
  success('Portal ID saved');
});

configCmd.command('set-department <departmentId>').action((departmentId: string) => {
  setDepartmentId(departmentId);
  success('Department ID saved');
});

configCmd.command('set-base-url <url>').action((url: string) => {
  setBaseUrl(url);
  success('Base URL saved');
});

configCmd
  .command('set-credentials')
  .requiredOption('--client-id <id>', 'OAuth client ID')
  .requiredOption('--client-secret <secret>', 'OAuth client secret')
  .action((opts: { clientId: string; clientSecret: string }) => {
    setOAuthConfig({ clientId: opts.clientId, clientSecret: opts.clientSecret });
    success('OAuth credentials saved');
  });

configCmd.command('show').action(() => {
  console.log(chalk.bold(`Active profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Token: ${getToken() ? 'set' : chalk.gray('not set')}`);
  info(`Portal ID: ${getPortalId() || chalk.gray('not set')}`);
  info(`Department ID: ${getDepartmentId() || chalk.gray('not set')}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('default')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success('Configuration cleared');
});

const authCmd = program.command('auth').description('OAuth authentication');

authCmd.command('login').action(async () => {
  try {
    const url = getAuthUrl({ scopes: DEFAULT_SCOPES });
    info(`Open this URL in your browser:\n${url}`);
    info(`Redirect URI: ${getRedirectUri()}`);
    const result = await startCallbackServer();
    if (!result.success || !result.tokens) {
      error(result.error || 'Authentication failed');
      process.exit(1);
    }
    saveOAuthTokens(result.tokens);
    success('Authenticated successfully');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

authCmd.command('refresh').action(async () => {
  try {
    await refreshAccessToken();
    success('Token refreshed');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

authCmd.command('logout').action(() => {
  clearOAuthTokens();
  success('Logged out');
});

authCmd.command('status').action(() => {
  info(isAuthenticated() ? 'Authenticated' : 'Not authenticated');
});

const portalCmd = program.command('portal').description('Portal operations');

portalCmd.command('list').action(async () => {
  try {
    const client = await getClient({ requirePortal: false });
    print(await client.listPortals(), getFormat(portalCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const surveyCmd = program.command('survey').description('Survey operations');

surveyCmd
  .command('list')
  .option('--filterby <filter>', 'Survey filter', 'published')
  .action(async (opts: { filterby: string }) => {
    try {
      const client = await getClient();
      print(await client.listSurveys({ filterby: opts.filterby }), getFormat(surveyCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

surveyCmd.command('get <surveyId>').action(async (surveyId: string) => {
  try {
    const client = await getClient();
    print(await client.getSurvey(surveyId), getFormat(surveyCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const responseCmd = program.command('response').description('Response operations');

responseCmd.command('list <surveyId>').action(async (surveyId: string) => {
  try {
    const client = await getClient();
    print(await client.listResponses(surveyId), getFormat(responseCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

responseCmd.command('get <surveyId> <responseId>').action(async (surveyId: string, responseId: string) => {
  try {
    const client = await getClient();
    print(await client.getResponse(surveyId, responseId), getFormat(responseCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const collectorCmd = program.command('collector').description('Collector operations');

collectorCmd.command('list <surveyId>').action(async (surveyId: string) => {
  try {
    const client = await getClient();
    print(await client.listCollectors(surveyId), getFormat(collectorCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const invitationCmd = program.command('invitation').description('Email invitation operations');

invitationCmd
  .command('distributions <surveyId> <collectorId>')
  .action(async (surveyId: string, collectorId: string) => {
    try {
      const client = await getClient();
      print(await client.listTriggerDistributions(surveyId, collectorId), getFormat(invitationCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

invitationCmd
  .command('send <surveyId> <collectorId> <distributionId>')
  .requiredOption('--contact <json>', 'Contact JSON object for contactsList')
  .action(async (surveyId: string, collectorId: string, distributionId: string, opts: { contact: string }) => {
    try {
      const contact = JSON.parse(opts.contact) as Record<string, string>;
      const client = await getClient();
      print(
        await client.triggerInvitation(surveyId, collectorId, distributionId, { contactsList: [contact] }),
        getFormat(invitationCmd),
      );
      success('Invitation sent');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
