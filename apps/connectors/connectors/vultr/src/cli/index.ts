#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { Vultr } from '../api';
import {
  getApiKey,
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

const CONNECTOR_NAME = 'connect-vultr';
const VERSION = '0.0.1';

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description('Vultr connector - Manage cloud instances, block storage, firewalls, and more')
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
      process.env.VULTR_API_KEY = opts.apiKey;
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || 'pretty') as OutputFormat;
}

function getClient(): Vultr {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set VULTR_API_KEY environment variable.`);
    process.exit(1);
  }
  return new Vultr({ apiKey });
}

// Profile Commands
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
  .option('--use', 'Switch to this profile after creation')
  .action((name: string, opts) => {
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
});

// Config Commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd.command('set-key <apiKey>').description('Set API key').action((apiKey: string) => {
  setApiKey(apiKey);
  success(`API key saved to profile: ${getCurrentProfile()}`);
});

configCmd.command('show').description('Show current configuration').action(() => {
  const profileName = getCurrentProfile();
  const apiKey = getApiKey();
  console.log(chalk.bold(`Active Profile: ${profileName}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray('not set')}`);
});

configCmd.command('clear').description('Clear configuration').action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

// Account
program.command('account').description('Get account info').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.getAccount();
    print(result.account, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Regions
program.command('regions').description('List regions').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.listRegions();
    print(result.regions, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Plans
program.command('plans').description('List plans').option('--type <type>', 'Plan type filter').action(async function(this: Command, opts) {
  try {
    const client = getClient();
    const result = await client.listPlans({ type: opts.type });
    print(result.plans, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Instance Commands
const instanceCmd = program.command('instance').description('Instance operations');

instanceCmd.command('list').description('List instances').option('--region <region>', 'Filter by region').action(async function(this: Command, opts) {
  try {
    const client = getClient();
    const result = await client.listInstances({ region: opts.region });
    print(result.instances, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

instanceCmd.command('get <instanceId>').description('Get instance details').action(async function(this: Command, instanceId: string) {
  try {
    const client = getClient();
    const result = await client.getInstance(instanceId);
    print(result.instance, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

instanceCmd
  .command('create')
  .description('Create an instance')
  .requiredOption('-r, --region <region>', 'Region id')
  .requiredOption('-p, --plan <plan>', 'Plan id')
  .requiredOption('--os-id <osId>', 'Operating system id')
  .option('-l, --label <label>', 'Instance label')
  .option('--hostname <hostname>', 'Hostname')
  .option('--enable-ipv6', 'Enable IPv6')
  .option('--ssh-keys <keys>', 'SSH key ids (comma-separated)')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createInstance({
        region: opts.region,
        plan: opts.plan,
        os_id: opts.osId ? parseInt(opts.osId) : undefined,
        label: opts.label,
        hostname: opts.hostname,
        enable_ipv6: opts.enableIpv6,
        sshkey_id: opts.sshKeys ? opts.sshKeys.split(',') : undefined,
      });
      success('Instance created!');
      print(result.instance, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

instanceCmd.command('delete <instanceId>').description('Delete an instance').action(async function(this: Command, instanceId: string) {
  try {
    const client = getClient();
    await client.deleteInstance(instanceId);
    success('Instance deleted!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

instanceCmd.command('reboot <instanceId>').description('Reboot an instance').action(async function(this: Command, instanceId: string) {
  try {
    const client = getClient();
    await client.rebootInstance(instanceId);
    success('Instance reboot initiated!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

instanceCmd.command('halt <instanceId>').description('Halt an instance').action(async function(this: Command, instanceId: string) {
  try {
    const client = getClient();
    await client.haltInstance(instanceId);
    success('Instance halted!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

instanceCmd.command('start <instanceId>').description('Start an instance').action(async function(this: Command, instanceId: string) {
  try {
    const client = getClient();
    await client.startInstance(instanceId);
    success('Instance started!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// SSH Key Commands
const sshKeyCmd = program.command('ssh-key').description('SSH key operations');

sshKeyCmd.command('list').description('List SSH keys').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.listSSHKeys();
    print(result.ssh_keys, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

sshKeyCmd.command('get <sshKeyId>').description('Get SSH key details').action(async function(this: Command, sshKeyId: string) {
  try {
    const client = getClient();
    const result = await client.getSSHKey(sshKeyId);
    print(result.ssh_key, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

sshKeyCmd
  .command('create')
  .description('Create an SSH key')
  .requiredOption('-n, --name <name>', 'Key name')
  .requiredOption('--public-key <key>', 'Public key content')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createSSHKey({
        name: opts.name,
        ssh_key: opts.publicKey,
      });
      success('SSH key created!');
      print(result.ssh_key, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

sshKeyCmd.command('delete <sshKeyId>').description('Delete an SSH key').action(async function(this: Command, sshKeyId: string) {
  try {
    const client = getClient();
    await client.deleteSSHKey(sshKeyId);
    success('SSH key deleted!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Snapshot Commands
const snapshotCmd = program.command('snapshot').description('Snapshot operations');

snapshotCmd.command('list').description('List snapshots').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.listSnapshots();
    print(result.snapshots, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

snapshotCmd.command('get <snapshotId>').description('Get snapshot details').action(async function(this: Command, snapshotId: string) {
  try {
    const client = getClient();
    const result = await client.getSnapshot(snapshotId);
    print(result.snapshot, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

snapshotCmd
  .command('create')
  .description('Create a snapshot from an instance')
  .requiredOption('-i, --instance-id <instanceId>', 'Instance id')
  .option('-d, --description <description>', 'Snapshot description')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createSnapshot({
        instance_id: opts.instanceId,
        description: opts.description,
      });
      success('Snapshot created!');
      print(result.snapshot, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

snapshotCmd.command('delete <snapshotId>').description('Delete a snapshot').action(async function(this: Command, snapshotId: string) {
  try {
    const client = getClient();
    await client.deleteSnapshot(snapshotId);
    success('Snapshot deleted!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Block Storage Commands
const blockCmd = program.command('block').description('Block storage operations');

blockCmd.command('list').description('List block storage volumes').option('--region <region>', 'Filter by region').action(async function(this: Command, opts) {
  try {
    const client = getClient();
    const result = await client.listBlocks({ region: opts.region });
    print(result.blocks, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

blockCmd.command('get <blockId>').description('Get block storage details').action(async function(this: Command, blockId: string) {
  try {
    const client = getClient();
    const result = await client.getBlock(blockId);
    print(result.block, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

blockCmd
  .command('create')
  .description('Create block storage')
  .requiredOption('-r, --region <region>', 'Region id')
  .requiredOption('-s, --size <size>', 'Size in GB')
  .option('-l, --label <label>', 'Label')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createBlock({
        region: opts.region,
        size_gb: parseInt(opts.size),
        label: opts.label,
      });
      success('Block storage created!');
      print(result.block, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

blockCmd.command('delete <blockId>').description('Delete block storage').action(async function(this: Command, blockId: string) {
  try {
    const client = getClient();
    await client.deleteBlock(blockId);
    success('Block storage deleted!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

blockCmd.command('attach <blockId> <instanceId>').description('Attach block storage to instance').action(async function(this: Command, blockId: string, instanceId: string) {
  try {
    const client = getClient();
    await client.attachBlock(blockId, instanceId);
    success('Block storage attached!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

blockCmd.command('detach <blockId>').description('Detach block storage').action(async function(this: Command, blockId: string) {
  try {
    const client = getClient();
    await client.detachBlock(blockId);
    success('Block storage detached!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

// Firewall Commands
const firewallCmd = program.command('firewall').description('Firewall group operations');

firewallCmd.command('list').description('List firewall groups').action(async function(this: Command) {
  try {
    const client = getClient();
    const result = await client.listFirewallGroups();
    print(result.firewall_groups, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

firewallCmd.command('get <firewallGroupId>').description('Get firewall group details').action(async function(this: Command, firewallGroupId: string) {
  try {
    const client = getClient();
    const result = await client.getFirewallGroup(firewallGroupId);
    print(result.firewall_group, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

firewallCmd
  .command('create')
  .description('Create a firewall group')
  .option('-d, --description <description>', 'Description')
  .action(async function(this: Command, opts) {
    try {
      const client = getClient();
      const result = await client.createFirewallGroup({ description: opts.description });
      success('Firewall group created!');
      print(result.firewall_group, getFormat(this));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

firewallCmd.command('delete <firewallGroupId>').description('Delete a firewall group').action(async function(this: Command, firewallGroupId: string) {
  try {
    const client = getClient();
    await client.deleteFirewallGroup(firewallGroupId);
    success('Firewall group deleted!');
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

firewallCmd.command('rules <firewallGroupId>').description('List firewall rules').action(async function(this: Command, firewallGroupId: string) {
  try {
    const client = getClient();
    const result = await client.listFirewallRules(firewallGroupId);
    print(result.firewall_rules, getFormat(this));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
});

program.parse();
