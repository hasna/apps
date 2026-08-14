#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Teleport } from '../api';
import {
  getBaseUrl,
  getToken,
  setBaseUrl,
  setToken,
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

const CONNECTOR_NAME = 'connect-teleport';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Teleport connector CLI — PAM, sessions, users, roles, access requests, audit')
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

function getClient(): Teleport {
  const baseUrl = getBaseUrl();
  const token = getToken();
  if (!baseUrl) {
    error(`No Teleport base URL configured. Run "${CONNECTOR_NAME} config set" or set TELEPORT_BASE_URL.`);
    process.exit(1);
  }
  if (!token) {
    error(`No Teleport token configured. Run "${CONNECTOR_NAME} config set" or set TELEPORT_TOKEN.`);
    process.exit(1);
  }
  return new Teleport({ baseUrl, token });
}

function runAction(cmd: Command, fn: (client: Teleport) => Promise<unknown>): void {
  fn(getClient())
    .then((result) => print(result, getFormat(cmd)))
    .catch((err) => {
      error(String(err));
      process.exit(1);
    });
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
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('--base-url <url>', 'Teleport proxy URL')
  .option('--token <token>', 'Teleport API token')
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { baseUrl: opts.baseUrl, token: opts.token });
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
  if (deleteProfile(name)) success(`Profile "${name}" deleted`);
  else {
    error(`Profile "${name}" not found`);
    process.exit(1);
  }
});

profileCmd.command('show [name]').description('Show profile configuration').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(' (active)') : ''}`));
  info(`Base URL: ${config.baseUrl || chalk.gray('not set')}`);
  info(`Token: ${config.token ? `${config.token.substring(0, 8)}...` : chalk.gray('not set')}`);
});

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set')
  .description('Set Teleport credentials')
  .requiredOption('--base-url <url>', 'Teleport proxy URL')
  .requiredOption('--token <token>', 'Teleport API token')
  .action((opts) => {
    setBaseUrl(opts.baseUrl);
    setToken(opts.token);
    success(`Credentials saved to profile: ${getCurrentProfile()}`);
  });

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray('not set')}`);
  info(`Token: ${getToken() ? `${getToken()!.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration for active profile').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const pingCmd = program.command('ping').description('Ping Teleport cluster');
pingCmd.action(function () {
  runAction(pingCmd, (client) => client.getPing());
});

const nodesCmd = program.command('nodes').description('Teleport node operations');
nodesCmd.command('list').description('List nodes').option('--query <query>', 'Search query').option('--page-size <n>', 'Page size').option('--start-key <key>', 'Pagination key').option('--search-as-roles', 'Search as roles').action(function (opts) {
  runAction(nodesCmd, (client) => client.listNodes({ query: opts.query, pageSize: opts.pageSize ? Number(opts.pageSize) : undefined, startKey: opts.startKey, searchAsRoles: opts.searchAsRoles }));
});
nodesCmd.command('get <name>').description('Get node by name').action(function (name: string) {
  runAction(nodesCmd, (client) => client.getNode(name));
});
nodesCmd.command('apps').description('List registered apps').action(function () {
  runAction(nodesCmd, (client) => client.listApps());
});
nodesCmd.command('kubernetes').description('List Kubernetes clusters').action(function () {
  runAction(nodesCmd, (client) => client.listKubernetesClusters());
});
nodesCmd.command('databases').description('List databases').action(function () {
  runAction(nodesCmd, (client) => client.listDatabases());
});
nodesCmd.command('desktops').description('List desktops').action(function () {
  runAction(nodesCmd, (client) => client.listDesktops());
});

const sessionsCmd = program.command('sessions').description('Session operations');
sessionsCmd.command('list').description('List sessions').option('--from <iso>', 'Start time').option('--to <iso>', 'End time').option('--order <order>', 'Sort order (ASC|DESC)').option('--page-size <n>', 'Page size').option('--start-key <key>', 'Pagination key').action(function (opts) {
  runAction(sessionsCmd, (client) => client.listSessions({ from: opts.from, to: opts.to, order: opts.order, pageSize: opts.pageSize ? Number(opts.pageSize) : undefined, startKey: opts.startKey }));
});
sessionsCmd.command('get <id>').description('Get session by ID').action(function (id: string) {
  runAction(sessionsCmd, (client) => client.getSession(id));
});
sessionsCmd.command('terminate <id>').description('Terminate session').option('--participant-id <id>', 'Participant ID').action(function (id: string, opts) {
  runAction(sessionsCmd, (client) => client.terminateSession(id, opts.participantId));
});
sessionsCmd.command('recording <sessionId>').description('Get session recording metadata').action(function (sessionId: string) {
  runAction(sessionsCmd, (client) => client.getSessionRecording(sessionId));
});

const usersCmd = program.command('users').description('User operations');
usersCmd.command('list').description('List users').action(function () {
  runAction(usersCmd, (client) => client.listUsers());
});
usersCmd.command('get <name>').description('Get user').option('--with-secrets', 'Include secrets').action(function (name: string, opts) {
  runAction(usersCmd, (client) => client.getUser(name, opts.withSecrets));
});
usersCmd.command('create').description('Create user').requiredOption('--json <json>', 'User JSON body').action(function (opts) {
  runAction(usersCmd, (client) => client.createUser(JSON.parse(opts.json)));
});
usersCmd.command('update <name>').description('Update user').requiredOption('--json <json>', 'User JSON body').action(function (name: string, opts) {
  runAction(usersCmd, (client) => client.updateUser(name, JSON.parse(opts.json)));
});
usersCmd.command('delete <name>').description('Delete user').action(function (name: string) {
  runAction(usersCmd, (client) => client.deleteUser(name));
});

const rolesCmd = program.command('roles').description('Role operations');
rolesCmd.command('list').description('List roles').action(function () {
  runAction(rolesCmd, (client) => client.listRoles());
});
rolesCmd.command('get <name>').description('Get role').action(function (name: string) {
  runAction(rolesCmd, (client) => client.getRole(name));
});
rolesCmd.command('upsert').description('Create or update role').requiredOption('--json <json>', 'Role JSON body').action(function (opts) {
  runAction(rolesCmd, (client) => client.upsertRole(JSON.parse(opts.json)));
});
rolesCmd.command('delete <name>').description('Delete role').action(function (name: string) {
  runAction(rolesCmd, (client) => client.deleteRole(name));
});

const accessCmd = program.command('access-requests').description('Access request operations');
accessCmd.command('list').description('List access requests').option('--state <state>', 'Filter by state').option('--user <user>', 'Filter by user').action(function (opts) {
  runAction(accessCmd, (client) => client.listAccessRequests({ state: opts.state, user: opts.user }));
});
accessCmd.command('get <id>').description('Get access request').action(function (id: string) {
  runAction(accessCmd, (client) => client.getAccessRequest(id));
});
accessCmd.command('create').description('Create access request').requiredOption('--user <user>', 'Requesting user').requiredOption('--roles <roles>', 'Comma-separated roles').option('--reason <reason>', 'Request reason').option('--json <json>', 'Full JSON body override').action(function (opts) {
  runAction(accessCmd, (client) => {
    if (opts.json) return client.createAccessRequest(JSON.parse(opts.json));
    return client.createAccessRequest({ user: opts.user, roles: opts.roles.split(',').map((r: string) => r.trim()) , reason: opts.reason });
  });
});
accessCmd.command('approve <id>').description('Approve access request').option('--reason <reason>', 'Review reason').action(function (id: string, opts) {
  runAction(accessCmd, (client) => client.approveAccessRequest(id, opts.reason));
});
accessCmd.command('deny <id>').description('Deny access request').option('--reason <reason>', 'Review reason').action(function (id: string, opts) {
  runAction(accessCmd, (client) => client.denyAccessRequest(id, opts.reason));
});
accessCmd.command('delete <id>').description('Delete access request').action(function (id: string) {
  runAction(accessCmd, (client) => client.deleteAccessRequest(id));
});

const tokensCmd = program.command('tokens').description('Provision token operations');
tokensCmd.command('list').description('List tokens').action(function () {
  runAction(tokensCmd, (client) => client.listTokens());
});
tokensCmd.command('create').description('Create token').requiredOption('--roles <roles>', 'Comma-separated roles').option('--ttl <ttl>', 'Token TTL').option('--name <name>', 'Token name').option('--allowed-cidrs <cidrs>', 'Comma-separated allowed CIDRs').action(function (opts) {
  runAction(tokensCmd, (client) => client.createToken({
    roles: opts.roles.split(',').map((r: string) => r.trim()),
    ttl: opts.ttl,
    name: opts.name,
    allowedCidrs: opts.allowedCidrs ? opts.allowedCidrs.split(',').map((c: string) => c.trim()) : undefined,
  }));
});
tokensCmd.command('delete <name>').description('Delete token').action(function (name: string) {
  runAction(tokensCmd, (client) => client.deleteToken(name));
});

const auditCmd = program.command('audit').description('Audit event operations');
auditCmd.command('search').description('Search audit events').requiredOption('--from <iso>', 'Start time').requiredOption('--to <iso>', 'End time').option('--event-type <types...>', 'Event types').option('--page-size <n>', 'Page size').option('--start-key <key>', 'Pagination key').option('--order <order>', 'Sort order (ASC|DESC)').action(function (opts) {
  runAction(auditCmd, (client) => client.getAuditEvents({
    from: opts.from,
    to: opts.to,
    eventType: opts.eventType,
    pageSize: opts.pageSize ? Number(opts.pageSize) : undefined,
    startKey: opts.startKey,
    order: opts.order,
  }));
});

const authConnectorsCmd = program.command('auth-connectors').description('Auth connector operations');
authConnectorsCmd.command('list').description('List auth connectors').action(function () {
  runAction(authConnectorsCmd, (client) => client.listAuthConnectors());
});
authConnectorsCmd.command('upsert').description('Create or update auth connector').requiredOption('--json <json>', 'Connector JSON body').action(function (opts) {
  runAction(authConnectorsCmd, (client) => client.upsertAuthConnector(JSON.parse(opts.json)));
});
authConnectorsCmd.command('delete <kind> <name>').description('Delete auth connector').action(function (kind: 'saml' | 'oidc' | 'github', name: string) {
  runAction(authConnectorsCmd, (client) => client.deleteAuthConnector(kind, name));
});

program.parse();
