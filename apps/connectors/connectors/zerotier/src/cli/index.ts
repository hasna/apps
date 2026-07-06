#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { ZeroTier } from '../api';
import {
  getApiKey, setApiKey, clearConfig, getConfigDir, setProfileOverride,
  getCurrentProfile, setCurrentProfile, listProfiles, createProfile,
  deleteProfile, profileExists, loadProfile,
} from '../utils/config';
import type { OutputFormat } from '../utils/output';
import { success, error, info, print } from '../utils/output';
import type { OrgRole } from '../types';

const CONNECTOR_NAME = 'connect-zerotier';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('ZeroTier Central connector CLI - SDN networks, members, and organizations')
  .version(VERSION)
  .option('-k, --api-key <key>', 'API key (overrides config)')
  .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .hook('preAction', () => {
    const opts = program.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.apiKey) {
      process.env.ZEROTIER_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  let current: Command | null = cmd;
  while (current) {
    const format = current.opts().format;
    if (format) return format as OutputFormat;
    current = current.parent;
  }
  return 'pretty';
}

function getClient(): ZeroTier {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set ZEROTIER_API_KEY`);
    process.exit(1);
  }
  return new ZeroTier({ apiKey, baseUrl: process.env.ZEROTIER_BASE_URL });
}

// Profile Commands
const profileCmd = program.command('profile').description('Manage profiles');

profileCmd.command('list').description('List profiles').action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) { info('No profiles found'); return; }
  profiles.forEach(p => {
    console.log(`  ${p}${p === current ? chalk.green(' (active)') : ''}`);
  });
});

profileCmd.command('use <name>').description('Switch profile').action((name: string) => {
  if (!profileExists(name)) { error(`Profile "${name}" does not exist`); process.exit(1); }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd.command('create <name>').description('Create profile')
  .option('--api-key <key>', 'API key')
  .option('--use', 'Switch to this profile')
  .action((name: string, opts) => {
    if (profileExists(name)) { error(`Profile "${name}" already exists`); process.exit(1); }
    createProfile(name, { apiKey: opts.apiKey || program.opts().apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) { setCurrentProfile(name); info(`Switched to profile: ${name}`); }
  });

profileCmd.command('delete <name>').description('Delete profile').action((name: string) => {
  if (name === 'default') { error('Cannot delete default profile'); process.exit(1); }
  if (deleteProfile(name)) { success(`Profile "${name}" deleted`); }
  else { error(`Profile "${name}" not found`); process.exit(1); }
});

profileCmd.command('show [name]').description('Show profile').action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  console.log(chalk.bold(`Profile: ${profileName}`));
  info(`API Key: ${config.apiKey ? config.apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
});

// Config Commands
const configCmd = program.command('config').description('Manage configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success('API key saved');
});

configCmd.command('show').description('Show config').action(() => {
  console.log(chalk.bold(`Profile: ${getCurrentProfile()}`));
  info(`Config dir: ${getConfigDir()}`);
  const apiKey = getApiKey();
  info(`API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear config').action(() => {
  clearConfig();
  success('Config cleared');
});

// Status
program.command('status').description('Get ZeroTier Central API status').action(async () => {
  try {
    const client = getClient();
    print(await client.getStatus(), getFormat(program));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Account
program.command('account').description('Get current user account').action(async () => {
  try {
    const client = getClient();
    print(await client.getMyAccount(), getFormat(program));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Organization Commands
const orgCmd = program.command('org').description('Organization operations');

orgCmd.command('list').description('List organizations').action(async () => {
  try {
    const client = getClient();
    print(await client.listOrganizations(), getFormat(orgCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const orgUserCmd = orgCmd.command('user').description('Organization user operations');

orgUserCmd.command('list <orgId>').description('List organization users').action(async (orgId: string) => {
  try {
    const client = getClient();
    print(await client.listOrgUsers(orgId), getFormat(orgUserCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

orgUserCmd.command('add <orgId> <email>')
  .description('Add user to organization')
  .option('-r, --role <role>', 'Role (ROLE_OWNER, ROLE_ADMIN, ROLE_AUDITOR, ROLE_USER, ROLE_BILLING)')
  .action(async (orgId: string, email: string, opts: { role?: OrgRole }) => {
    try {
      const client = getClient();
      print(await client.addOrgUser(orgId, email, opts.role), getFormat(orgUserCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

orgUserCmd.command('remove <orgId> <userId>').description('Remove user from organization')
  .action(async (orgId: string, userId: string) => {
    try {
      const client = getClient();
      await client.removeOrgUser(orgId, userId);
      success('User removed');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const inviteCmd = orgCmd.command('invite').description('Organization invite operations');

inviteCmd.command('list <orgId>').description('List pending invites').action(async (orgId: string) => {
  try {
    const client = getClient();
    print(await client.listInvites(orgId), getFormat(inviteCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

inviteCmd.command('revoke <orgId> <inviteId>').description('Revoke invite').action(async (orgId: string, inviteId: string) => {
  try {
    const client = getClient();
    await client.revokeInvite(orgId, inviteId);
    success('Invite revoked');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

orgCmd.command('sso <orgId>').description('List SSO configuration').action(async (orgId: string) => {
  try {
    const client = getClient();
    print(await client.listSso(orgId), getFormat(orgCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

const auditCmd = orgCmd.command('audit').description('Organization audit logs');

auditCmd.command('list <orgId>')
  .description('List audit logs')
  .option('--from <iso>', 'Start timestamp')
  .option('--to <iso>', 'End timestamp')
  .option('-n, --limit <number>', 'Maximum entries', parseInt)
  .option('--cursor <cursor>', 'Pagination cursor')
  .action(async (orgId: string, opts: { from?: string; to?: string; limit?: number; cursor?: string }) => {
    try {
      const client = getClient();
      print(await client.listAuditLogs(orgId, {
        from: opts.from,
        to: opts.to,
        limit: opts.limit,
        cursor: opts.cursor,
      }), getFormat(auditCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

// Network Commands
const networkCmd = program.command('network').description('Network operations');

networkCmd.command('list').description('List networks').action(async () => {
  try {
    const client = getClient();
    print(await client.listNetworks(), getFormat(networkCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

networkCmd.command('get <id>').description('Get network details').action(async (id: string) => {
  try {
    const client = getClient();
    print(await client.getNetwork(id), getFormat(networkCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

networkCmd.command('create <name>')
  .description('Create a network')
  .option('-d, --description <text>', 'Network description')
  .option('--public', 'Create a public network (default is private)')
  .action(async (name: string, opts: { description?: string; public?: boolean }) => {
    try {
      const client = getClient();
      print(await client.createNetwork({
        name,
        description: opts.description,
        private: !opts.public,
      }), getFormat(networkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

networkCmd.command('update <id>')
  .description('Update a network')
  .requiredOption('-j, --json <payload>', 'JSON update payload')
  .action(async (id: string, opts: { json: string }) => {
    try {
      const client = getClient();
      const updates = JSON.parse(opts.json) as Record<string, unknown>;
      print(await client.updateNetwork(id, updates), getFormat(networkCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

networkCmd.command('delete <id>').description('Delete a network').action(async (id: string) => {
  try {
    const client = getClient();
    await client.deleteNetwork(id);
    success(`Network ${id} deleted`);
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Member Commands
const memberCmd = program.command('member').description('Network member operations');

memberCmd.command('list <networkId>').description('List network members').action(async (networkId: string) => {
  try {
    const client = getClient();
    print(await client.listMembers(networkId), getFormat(memberCmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

memberCmd.command('get <networkId> <nodeId>').description('Get member details')
  .action(async (networkId: string, nodeId: string) => {
    try {
      const client = getClient();
      print(await client.getMember(networkId, nodeId), getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd.command('authorize <networkId> <nodeId>')
  .description('Authorize a member')
  .option('-n, --name <name>', 'Member name')
  .option('-d, --description <text>', 'Member description')
  .action(async (networkId: string, nodeId: string, opts: { name?: string; description?: string }) => {
    try {
      const client = getClient();
      print(await client.authorizeMember(networkId, nodeId, {
        name: opts.name,
        description: opts.description,
      }), getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd.command('deauthorize <networkId> <nodeId>').description('Deauthorize a member')
  .action(async (networkId: string, nodeId: string) => {
    try {
      const client = getClient();
      print(await client.deauthorizeMember(networkId, nodeId), getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd.command('update <networkId> <nodeId>')
  .description('Update a member')
  .requiredOption('-j, --json <payload>', 'JSON update payload')
  .action(async (networkId: string, nodeId: string, opts: { json: string }) => {
    try {
      const client = getClient();
      const updates = JSON.parse(opts.json) as Record<string, unknown>;
      print(await client.updateMember(networkId, nodeId, updates), getFormat(memberCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

memberCmd.command('delete <networkId> <nodeId>').description('Delete a member')
  .action(async (networkId: string, nodeId: string) => {
    try {
      const client = getClient();
      await client.deleteMember(networkId, nodeId);
      success('Member deleted');
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
