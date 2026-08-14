#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { randomUUID } from 'crypto';
import { ZohoVault } from '../api';
import {
  getToken,
  setToken,
  getDataCenter,
  setDataCenter,
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
  getValidAccessToken,
  isAuthenticated,
  getRedirectUri,
} from '../utils/auth';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print, setVerboseMode, debug } from '../utils/output';
import type { ZohoVaultSharePermission } from '../types';

const CONNECTOR_NAME = 'connect-zohovault';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Zoho Vault API connector CLI')
  .version(VERSION)
  .option('-t, --token <token>', 'OAuth access token (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) setVerboseMode(true);
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist.`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.token) process.env.ZOHOVAULT_TOKEN = opts.token;
  });

function getFormat(cmd: Command): OutputFormat {
  let current: Command = cmd;
  while (current.parent) {
    current = current.parent;
  }
  return (current.opts().format || 'pretty') as OutputFormat;
}

function getClient(): ZohoVault {
  const token = getToken();
  if (!token) {
    error(`No token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set ZOHOVAULT_TOKEN.`);
    process.exit(1);
  }
  return new ZohoVault({ token, dataCenter: getDataCenter(), baseUrl: getBaseUrl() });
}

async function run(cmd: Command, fn: (client: ZohoVault) => Promise<unknown>): Promise<void> {
  try {
    const result = await fn(getClient());
    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command('profile').description('Manage configuration profiles');

profileCmd.command('list').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) return info('No profiles found.');
  success('Profiles:');
  for (const p of profiles) {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  }
});

profileCmd.command('use <name>').action((name: string) => {
  if (!profileExists(name)) { error(`Profile "${name}" not found.`); process.exit(1); }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').option('--token <token>', 'OAuth token').option('--use', 'Activate').action((name: string, opts) => {
  if (profileExists(name)) { error(`Profile "${name}" exists.`); process.exit(1); }
  createProfile(name, { token: opts.token });
  success(`Profile "${name}" created`);
  if (opts.use) setCurrentProfile(name);
});

profileCmd.command('delete <name>').action((name: string) => {
  if (!deleteProfile(name)) { error(`Could not delete "${name}".`); process.exit(1); }
  success(`Profile "${name}" deleted`);
});

profileCmd.command('show [name]').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`Token: ${config.token || config.accessToken ? 'set' : chalk.gray('not set')}`);
  info(`Data center: ${config.dataCenter || 'com'}`);
});

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-token <token>').action((token: string) => {
  setToken(token);
  success(`Token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('set-data-center <dc>').action((dc: string) => {
  setDataCenter(dc);
  success(`Data center set to: ${dc}`);
});

configCmd.command('set-base-url <url>').action((url: string) => {
  setBaseUrl(url);
  success(`Base URL saved.`);
});

configCmd.command('show').action(() => {
  console.log(chalk.bold(`Active profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  info(`Token: ${getToken() ? 'set' : chalk.gray('not set')}`);
  info(`Data center: ${getDataCenter()}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('(from data center)')}`);
});

configCmd.command('clear').action(() => {
  clearConfig();
  success('Configuration cleared.');
});

// Auth commands
const authCmd = program.command('auth').description('OAuth2 authentication');

authCmd.command('login').option('--client-id <id>', 'OAuth client ID').option('--client-secret <secret>', 'OAuth client secret').option('--data-center <dc>', 'Zoho data center').action(async (opts) => {
  if (opts.dataCenter) setDataCenter(opts.dataCenter);
  if (opts.clientId && opts.clientSecret) setOAuthConfig({ clientId: opts.clientId, clientSecret: opts.clientSecret });
  const state = randomUUID();
  const url = getAuthUrl({ state });
  info(`Open this URL in your browser:\n${url}`);
  info(`Redirect URI: ${getRedirectUri()}`);
  const result = await startCallbackServer({ expectedState: state });
  if (!result.success || !result.tokens) { error(result.error || 'Authentication failed'); process.exit(1); }
  saveOAuthTokens(result.tokens);
  setToken(result.tokens.accessToken);
  success('Authenticated successfully.');
});

authCmd.command('token').action(async () => {
  try {
    const token = await getValidAccessToken();
    success(`Access token: ${token.substring(0, 8)}...`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

authCmd.command('status').action(() => {
  info(isAuthenticated() ? 'Authenticated' : 'Not authenticated');
});

authCmd.command('logout').action(() => {
  clearOAuthTokens();
  success('Logged out.');
});

// Secrets
const secretsCmd = program.command('secrets').description('Secret operations');

secretsCmd.command('list').option('--search <q>').option('--limit <n>').option('--offset <n>').option('--chamber-id <id>').action(async (opts, cmd) => {
  await run(cmd, (c) => c.listSecrets({
    search: opts.search,
    limit: opts.limit ? Number(opts.limit) : undefined,
    offset: opts.offset ? Number(opts.offset) : undefined,
    chamberId: opts.chamberId,
  }));
});

secretsCmd.command('get <id>').option('--reason <reason>').action(async (id, opts, cmd) => {
  await run(cmd, (c) => c.getSecret(id, opts.reason));
});

secretsCmd.command('password <id>').option('--reason <reason>').action(async (id, opts, cmd) => {
  await run(cmd, (c) => c.getSecretPassword(id, opts.reason));
});

secretsCmd.command('create').requiredOption('-n, --name <name>', 'Secret name').option('--type <type>').option('--chamber-id <id>').requiredOption('--secret-data <json>', 'Secret data JSON').option('--description <desc>').option('--tags <tags>', 'Comma-separated tags').action(async (opts, cmd) => {
  await run(cmd, (c) => c.createSecret({
    name: opts.name,
    type: opts.type,
    chamberId: opts.chamberId,
    secretData: JSON.parse(opts.secretData),
    description: opts.description,
    tags: opts.tags?.split(','),
  }));
});

secretsCmd.command('update <id>').option('-n, --name <name>').option('--secret-data <json>').option('--description <desc>').option('--tags <tags>').action(async (id, opts, cmd) => {
  await run(cmd, (c) => c.updateSecret(id, {
    name: opts.name,
    secretData: opts.secretData ? JSON.parse(opts.secretData) : undefined,
    description: opts.description,
    tags: opts.tags?.split(','),
  }));
});

secretsCmd.command('delete <id>').action(async (id, _opts, cmd) => {
  await run(cmd, (c) => c.deleteSecret(id));
});

secretsCmd.command('search <query>').option('--limit <n>').option('--offset <n>').action(async (query, opts, cmd) => {
  await run(cmd, (c) => c.searchSecrets(query, { limit: opts.limit ? Number(opts.limit) : undefined, offset: opts.offset ? Number(opts.offset) : undefined }));
});

// Chambers
const chambersCmd = program.command('chambers').description('Chamber operations');

chambersCmd.command('list').option('--limit <n>').option('--offset <n>').action(async (opts, cmd) => {
  await run(cmd, (c) => c.listChambers({ limit: opts.limit ? Number(opts.limit) : undefined, offset: opts.offset ? Number(opts.offset) : undefined }));
});

chambersCmd.command('get <id>').action(async (id, _opts, cmd) => {
  await run(cmd, (c) => c.getChamber(id));
});

chambersCmd.command('create').requiredOption('-n, --name <name>').option('--description <desc>').action(async (opts, cmd) => {
  await run(cmd, (c) => c.createChamber({ name: opts.name, description: opts.description }));
});

chambersCmd.command('update <id>').option('-n, --name <name>').option('--description <desc>').action(async (id, opts, cmd) => {
  await run(cmd, (c) => c.updateChamber(id, { name: opts.name, description: opts.description }));
});

chambersCmd.command('delete <id>').action(async (id, _opts, cmd) => {
  await run(cmd, (c) => c.deleteChamber(id));
});

chambersCmd.command('add-secrets <chamberId>').requiredOption('--secret-ids <ids>', 'Comma-separated secret IDs').action(async (chamberId, opts, cmd) => {
  await run(cmd, (c) => c.addSecretsToChamber(chamberId, opts.secretIds.split(',')));
});

// Users & groups
const usersCmd = program.command('users').description('User operations');
usersCmd.command('list').option('--limit <n>').option('--offset <n>').action(async (opts, cmd) => {
  await run(cmd, (c) => c.listUsers({ limit: opts.limit ? Number(opts.limit) : undefined, offset: opts.offset ? Number(opts.offset) : undefined }));
});

const groupsCmd = program.command('groups').description('User group operations');
groupsCmd.command('list').option('--limit <n>').option('--offset <n>').action(async (opts, cmd) => {
  await run(cmd, (c) => c.listGroups({ limit: opts.limit ? Number(opts.limit) : undefined, offset: opts.offset ? Number(opts.offset) : undefined }));
});
groupsCmd.command('create').requiredOption('-n, --name <name>').option('--description <desc>').option('--user-ids <ids>').action(async (opts, cmd) => {
  await run(cmd, (c) => c.createGroup({ name: opts.name, description: opts.description, userIds: opts.userIds?.split(',') }));
});
groupsCmd.command('delete <id>').action(async (id, _opts, cmd) => {
  await run(cmd, (c) => c.deleteGroup(id));
});

// Share
const shareCmd = program.command('share').description('Sharing operations');
shareCmd.command('secret <secretId>').requiredOption('--permission <perm>', 'VIEW|MODIFY|MANAGE|VIEW_AND_COPY').option('--user-ids <ids>').option('--group-ids <ids>').action(async (secretId, opts, cmd) => {
  await run(cmd, (c) => c.shareSecret({ secretId, permission: opts.permission as ZohoVaultSharePermission, userIds: opts.userIds?.split(','), groupIds: opts.groupIds?.split(',') }));
});
shareCmd.command('unshare <secretId>').option('--user-ids <ids>').option('--group-ids <ids>').action(async (secretId, opts, cmd) => {
  await run(cmd, (c) => c.unshareSecret({ secretId, userIds: opts.userIds?.split(','), groupIds: opts.groupIds?.split(',') }));
});
shareCmd.command('list <secretId>').action(async (secretId, _opts, cmd) => {
  await run(cmd, (c) => c.listShares(secretId));
});

// Audit, metadata, favorites, org
program.command('audit').option('--limit <n>').option('--offset <n>').option('--from <date>').option('--to <date>').option('--user-id <id>').option('--secret-id <id>').option('--event-type <type>').action(async (opts, cmd) => {
  await run(cmd, (c) => c.listAuditLogs({
    limit: opts.limit ? Number(opts.limit) : undefined,
    offset: opts.offset ? Number(opts.offset) : undefined,
    from: opts.from,
    to: opts.to,
    userId: opts.userId,
    secretId: opts.secretId,
    eventType: opts.eventType,
  }));
});

program.command('secret-types').action(async (_opts, cmd) => {
  await run(cmd, (c) => c.listSecretTypes());
});

program.command('tags').action(async (_opts, cmd) => {
  await run(cmd, (c) => c.listTags());
});

const favoritesCmd = program.command('favorites').description('Favorite secrets');
favoritesCmd.command('list').action(async (_opts, cmd) => { await run(cmd, (c) => c.listFavorites()); });
favoritesCmd.command('add <secretId>').action(async (secretId, _opts, cmd) => { await run(cmd, (c) => c.addToFavorites(secretId)); });
favoritesCmd.command('remove <secretId>').action(async (secretId, _opts, cmd) => { await run(cmd, (c) => c.removeFromFavorites(secretId)); });

program.command('organization').action(async (_opts, cmd) => {
  await run(cmd, (c) => c.getOrganization());
});

program.command('generate-password').option('--length <n>').option('--uppercase').option('--lowercase').option('--numbers').option('--special').action(async (opts, cmd) => {
  await run(cmd, (c) => c.generatePassword({
    length: opts.length ? Number(opts.length) : undefined,
    useUppercase: opts.uppercase,
    useLowercase: opts.lowercase,
    useNumbers: opts.numbers,
    useSpecialChars: opts.special,
  }));
});

program.parse();
